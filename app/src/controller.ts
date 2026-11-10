import {authorizationHeaders, type ClientAccess} from './access';
import { HttpAgent, type HttpAgentFetchFn } from '@ag-ui/client';
import type { Message } from '@ag-ui/core';
import { MessageSchema } from '@ag-ui/core/schemas';
import { z } from 'zod/v4';
import { Snapshot, type Conversation, type Decision, Prompt } from './contract';
import {VerificationClient} from './verification';
import {DeliveryClient} from './delivery';

export type PendingPromptStore = {load: () => Promise<unknown>; save: (prompt: Prompt) => Promise<void>; clear: () => Promise<void>};
export type ViewState = {
  connection: 'offline' | 'connecting' | 'connected';
  conversation: Conversation | null;
  messages: Message[];
  notice: string;
  pendingPrompt: Prompt | null;
};
export class ActionError extends Error {
  constructor(readonly status: number, readonly code = '') { super(`Action returned HTTP ${status}`); }
}
export class ConversationClient {
  private pendingRestored = false;
  private agent: HttpAgent | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private listeners = new Set<() => void>();
  private value: ViewState = {connection: 'offline', conversation: null, messages: [], notice: '', pendingPrompt: null};
  readonly verification: VerificationClient;
  readonly delivery: DeliveryClient;
  constructor(readonly url: string, readonly access: ClientAccess, readonly id: string, private transport: HttpAgentFetchFn = (url, init) => globalThis.fetch(url, init), private pendingStore?: PendingPromptStore) {
    this.delivery = new DeliveryClient({url, access, conversationId: id, transport});
    this.verification = new VerificationClient({url, access, conversationId: id, transport});
  }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<ViewState>) {
    this.value = {...this.value, ...patch};
    this.listeners.forEach(listener => listener());
  }
  async request(path: string, data?: unknown) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 40_000);
    try {
      const response = await this.transport(this.url + '/api/conversations' + path, {
        method: data === undefined ? 'GET' : 'POST',
        headers: {...authorizationHeaders(this.access), 'Content-Type': 'application/json'},
        body: data === undefined ? undefined : JSON.stringify(data), signal: abort.signal,
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({detail: z.string().optional(), code: z.string().optional()}).safeParse(payload);
        throw new ActionError(response.status, failure.success ? failure.data.code ?? failure.data.detail ?? '' : '');
      }
      return payload;
    } catch (error) {
      if (error instanceof ActionError) throw error;
      throw new ActionError(503);
    } finally { clearTimeout(timer); }
  }
  async create() {
    await this.request('', {id: this.id});
    await this.connect();
  }
  private accept(conversation: Conversation) {
    const previous = this.value.conversation;
    if (previous && conversation.revision < previous.revision) return;
    this.patch({conversation, messages: conversation.messages});
  }
  async refresh() { this.accept(Snapshot.parse(await this.request(`/${this.id}`))); }
  disconnect() {
    this.verification.disconnect();
    this.delivery.disconnect();
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.agent?.abortRun();
    this.agent = null;
    this.patch({connection: 'offline'});
  }
  async connect() {
    this.disconnect();
    const generation = this.generation;
    this.patch({connection: 'connecting'});
    try {
      if (this.pendingStore && !this.pendingRestored) {
        const saved = await this.pendingStore.load();
        if (generation !== this.generation) return;
        this.patch({pendingPrompt: saved ? Prompt.parse(saved) : null});
        this.pendingRestored = true;
      }
      const snapshot = Snapshot.parse(await this.request(`/${this.id}`));
      if (generation !== this.generation) return;
      const pending = this.value.pendingPrompt;
      if (pending && snapshot.inputs.some(input => input.request_id === pending.request_id && input.text === pending.text)) {
        await this.pendingStore?.clear();
        this.patch({pendingPrompt: null});
      }
      if (generation !== this.generation) return;
      this.accept(snapshot);
      if (snapshot.mode === 'approved-goal') this.delivery.connect();
      else if (snapshot.mode === 'proof') void this.verification.connect();
      const agent = new HttpAgent({
        url: `${this.url}/api/conversations/${this.id}/events`, threadId: this.id,
        headers: {...authorizationHeaders(this.access)}, fetch: this.transport,
      });
      this.agent = agent;
      agent.subscribe({
        onEvent: ({event}) => {
          if (generation !== this.generation) return;
          const recovered = /^(Connection lost|Cannot connect|Stream ended)/.test(this.value.notice);
          this.patch({connection: 'connected', ...(recovered ? {notice: ''} : {})});
          if (event.type === 'STATE_SNAPSHOT') {
            this.accept(Snapshot.parse({mode: snapshot.mode, ...z.record(z.string(), z.unknown()).parse(event.snapshot), messages: agent.messages}));
          }
          if (event.type === 'RUN_ERROR') this.patch({notice: 'Stream ended. Reconnecting to authoritative state.'});
        },
        onMessagesChanged: ({messages}) => {
          if (generation === this.generation) this.patch({messages: z.array(MessageSchema).parse(messages)});
        },
      });
      void agent.runAgent().catch(() => {
        if (generation === this.generation) this.patch({notice: 'Connection lost. Reconnecting without resending your goal.'});
      }).finally(() => {
        if (generation !== this.generation) return;
        this.patch({connection: 'offline'});
        if (!['cancelled', 'failed'].includes(this.value.conversation?.phase ?? '')) this.retry(generation);
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.patch({connection: 'offline', notice: error instanceof ActionError && [401,404].includes(error.status) ? 'Sign-in or conversation access rejected.' : 'Cannot connect. Retrying observation only.'});
      if (!(error instanceof ActionError && [401,404].includes(error.status))) this.retry(generation);
    }
  }
  private retry(generation: number) {
    this.timer = setTimeout(() => { if (generation === this.generation) void this.connect(); }, 1500);
  }
  private async reconcile() {
    try { await this.refresh(); }
    catch {
      this.patch({notice: this.value.notice + ' State refresh unavailable. Reconnect to observe the accepted state.'});
    }
  }
  async submit(prompt: Prompt) {
    if (this.pendingStore && !this.pendingRestored) throw new ActionError(503, 'pending_prompt_restore_required');
    const pending = this.value.pendingPrompt;
    if (pending && (pending.request_id !== prompt.request_id || pending.text !== prompt.text)) throw new Error('Retry the unchanged pending goal first');
    await this.pendingStore?.save(prompt);
    this.patch({pendingPrompt: prompt});
    try { await this.request(`/${this.id}/inputs`, prompt); }
    catch (error) {
      const ambiguous = error instanceof ActionError && (error.status >= 500 || error.code.includes('retry_same_request'));
      if (!ambiguous) await this.pendingStore?.clear();
      this.patch({
        pendingPrompt: ambiguous ? prompt : null,
        notice: ambiguous
          ? 'Acknowledgement unavailable. Retry this goal with its original identity.'
          : error instanceof ActionError && error.code === 'repository_access_lost'
            ? 'Repository read access is unavailable. This message was not dispatched. Historical conversation is preserved.'
            : 'Goal rejected. Refresh the conversation before editing or sending another goal.',
      });
      await this.reconcile();
      throw error;
    }
    await this.pendingStore?.clear();
    this.patch({pendingPrompt: null, notice: this.value.conversation?.kind === 'project' ? 'Message accepted.' : 'Goal accepted.'});
    await this.reconcile();
  }
  async resolve(decision: Decision) {
    try { await this.request(`/${this.id}/decision`, decision); }
    catch (error) {
      const retryable = error instanceof ActionError && (error.status >= 500 || error.code.includes('retry_same_request'));
      this.patch({notice: retryable
        ? 'Decision acknowledgement unavailable. Refresh before retrying the same choice.'
        : error instanceof ActionError && error.status === 409
          ? 'Conflict. This request is stale or already answered. Refreshing.'
          : 'Decision rejected. Check your credential and conversation access.'});
      await this.reconcile();
      throw error;
    }
    this.patch({notice: 'Decision accepted. Waiting for authoritative state.'});
    await this.reconcile();
  }
  async cancel() {
    try { await this.request(`/${this.id}/cancel`, {}); }
    catch (error) {
      this.patch({notice: 'Cancellation acknowledgement unavailable. Refresh before retrying cancellation.'});
      await this.reconcile();
      throw error;
    }
    this.patch({notice: 'Cancellation requested. Waiting for persisted outcome.'});
    await this.reconcile();
  }
}
