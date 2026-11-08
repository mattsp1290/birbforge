import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {HttpAgentFetchFn} from '@ag-ui/client';
import {VerificationClient, VerificationError} from '../app/src/verification';
import {VerificationAdmission, VerificationCancellation, VerificationRequest, VerificationSnapshot} from '../app/src/verification-contract';

const conversationId = randomUUID();
const candidate = 'a'.repeat(40);
const plan = 'b'.repeat(64);
function snapshot(overrides: Partial<VerificationSnapshot> = {}): VerificationSnapshot {
  return VerificationSnapshot.parse({
    installed: {candidate_commit: candidate, approved_plan_sha256: plan, policy_revision: 'c'.repeat(40), environment: 'fixture-local'},
    revision: 0, observation_id: randomUUID(), requests: [], recoveries: [],
    environment: {state: 'free', attempt_id: null, stopped: true, cleanup_complete: true}, ...overrides,
  });
}
function row(overrides: Partial<VerificationRequest> = {}): VerificationRequest {
  return VerificationRequest.parse({
    request_id: randomUUID(), idempotency_key: randomUUID(), conversation_id: conversationId,
    principal: 'owner', request_sha256: 'd'.repeat(64), candidate_commit: candidate, plan_sha256: plan,
    revision: 1, phase: 'queued', cancellation: 'none', cancellation_command_ids: [], attempt_id: null,
    outcome: null, manifest: null, eligibility: {eligible: false, reason: 'not_passed'}, ...overrides,
  });
}
function json(value: unknown, status = 200) {return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});}
function events(value: VerificationSnapshot) {
  const runId = randomUUID();
  const frames = [
    {type: 'RUN_STARTED', threadId: conversationId, runId},
    {type: 'STATE_SNAPSHOT', snapshot: {verification: value}},
    {type: 'RUN_FINISHED', threadId: conversationId, runId},
  ];
  return new Response(frames.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {headers: {'Content-Type': 'text/event-stream'}});
}
function client(transport: HttpAgentFetchFn) {return new VerificationClient({url: 'http://fixture', token: 'private-owner', conversationId, transport});}
function deferred<T>() {
  let resolve: (value: T) => void = () => {throw new Error('Not initialized');};
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}
async function until(predicate: () => boolean) {
  for (let n = 0; n < 100; n++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Client did not converge');
}

test('strict command schemas reject client authority and validate immutable source identities', () => {
  const admission = {request_id: randomUUID(), idempotency_key: randomUUID(), candidate_commit: candidate, approved_plan_sha256: plan};
  assert.deepEqual(VerificationAdmission.parse(admission), admission);
  for (const extra of [{actor: 'owner'}, {verdict: 'passed'}, {command: 'test'}, {policy_revision: candidate}]) {
    assert.equal(VerificationAdmission.safeParse({...admission, ...extra}).success, false);
  }
  assert.equal(VerificationAdmission.safeParse({...admission, candidate_commit: 'HEAD'}).success, false);
  assert.equal(VerificationCancellation.safeParse({request_id: randomUUID(), command_id: randomUUID(), expected_revision: -1}).success, false);
});

test('official point-in-time observations share state, accept fresh gates at the same revision, and never submit on reconnect', async () => {
  let current = snapshot({revision: 3, requests: [row({phase: 'terminal', outcome: 'passed', eligibility: {eligible: true, reason: 'eligible'}})]});
  const posts: string[] = [];
  let observations = 0;
  const c = client(async (url, init) => {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer private-owner');
    if (url.endsWith('/events')) {
      observations++;
      const input: unknown = JSON.parse(String(init.body));
      assert.ok(typeof input === 'object' && input !== null && 'messages' in input && Array.isArray(input.messages) && input.messages.length === 0);
      return events(current);
    }
    if (init.method === 'POST') posts.push(url);
    return json(current);
  });
  try {
    await c.connect();
    await until(() => observations === 1 && c.getSnapshot().snapshot?.revision === 3);
    assert.equal(c.getSnapshot().snapshot?.requests[0]?.outcome, 'passed');
    current = snapshot({revision: 2});
    await c.refresh();
    assert.equal(c.getSnapshot().snapshot?.revision, 3);
    const oldRow = c.getSnapshot().snapshot?.requests[0];
    assert.ok(oldRow);
    current = snapshot({revision: 3, requests: [{...oldRow, eligibility: {eligible: false, reason: 'evidence_unavailable_or_invalid'}}]});
    await c.refresh();
    assert.equal(c.getSnapshot().snapshot?.requests[0]?.eligibility.eligible, false);
    assert.equal(c.getSnapshot().snapshot?.requests[0]?.outcome, 'passed');
    c.disconnect();
    await c.connect();
    await until(() => observations === 2);
    assert.deepEqual(posts, []);
  } finally {c.disconnect();}
});

test('observation serialization and generation guards prevent a retired attachment from overwriting state', async () => {
  const first = deferred<Response>();
  let gets = 0;
  let concurrent = 0;
  let maximum = 0;
  const c = client(async () => {
    gets++; concurrent++; maximum = Math.max(maximum, concurrent);
    try {return gets === 1 ? await first.promise : json(snapshot({revision: 4}));}
    finally {concurrent--;}
  });
  const old = c.refresh();
  await until(() => gets === 1);
  c.disconnect();
  const fresh = c.refresh();
  first.resolve(json(snapshot({revision: 99})));
  await Promise.all([old, fresh]);
  assert.equal(maximum, 1);
  assert.equal(c.getSnapshot().snapshot?.revision, 4);
  c.disconnect();
});

test('ambiguous admission remains immutable and reconnect only observes; retry first reconciles its durable receipt', async () => {
  let current = snapshot();
  let posts = 0;
  const c = client(async (url, init) => {
    if (url.endsWith('/events')) return events(current);
    if (init.method === 'POST') {
      posts++;
      const body = VerificationAdmission.parse(JSON.parse(String(init.body)));
      current = snapshot({revision: 1, requests: [row({request_id: body.request_id, idempotency_key: body.idempotency_key, candidate_commit: body.candidate_commit, plan_sha256: body.approved_plan_sha256})]});
      throw new TypeError('Lost accepted admission acknowledgement');
    }
    return json(current);
  });
  try {
    await c.refresh();
    const identities = {requestId: randomUUID(), idempotencyKey: randomUUID()};
    await assert.rejects(c.admit(identities), error => error instanceof VerificationError && error.status === 503);
    const pending = c.getSnapshot().pending;
    assert.equal(pending?.kind, 'admission');
    assert.ok(Object.isFrozen(pending) && Object.isFrozen(pending.body));
    await c.connect();
    assert.equal(posts, 1);
    assert.equal(c.getSnapshot().pending, null);
    assert.equal(c.getSnapshot().snapshot?.requests[0]?.request_id, identities.requestId);
  } finally {c.disconnect();}
});

test('unresolved admission retries identical bytes after fresh observation, retaining original source after installation changes', async () => {
  let current = snapshot();
  const sent: string[] = [];
  const operations: string[] = [];
  let failRead = false;
  const c = client(async (_url, init) => {
    operations.push(init.method ?? 'GET');
    if (init.method === 'POST') {
      sent.push(String(init.body));
      if (sent.length === 1) throw new TypeError('Lost acknowledgement');
      return json(row());
    }
    if (failRead) return json({code: 'unavailable'}, 503);
    return json(current);
  });
  await c.refresh();
  await assert.rejects(c.admit({requestId: randomUUID(), idempotencyKey: randomUUID()}));
  const original = c.getSnapshot().pending;
  current = snapshot({installed: {...current.installed, candidate_commit: 'e'.repeat(40), approved_plan_sha256: 'f'.repeat(64)}});
  failRead = true;
  await assert.rejects(c.retry());
  assert.equal(sent.length, 1);
  assert.equal(c.getSnapshot().pending, original);
  failRead = false;
  operations.length = 0;
  await c.retry();
  assert.deepEqual(operations, ['GET', 'POST', 'GET']);
  assert.equal(sent[1], sent[0]);
  assert.equal(c.getSnapshot().pending, null);
  c.disconnect();
});

test('cancellation binds row revision and reconciles accepted command identity after lost acknowledgement', async () => {
  const request = row({revision: 7, phase: 'running', attempt_id: randomUUID()});
  let current = snapshot({revision: 12, requests: [request], environment: {state: 'active', attempt_id: request.attempt_id, stopped: false, cleanup_complete: false}});
  let posts = 0;
  const commandId = randomUUID();
  const c = client(async (_url, init) => {
    if (init.method === 'POST') {
      posts++;
      const body = VerificationCancellation.parse(JSON.parse(String(init.body)));
      assert.deepEqual(body, {request_id: request.request_id, command_id: commandId, expected_revision: 7});
      current = snapshot({...current, revision: 13, requests: [{...request, revision: 8, cancellation: 'requested', cancellation_command_ids: [commandId]}]});
      throw new TypeError('Lost cancellation acknowledgement');
    }
    return json(current);
  });
  await c.refresh();
  await assert.rejects(c.cancel({requestId: request.request_id, commandId}));
  assert.equal(c.getSnapshot().pending?.kind, 'cancellation');
  await c.retry();
  assert.equal(posts, 1);
  assert.equal(c.getSnapshot().pending, null);
  assert.equal(c.getSnapshot().snapshot?.requests[0]?.outcome, null);
  assert.equal(c.getSnapshot().snapshot?.environment.state, 'active');
  c.disconnect();
});

test('an unconfigured gateway disables verification quietly without observation polling or command submission', async () => {
  const operations: string[] = [];
  const c = client(async (url, init) => {operations.push(`${init.method} ${url}`); return json({code: 'verification_unavailable'}, 404);});
  await c.connect();
  assert.equal(c.getSnapshot().availability, 'disabled');
  assert.equal(c.getSnapshot().notice, '');
  assert.equal(operations.length, 1);
  assert.ok(operations[0]?.startsWith('GET '));
  await assert.rejects(c.admit({requestId: randomUUID(), idempotencyKey: randomUUID()}));
  assert.equal(operations.length, 1);
  c.disconnect();
});

test('a durable receipt observed while acknowledgement is in flight cannot be undone by the later lost reply', async () => {
  let current = snapshot();
  const acknowledgement = deferred<Response>();
  let posted = false;
  const c = client(async (_url, init) => {
    if (init.method === 'POST') {
      const body = VerificationAdmission.parse(JSON.parse(String(init.body)));
      current = snapshot({revision: 1, requests: [row({request_id: body.request_id, idempotency_key: body.idempotency_key})]});
      posted = true;
      return acknowledgement.promise;
    }
    return json(current);
  });
  await c.refresh();
  const command = c.admit({requestId: randomUUID(), idempotencyKey: randomUUID()});
  await until(() => posted);
  await c.refresh();
  assert.equal(c.getSnapshot().pending, null);
  acknowledgement.resolve(json({code: 'lost_acknowledgement'}, 503));
  await assert.rejects(command);
  assert.equal(c.getSnapshot().pending, null);
  assert.match(c.getSnapshot().notice, /request accepted/);
  c.disconnect();
});

test('unresolved cancellation retains its original expected revision and command identity after a newer observation', async () => {
  const request = row({revision: 7, phase: 'running', attempt_id: randomUUID()});
  let current = snapshot({revision: 12, requests: [request]});
  const commands: VerificationCancellation[] = [];
  const c = client(async (_url, init) => {
    if (init.method === 'POST') {
      const command = VerificationCancellation.parse(JSON.parse(String(init.body)));
      commands.push(command);
      if (commands.length === 1) return json({code: 'unavailable'}, 503);
      return json(request);
    }
    return json(current);
  });
  await c.refresh();
  await assert.rejects(c.cancel({requestId: request.request_id, commandId: randomUUID()}));
  current = snapshot({revision: 13, requests: [{...request, revision: 8}]});
  await c.retry();
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1], commands[0]);
  assert.equal(commands[1]?.expected_revision, 7);
  c.disconnect();
});

