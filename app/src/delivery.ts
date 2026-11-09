import {HttpAgent, type HttpAgentFetchFn} from '@ag-ui/client';
import {z} from 'zod/v4';
import {DeliveryCommand, DeliverySnapshot} from './delivery-contract';

type State = {snapshot: DeliverySnapshot | null; pending: DeliveryCommand | null; connected: boolean; sending: boolean; notice: string};
export class DeliveryClient {
  private state: State = {snapshot: null, pending: null, connected: false, sending: false, notice: ''};
  private listeners = new Set<() => void>();
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private agent: HttpAgent | null = null;
  private readonly path: string;
  constructor(private options: {url: string; token: string; conversationId: string; transport: HttpAgentFetchFn}) {
    this.path = `${options.url}/api/conversations/${options.conversationId}/delivery`;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private patch(value: Partial<State>) {this.state = {...this.state, ...value}; this.listeners.forEach(listener => listener());}
  private accept(snapshot: DeliverySnapshot) {
    if (snapshot.revision < (this.state.snapshot?.revision ?? -1)) return;
    const resolved = this.state.pending && snapshot.command_ids.includes(this.state.pending.command_id);
    this.patch({snapshot, connected: true, ...(resolved ? {pending: null, notice: 'Action recorded.'} : {})});
  }
  disconnect() {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.agent?.abortRun(); this.agent = null;
    this.patch({connected: false});
  }
  connect() {this.disconnect(); void this.observe(this.generation);}
  private async observe(generation: number) {
    const agent = new HttpAgent({url: this.path + '/events', threadId: this.options.conversationId,
      headers: {Authorization: `Bearer ${this.options.token}`}, fetch: this.options.transport});
    this.agent = agent;
    agent.subscribe({onEvent: ({event}) => {
      if (generation === this.generation && event.type === 'STATE_SNAPSHOT') this.accept(z.object({delivery: DeliverySnapshot}).parse(event.snapshot).delivery);
    }});
    const timeout = setTimeout(() => agent.abortRun(), 30_000);
    try {await agent.runAgent();}
    catch {if (generation === this.generation) this.patch({connected: false, notice: 'Connection lost. Reconnecting without repeating an action.'});}
    finally {clearTimeout(timeout);}
    if (generation === this.generation) this.timer = setTimeout(() => {void this.observe(generation);}, 1500);
  }
  async act(action: DeliveryCommand['action'], commandId: string) {
    if (this.state.pending || this.state.sending || !this.state.snapshot || !this.state.connected) return;
    const command = DeliveryCommand.parse({action, command_id: commandId, expected_revision: this.state.snapshot.revision, offer_sha256: this.state.snapshot.offer_sha256});
    this.patch({pending: command});
    await this.retry();
  }
  async retry() {
    const pending = this.state.pending;
    if (!pending || this.state.sending) return;
    this.patch({sending: true});
    const generation = this.generation;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 30_000);
    try {
      const response = await this.options.transport(this.path + '/command', {method: 'POST',
        headers: {Authorization: `Bearer ${this.options.token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(pending), signal: abort.signal});
      if (generation !== this.generation) return;
      if (response.ok) {this.accept(DeliverySnapshot.parse(await response.json())); this.patch({pending: null, notice: 'Action recorded.'});}
      else if (response.status < 500) this.patch({pending: null, notice: 'Action rejected. Reconnect to inspect the current decision.'});
      else this.patch({notice: 'Acknowledgement unknown. Retry the unchanged action or reconnect to reconcile.'});
    } catch {if (generation === this.generation) this.patch({notice: 'Acknowledgement unknown. Retry the unchanged action or reconnect to reconcile.'});}
    finally {clearTimeout(timeout); this.patch({sending: false});}
  }
}
