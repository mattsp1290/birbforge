import type {HttpAgentFetchFn} from '@ag-ui/client';
import {z} from 'zod/v4';
import {VerificationAdmission, VerificationCancellation, VerificationRequest} from '../../app/src/verification-contract';

export type Stimulus =
  | {kind: 'lose-reply'; action: 'admission' | 'cancellation'}
  | {kind: 'forge-authority'; action: 'admission'};
type Command =
  | {kind: 'admission'; body: VerificationAdmission}
  | {kind: 'cancellation'; body: VerificationCancellation};
export type Receipt = {
  sequence: number;
  stimulus: Stimulus['kind'];
  action: Command['kind'];
  requestId: string;
  commandId: string | null;
  idempotencyKey: string | null;
  status: number | null;
  result: 'reply-suppressed' | 'response-returned' | 'forge-accepted' | 'receipt-mismatch' | 'transport-failed';
};
type Selection = {stimulus: Stimulus; command: Command; path: string; conversationId: string};
type CommandState =
  | {kind: 'idle'}
  | {kind: 'armed'; stimulus: Stimulus}
  | {kind: 'sending'; selection: Selection}
  | {kind: 'complete'; receipt: Receipt};
type Hold = {path: string; done: Promise<void>; release: () => void; timer: ReturnType<typeof setTimeout>};
type PostCount = {requestId: string; commandId: string | null; idempotencyKey: string | null; count: number};
export type FixtureSnapshot = {command: CommandState; observations: 'held' | 'flowing'; receipts: readonly Receipt[]; posts: readonly PostCount[]};