test('rejected credentials stop automatic observation until an explicit reconnect', async () => {
  let calls = 0;
  let valid = false;
  const c = client(async () => {
    calls++;
    return valid ? json(snapshot()) : json({code: 'authentication_required'}, 401);
  });
  try {
    await c.connect();
    await new Promise(resolve => setTimeout(resolve, 1700));
    assert.equal(calls, 1);
    assert.match(c.getSnapshot().notice, /Credential rejected/);
    valid = true;
    await c.refresh();
    assert.equal(c.getSnapshot().availability, 'available');
  } finally {c.disconnect();}
});

test('credential rejection on an AG-UI observation stops the recurring observation loop', async () => {
  let observations = 0;
  const c = client(async (url) => {
    if (url.endsWith('/events')) {observations++; return json({code: 'authentication_required'}, 401);}
    return json(snapshot());
  });
  try {
    await c.connect();
    await new Promise(resolve => setTimeout(resolve, 1700));
    assert.equal(observations, 1);
    assert.equal(c.getSnapshot().availability, 'unavailable');
    assert.match(c.getSnapshot().notice, /Credential rejected/);
  } finally {c.disconnect();}
});

test('one-off refresh after disconnect does not claim an attached observation loop', async () => {
  const c = client(async () => json(snapshot()));
  try {
    c.disconnect();
    await c.refresh();
    assert.equal(c.getSnapshot().availability, 'available');
    assert.equal(c.getSnapshot().connection, 'offline');
    assert.ok(c.getSnapshot().snapshot);
  } finally {c.disconnect();}
});
