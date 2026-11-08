import {HttpAgent, type HttpAgentFetchFn} from '@ag-ui/client';
import {z} from 'zod/v4';
import {VerificationAdmission, VerificationCancellation, VerificationSnapshot} from './verification-contract';

export type PendingVerification =
  | {readonly kind: 'admission'; readonly body: Readonly<VerificationAdmission>}
  | {readonly kind: 'cancellation'; readonly body: Readonly<VerificationCancellation>};
export type VerificationState = {
  availability: 'checking' | 'available' | 'disabled' | 'unavailable';
  connection: 'offline' | 'observing' | 'connected';
  snapshot: VerificationSnapshot | null;
  pending: PendingVerification | null;
  sending: boolean;
  notice: string;
};
export class VerificationError extends Error {
  constructor(readonly status: number, readonly code = '') {super(`Verification returned HTTP ${status}`);}
}
export class VerificationClient {
  private value: VerificationState = {availability: 'checking', connection: 'offline', snapshot: null, pending: null, sending: false, notice: ''};
  private listeners = new Set<() => void>();
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private agent: HttpAgent | null = null;
  private observation: Promise<void> = Promise.resolve();
  private reads = new Set<AbortController>();
  private credentialRejected = false;
  private attached = false;
  private readonly path: string;
  constructor(private readonly options: {url: string; token: string; conversationId: string; transport?: HttpAgentFetchFn}) {
    this.path = `${options.url}/api/conversations/${options.conversationId}/verification`;
  }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private patch(patch: Partial<VerificationState>) {
    this.value = {...this.value, ...patch};
    this.listeners.forEach(listener => listener());
  }
  private transport: HttpAgentFetchFn = (url, init) => (this.options.transport ?? globalThis.fetch)(url, init);
  private async request(suffix: string, body?: unknown) {
    const abort = new AbortController();
    if (body === undefined) this.reads.add(abort);
    const timeout = setTimeout(() => abort.abort(), 40_000);
    try {
      const response = await this.transport(this.path + suffix, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {Authorization: `Bearer ${this.options.token}`, 'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body), signal: abort.signal,
      });
      const value: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({code: z.string().optional()}).safeParse(value);
        throw new VerificationError(response.status, failure.success ? failure.data.code ?? '' : '');
      }
      return value;
    } catch (error) {
      if (error instanceof VerificationError) throw error;
      throw new VerificationError(503);
    } finally {clearTimeout(timeout); this.reads.delete(abort);}
  }
  private accept(snapshot: VerificationSnapshot, generation: number) {
    if (generation !== this.generation || snapshot.revision < (this.value.snapshot?.revision ?? -1)) return;
    if ((snapshot.target_revision ?? -1) < (this.value.snapshot?.target_revision ?? -1)) return;
    this.credentialRejected = false;
    const pending = this.value.pending;
    const matched = pending && snapshot.requests.some(row => pending.kind === 'admission'
      ? row.request_id === pending.body.request_id && row.idempotency_key === pending.body.idempotency_key && row.candidate_commit === pending.body.candidate_commit && row.plan_sha256 === pending.body.approved_plan_sha256
      : row.request_id === pending.body.request_id && row.cancellation_command_ids.includes(pending.body.command_id));
    this.patch({snapshot, availability: 'available', connection: this.attached ? 'connected' : 'offline',
      ...(this.value.availability === 'unavailable' ? {notice: pending ? 'Pending verification action needs reconciliation.' : ''} : {}),
      ...(matched ? {pending: null, notice: pending.kind === 'admission' ? 'Verification request accepted.' : 'Verification cancellation accepted. Waiting for the recorded outcome.'} : {}),
    });
  }
  private serialize(operation: () => Promise<void>) {
    const result = this.observation.then(operation);
    this.observation = result.catch(() => {});
    return result;
  }
  async refresh() {
    const generation = this.generation;
    return this.serialize(async () => {
      if (generation !== this.generation) return;
      try {this.accept(VerificationSnapshot.parse(await this.request('')), generation);}
      catch (error) {
        if (generation === this.generation) this.failed(error);
        throw error;
      }
    });
  }
  private failed(error: unknown) {
    this.credentialRejected = error instanceof VerificationError && error.status === 401;
    const disabled = error instanceof VerificationError && error.status === 404;
    if (disabled || this.credentialRejected) this.attached = false;
    this.patch({availability: disabled ? 'disabled' : 'unavailable', connection: 'offline',
      notice: disabled ? '' : this.credentialRejected ? 'Credential rejected. Return to connection settings to authenticate.' : 'Verification is unavailable. Pending actions keep their original identity.',
    });
  }
  disconnect() {
    this.attached = false;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.agent?.abortRun(); this.agent = null;
    this.reads.forEach(read => read.abort());
    this.patch({connection: 'offline'});
  }
  async connect() {
    this.disconnect();
    this.attached = true;
    const generation = this.generation;
    this.patch({connection: 'observing'});
    try {await this.refresh();} catch {}
    if (generation !== this.generation || this.value.availability === 'disabled' || this.credentialRejected) return;
    void this.observe(generation);
  }
  private async observe(generation: number) {
    await this.serialize(async () => {
      if (generation !== this.generation) return;
      let rejectedStatus: number | null = null;
      const agent = new HttpAgent({url: this.path + '/events', threadId: this.options.conversationId,
        headers: {Authorization: `Bearer ${this.options.token}`}, fetch: async (url, init) => {
          const response = await this.transport(url, init);
          if (!response.ok) rejectedStatus = response.status;
          return response;
        }});
      this.agent = agent;
      let received = false;
      agent.subscribe({onEvent: ({event}) => {
        if (generation !== this.generation) return;
        if (event.type === 'STATE_SNAPSHOT') {this.accept(z.object({verification: VerificationSnapshot}).parse(event.snapshot).verification, generation); received = true;}
      }});
      const timeout = setTimeout(() => agent.abortRun(), 40_000);
      try {
        await agent.runAgent();
        if (!received && generation === this.generation) throw new VerificationError(503);
      } catch (error) {if (generation === this.generation) this.failed(rejectedStatus === null ? error : new VerificationError(rejectedStatus));}
      finally {clearTimeout(timeout); if (this.agent === agent) this.agent = null;}
    });
    if (generation !== this.generation || this.value.availability === 'disabled' || this.credentialRejected) return;
    this.timer = setTimeout(() => {void this.observe(generation);}, 1500);
  }
  async admit(identities: {requestId: string; idempotencyKey: string}) {
    if (this.value.pending || this.value.sending) throw new Error('Resolve the pending verification action first');
    const installed = this.value.snapshot?.installed;
    if (!installed || this.value.availability !== 'available') throw new Error('Refresh verification first');
    const body = Object.freeze(VerificationAdmission.parse({request_id: identities.requestId, idempotency_key: identities.idempotencyKey,
      candidate_commit: installed.candidate_commit, approved_plan_sha256: installed.approved_plan_sha256}));
    const pending = Object.freeze({kind: 'admission', body} satisfies PendingVerification);
    this.patch({pending, sending: true});
    await this.send(pending);
  }
  async cancel(identities: {requestId: string; commandId: string}) {
    if (this.value.pending || this.value.sending) throw new Error('Resolve the pending verification action first');
    const row = this.value.snapshot?.requests.find(row => row.request_id === identities.requestId);
    if (!row || this.value.availability !== 'available') throw new Error('Refresh verification first');
    const body = Object.freeze(VerificationCancellation.parse({request_id: row.request_id, command_id: identities.commandId, expected_revision: row.revision}));
    const pending = Object.freeze({kind: 'cancellation', body} satisfies PendingVerification);
    this.patch({pending, sending: true});
    await this.send(pending);
  }
  async retry() {
    if (!this.value.pending || this.value.sending) return;
    const generation = this.generation;
    this.patch({sending: true});
    try {
      await this.refresh();
      const pending = this.value.pending;
      if (pending && generation === this.generation) await this.send(pending);
    } finally {this.patch({sending: false});}
  }
  private async send(pending: PendingVerification) {
    this.patch({sending: true});
    try {
      await this.request(pending.kind === 'admission' ? '' : '/cancel', pending.body);
      if (this.value.pending === pending) this.patch({pending: null, notice: pending.kind === 'admission' ? 'Verification request accepted.' : 'Verification cancellation accepted. Waiting for the recorded outcome.'});
    } catch (error) {
      const ambiguous = !(error instanceof VerificationError) || error.status >= 500;
      if (this.value.pending === pending) this.patch({pending: ambiguous ? pending : null, notice: ambiguous
        ? 'Acknowledgement unavailable. Refresh and retry the same verification action.'
        : 'Verification action rejected. Refresh before taking another action.'});
      throw error;
    } finally {this.patch({sending: false});}
    try {await this.refresh();} catch {}
  }
}