export function createFixtureTransport({upstream, holdMs = 25_000}: {upstream: HttpAgentFetchFn; holdMs?: number}) {
  if (!Number.isInteger(holdMs) || holdMs < 1 || holdMs > 30_000) throw new Error('Invalid observation hold duration');
  let state: FixtureSnapshot = {command: {kind: 'idle'}, observations: 'flowing', receipts: [], posts: []};
  let hold: Hold | null = null;
  let sequence = 0;
  const listeners = new Set<() => void>();
  const publish = (next: FixtureSnapshot) => {state = next; listeners.forEach(listener => listener());};
  const releaseObservations = () => {
    if (!hold) return;
    const previous = hold;
    hold = null;
    clearTimeout(previous.timer);
    previous.release();
    publish({...state, observations: 'flowing'});
  };
  const beginHold = (path: string) => {
    let release: () => void = () => {};
    const done = new Promise<void>(resolve => {release = resolve;});
    hold = {path, done, release, timer: setTimeout(releaseObservations, holdMs)};
    publish({...state, observations: 'held'});
  };
  const waitForObservation = async (url: string, init: RequestInit) => {
    const current = hold;
    if (!current || !((url === current.path && (init.method ?? 'GET') === 'GET') || url === current.path + '/events')) return;
    const signal = init.signal;
    if (signal?.aborted) throw new TypeError('Fixture observation aborted');
    await new Promise<void>((resolve, reject) => {
      const aborted = () => {signal?.removeEventListener('abort', aborted); reject(new TypeError('Fixture observation aborted'));};
      signal?.addEventListener('abort', aborted, {once: true});
      void current.done.then(() => {signal?.removeEventListener('abort', aborted); resolve();});
    });
    if (signal?.aborted) throw new TypeError('Fixture observation aborted');
  };
  const finish = (selected: Selection, status: number | null, result: Receipt['result']) => {
    const receipt: Receipt = {
      sequence: ++sequence, stimulus: selected.stimulus.kind, action: selected.command.kind,
      requestId: selected.command.body.request_id,
      commandId: selected.command.kind === 'cancellation' ? selected.command.body.command_id : null,
      idempotencyKey: selected.command.kind === 'admission' ? selected.command.body.idempotency_key : null,
      status, result,
    };
    publish({...state, command: {kind: 'complete', receipt}, receipts: [...state.receipts.slice(-15), receipt]});
  };
  const readCommand = (url: string, init: RequestInit): Omit<Selection, 'stimulus'> | null => {
    if (init.method !== 'POST') return null;
    const target = new URL(url);
    const match = /^\/api\/conversations\/([0-9a-f-]{36})\/verification(\/cancel)?$/.exec(target.pathname);
    if (!match || target.search || !z.string().uuid().safeParse(match[1]).success) return null;
    const action = match[2] ? 'cancellation' : 'admission';
    if (typeof init.body !== 'string') return null;
    let raw: unknown;
    try {raw = JSON.parse(init.body);} catch {return null;}
    const parsed = action === 'admission' ? VerificationAdmission.safeParse(raw) : VerificationCancellation.safeParse(raw);
    if (!parsed.success) return null;
    const command: Command = 'command_id' in parsed.data
      ? {kind: 'cancellation', body: parsed.data}
      : {kind: 'admission', body: parsed.data};
    return {command, path: `${target.origin}/api/conversations/${match[1]}/verification`, conversationId: match[1]};
  };
  const transport: HttpAgentFetchFn = async (url, init) => {
    const command = readCommand(url, init);
    const selected = command && state.command.kind === 'armed' && state.command.stimulus.action === command.command.kind
      ? {...command, stimulus: state.command.stimulus} : null;
    if (command) {
      const requestId = command.command.body.request_id;
      const commandId = command.command.kind === 'cancellation' ? command.command.body.command_id : null;
      const idempotencyKey = command.command.kind === 'admission' ? command.command.body.idempotency_key : null;
      const previous = state.posts.find(row => row.requestId === requestId && row.commandId === commandId && row.idempotencyKey === idempotencyKey);
      const next = {requestId, commandId, idempotencyKey, count: (previous?.count ?? 0) + 1};
      publish({...state, posts: [...state.posts.filter(row => row !== previous).slice(-127), next]});
    }
    if (!selected) {
      await waitForObservation(url, init);
      const response = await upstream(url, init);
      try {await waitForObservation(url, init);}
      catch (error) {
        try {await response.body?.cancel();} catch {}
        throw error;
      }
      return response;
    }
    publish({...state, command: {kind: 'sending', selection: selected}});
    if (selected.stimulus.kind === 'lose-reply') beginHold(selected.path);
    let response: Response;
    try {
      response = await upstream(url, selected.stimulus.kind === 'forge-authority'
        ? {...init, body: JSON.stringify({...selected.command.body, actor: 'owner'})}
        : init);
    } catch {
      finish(selected, null, 'transport-failed');
      releaseObservations();
      throw new TypeError('Fixture command transport failed');
    }
    if (selected.stimulus.kind === 'forge-authority' || !response.ok) {
      finish(selected, response.status, selected.stimulus.kind === 'forge-authority' && response.ok ? 'forge-accepted' : 'response-returned');
      releaseObservations();
      return response;
    }
    let raw: unknown;
    try {raw = await response.json();} catch {
      finish(selected, response.status, 'receipt-mismatch');
      releaseObservations();
      throw new TypeError('Fixture response did not validate');
    }
    const parsed = VerificationRequest.safeParse(raw);
    const original = selected.command;
    const matched = parsed.success && parsed.data.conversation_id === selected.conversationId && parsed.data.request_id === original.body.request_id && (
      original.kind === 'admission'
        ? parsed.data.idempotency_key === original.body.idempotency_key
          && parsed.data.candidate_commit === original.body.candidate_commit
          && parsed.data.plan_sha256 === original.body.approved_plan_sha256
        : parsed.data.cancellation_command_ids.includes(original.body.command_id));
    if (!matched || init.signal?.aborted) {
      finish(selected, response.status, 'receipt-mismatch');
      releaseObservations();
      throw new TypeError('Fixture response did not match the command');
    }
    finish(selected, response.status, 'reply-suppressed');
    throw new TypeError('Fixture suppressed one successful acknowledgement');
  };
  return {
    transport,
    arm(stimulus: Stimulus) {
      if (hold || state.command.kind === 'armed' || state.command.kind === 'sending') throw new Error('Finish the current fixture action first');
      publish({...state, command: {kind: 'armed', stimulus}});
    },
    releaseObservations,
    getSnapshot: () => state,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
  };
}
