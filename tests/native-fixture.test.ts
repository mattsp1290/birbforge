import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath, URL} from 'node:url';
import {runInNewContext} from 'node:vm';
import type {HttpAgentFetchFn} from '@ag-ui/client';
import {createFixtureTransport} from './native-fixture/driver';
import {VerificationClient, VerificationError} from '../app/src/verification';
import {VerificationAdmission, VerificationCancellation, VerificationRequest, VerificationSnapshot} from '../app/src/verification-contract';

const conversationId = randomUUID();
const candidate = 'a'.repeat(40);
const plan = 'b'.repeat(64);
function initial() {
  return VerificationSnapshot.parse({
    installed: {candidate_commit: candidate, approved_plan_sha256: plan, policy_revision: 'c'.repeat(40), environment: 'fixture-local'},
    revision: 0, observation_id: randomUUID(), requests: [], recoveries: [],
    environment: {state: 'free', attempt_id: null, stopped: true, cleanup_complete: true},
  });
}
function row(command: VerificationAdmission) {
  return VerificationRequest.parse({
    request_id: command.request_id, idempotency_key: command.idempotency_key, conversation_id: conversationId,
    principal: 'owner', request_sha256: 'd'.repeat(64), candidate_commit: command.candidate_commit,
    plan_sha256: command.approved_plan_sha256, revision: 1, phase: 'queued', cancellation: 'none',
    cancellation_command_ids: [], attempt_id: null, outcome: null, manifest: null,
    eligibility: {eligible: false, reason: 'not_passed'},
  });
}
function admission() {
  return VerificationAdmission.parse({request_id: randomUUID(), idempotency_key: randomUUID(), candidate_commit: candidate, approved_plan_sha256: plan});
}
async function fixtureServer() {
  let current = initial();
  const submitted: unknown[] = [];
  let effects = 0;
  const server = createServer(async (request, response) => {
    const reply = (value: unknown, status = 200) => {response.writeHead(status, {'Content-Type': 'application/json'}); response.end(JSON.stringify(value));};
    if (request.method === 'GET') return reply(current);
    let input = '';
    for await (const chunk of request) input += String(chunk);
    const raw: unknown = JSON.parse(input);
    submitted.push(raw);
    if (request.url?.endsWith('/cancel')) {
      const command = VerificationCancellation.parse(raw);
      const previous = current.requests.find(value => value.request_id === command.request_id);
      if (!previous) return reply({code: 'unknown_request'}, 404);
      const updated = {...previous, revision: previous.revision + 1, cancellation: 'requested', cancellation_command_ids: [command.command_id]};
      current = VerificationSnapshot.parse({...current, revision: current.revision + 1, requests: [updated]});
      effects++;
      return reply(updated);
    }
    const command = VerificationAdmission.safeParse(raw);
    if (!command.success) return reply({code: 'invalid_command'}, 400);
    const accepted = row(command.data);
    current = {...current, revision: current.revision + 1, requests: [...current.requests, accepted]};
    effects++;
    reply(accepted);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    snapshot: () => current, submitted, effects: () => effects,
    close: async () => {server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));},
  };
}

test('one real accepted HTTP admission loses only its reply; the unmodified client reconciles without resubmission', async () => {
  const server = await fixtureServer();
  const driver = createFixtureTransport({upstream: fetch});
  const client = new VerificationClient({url: server.url, access: {kind: 'bearer', token: 'private-test-token'}, conversationId, transport: driver.transport});
  try {
    await client.refresh();
    driver.arm({kind: 'lose-reply', action: 'admission'});
    const ids = {requestId: randomUUID(), idempotencyKey: randomUUID()};
    await assert.rejects(client.admit(ids), error => error instanceof VerificationError && error.status === 503);
    assert.equal(client.getSnapshot().pending?.body.request_id, ids.requestId);
    assert.equal(driver.getSnapshot().receipts[0]?.result, 'reply-suppressed');
    assert.equal(driver.getSnapshot().receipts[0]?.status, 200);
    assert.equal(server.snapshot().requests[0]?.request_id, ids.requestId);
    const retry = client.retry();
    assert.equal(client.getSnapshot().pending?.body.request_id, ids.requestId);
    driver.releaseObservations();
    await retry;
    assert.equal(client.getSnapshot().pending, null);
    assert.equal(server.submitted.length, 1);
    assert.equal(server.effects(), 1);
    assert.equal(driver.getSnapshot().posts[0]?.count, 1);
    await client.admit({requestId: randomUUID(), idempotencyKey: randomUUID()});
    assert.equal(server.effects(), 2);
    assert.equal(driver.getSnapshot().receipts.length, 1);
    assert.ok(!JSON.stringify(driver.getSnapshot()).includes('private-test-token'));
  } finally {driver.releaseObservations(); client.disconnect(); await server.close();}
});

test('accepted cancellation reconciles its original command identity after native-style reply suppression', async () => {
  const server = await fixtureServer();
  const driver = createFixtureTransport({upstream: fetch});
  const client = new VerificationClient({url: server.url, access: {kind: 'bearer', token: 'private-test-token'}, conversationId, transport: driver.transport});
  try {
    await client.refresh();
    const requestId = randomUUID();
    await client.admit({requestId, idempotencyKey: randomUUID()});
    driver.arm({kind: 'lose-reply', action: 'cancellation'});
    const commandId = randomUUID();
    await assert.rejects(client.cancel({requestId, commandId}));
    assert.equal(driver.getSnapshot().receipts[0]?.commandId, commandId);
    assert.equal(client.getSnapshot().pending?.kind, 'cancellation');
    driver.releaseObservations();
    await client.retry();
    assert.equal(client.getSnapshot().pending, null);
    assert.equal(client.getSnapshot().snapshot?.requests[0]?.cancellation, 'requested');
    assert.equal(server.submitted.length, 2);
    assert.equal(server.effects(), 2);
    assert.equal(driver.getSnapshot().posts.find(value => value.commandId === commandId)?.count, 1);
  } finally {driver.releaseObservations(); client.disconnect(); await server.close();}
});

test('forged authority crosses real HTTP, returns the actual rejection, and leaves authoritative state unchanged', async () => {
  const server = await fixtureServer();
  const driver = createFixtureTransport({upstream: fetch});
  const client = new VerificationClient({url: server.url, access: {kind: 'bearer', token: 'private-test-token'}, conversationId, transport: driver.transport});
  try {
    await client.refresh();
    const before = structuredClone(server.snapshot());
    driver.arm({kind: 'forge-authority', action: 'admission'});
    await assert.rejects(client.admit({requestId: randomUUID(), idempotencyKey: randomUUID()}), error => error instanceof VerificationError && error.status === 400 && error.code === 'invalid_command');
    assert.equal(driver.getSnapshot().receipts[0]?.status, 400);
    assert.equal(driver.getSnapshot().receipts[0]?.result, 'response-returned');
    assert.equal(server.submitted.length, 1);
    assert.equal(VerificationAdmission.safeParse(server.submitted[0]).success, false);
    assert.deepEqual(server.snapshot(), before);
    assert.equal(server.effects(), 0);
    assert.equal(client.getSnapshot().pending, null);
  } finally {driver.releaseObservations(); client.disconnect(); await server.close();}
});

test('a rejected command is never called a suppressed successful reply and its response is not consumed', async () => {
  const response = new Response(JSON.stringify({code: 'invalid_command'}), {status: 400});
  const driver = createFixtureTransport({upstream: async () => response});
  driver.arm({kind: 'lose-reply', action: 'admission'});
  const result = await driver.transport(`http://fixture/api/conversations/${conversationId}/verification`, {method: 'POST', body: JSON.stringify(admission())});
  assert.equal(result, response);
  assert.equal(result.bodyUsed, false);
  assert.equal(driver.getSnapshot().receipts[0]?.result, 'response-returned');
  assert.equal(driver.getSnapshot().observations, 'flowing');
});

test('a successful forged command is an explicit acceptance failure and changes exactly one authority field', async () => {
  const command = admission();
  let submitted: unknown;
  const response = new Response(JSON.stringify(row(command)));
  const driver = createFixtureTransport({upstream: async (_url, init) => {submitted = JSON.parse(String(init.body)); return response;}});
  driver.arm({kind: 'forge-authority', action: 'admission'});
  const actual = await driver.transport(`http://fixture/api/conversations/${conversationId}/verification`, {method: 'POST', body: JSON.stringify(command)});
  assert.equal(actual, response);
  assert.equal(actual.bodyUsed, false);
  assert.deepEqual(submitted, {...command, actor: 'owner'});
  assert.equal(driver.getSnapshot().receipts[0]?.result, 'forge-accepted');
  assert.equal(driver.getSnapshot().receipts[0]?.status, 200);
});

test('a different successful receipt fails the stimulus rather than claiming lost acknowledgement proof', async () => {
  const driver = createFixtureTransport({upstream: async () => new Response(JSON.stringify(row(admission())))});
  driver.arm({kind: 'lose-reply', action: 'admission'});
  await assert.rejects(driver.transport(`http://fixture/api/conversations/${conversationId}/verification`, {method: 'POST', body: JSON.stringify(admission())}));
  assert.equal(driver.getSnapshot().receipts[0]?.result, 'receipt-mismatch');
  assert.equal(driver.getSnapshot().observations, 'flowing');
});

test('loss forwards original command bytes and options unchanged while unrelated observations remain available', async () => {
  const command = admission();
  const options = {method: 'POST', body: JSON.stringify(command, null, 2), headers: {Authorization: 'Bearer private-test-token'}};
  let received: RequestInit | undefined;
  const driver = createFixtureTransport({upstream: async (_url, init) => {
    if (init.method === 'POST') {received = init; return new Response(JSON.stringify(row(command)));}
    return new Response('{}');
  }});
  try {
    driver.arm({kind: 'lose-reply', action: 'admission'});
    await assert.rejects(driver.transport(`http://fixture/api/conversations/${conversationId}/verification`, options));
    assert.equal(received, options);
    assert.equal(received?.body, options.body);
    const other = await driver.transport(`http://fixture/api/conversations/${randomUUID()}/verification`, {});
    assert.equal(other.status, 200);
    assert.equal(driver.getSnapshot().observations, 'held');
    assert.ok(!JSON.stringify(driver.getSnapshot()).includes('private-test-token'));
  } finally {driver.releaseObservations();}
});

test('observations already in flight are held, abort promptly, and cannot keep the fixture held indefinitely', {timeout: 2000}, async () => {
  const command = admission();
  let finishObservation: (response: Response) => void = () => {};
  let enteredObservation: () => void = () => {};
  let bodyCancelled = false;
  const entered = new Promise<void>(resolve => {enteredObservation = resolve;});
  const response = new Promise<Response>(resolve => {finishObservation = resolve;});
  const upstream: HttpAgentFetchFn = async (_url, init) => {
    if (init.method === 'POST') return new Response(JSON.stringify(row(command)));
    enteredObservation();
    return response;
  };
  const driver = createFixtureTransport({upstream, holdMs: 80});
  const path = `http://fixture/api/conversations/${conversationId}/verification`;
  const abort = new AbortController();
  const observation = driver.transport(path, {signal: abort.signal});
  const rejected = assert.rejects(observation, /aborted/);
  await entered;
  driver.arm({kind: 'lose-reply', action: 'admission'});
  await assert.rejects(driver.transport(path, {method: 'POST', body: JSON.stringify(command)}));
  finishObservation(new Response(new ReadableStream({cancel() {bodyCancelled = true;}})));
  const released = new Promise<void>(resolve => {
    const unsubscribe = driver.subscribe(() => {
      if (driver.getSnapshot().observations === 'flowing') {unsubscribe(); resolve();}
    });
  });
  abort.abort();
  await rejected;
  assert.equal(bodyCancelled, true);
  assert.equal(driver.getSnapshot().observations, 'held');
  await released;
  assert.equal(driver.getSnapshot().observations, 'flowing');
});

test('arming is single-use and irrelevant conversation events cannot consume a command stimulus', async () => {
  let calls = 0;
  const driver = createFixtureTransport({upstream: async () => {calls++; return new Response('{}');}});
  driver.arm({kind: 'forge-authority', action: 'admission'});
  assert.throws(() => driver.arm({kind: 'lose-reply', action: 'admission'}));
  await driver.transport(`http://fixture/api/conversations/${conversationId}/verification/events`, {method: 'POST', body: '{}'});
  assert.equal(driver.getSnapshot().command.kind, 'armed');
  assert.equal(driver.getSnapshot().receipts.length, 0);
  assert.equal(calls, 1);
});

type Resolution = {type: string; filePath: string};
type Resolver = (context: {originModulePath: string; resolveRequest: Resolver}, moduleName: string, platform: string) => Resolution;
function loadMetro(env: Record<string, string>, previous?: Resolver) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config: {resolver: {resolveRequest?: Resolver}} = {resolver: previous ? {resolveRequest: previous} : {}};
  const module = {exports: config};
  runInNewContext(readFileSync(new URL('../metro.config.cjs', import.meta.url), 'utf8'), {
    module, __dirname: root, process: {env},
    require(name: string) {
      if (name === 'node:path') return path;
      if (name === 'expo/metro-config') return {getDefaultConfig: () => config};
      throw new Error('Unexpected Metro dependency');
    },
  });
  return {root, config: module.exports};
}

test('Metro fixture guards require matching explicit entry and opt-in; production default remains untouched', () => {
  const baseline = loadMetro({});
  assert.equal(baseline.config.resolver.resolveRequest, undefined);
  const entry = path.join(baseline.root, 'tests/native-fixture/index.tsx');
  assert.throws(() => loadMetro({ENTRY_FILE: entry}), /BIRBFORGE_NATIVE_FIXTURE/);
  assert.throws(() => loadMetro({BIRBFORGE_NATIVE_FIXTURE: '1'}), /ENTRY_FILE/);
  assert.throws(() => loadMetro({BIRBFORGE_NATIVE_FIXTURE: '1', ENTRY_FILE: path.join(baseline.root, 'app/index.ts')}), /ENTRY_FILE/);
});

test('Metro redirects the iOS goal and project conversation transport imports and preserves the previous resolver', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const previous: Resolver = (_context, moduleName) => ({type: 'sourceFile', filePath: `previous/${moduleName}`});
  const {config} = loadMetro({BIRBFORGE_NATIVE_FIXTURE: '1', ENTRY_FILE: path.join(root, 'tests/native-fixture/index.tsx')}, previous);
  const resolve = config.resolver.resolveRequest;
  assert.ok(resolve);
  const context = {originModulePath: path.join(root, 'app/App.tsx'), resolveRequest: () => {throw new Error('Previous resolver bypassed');}};
  assert.equal(resolve(context, './src/transport', 'ios').filePath, path.join(root, 'tests/native-fixture/transport.native.ts'));
  const goal = {...context, originModulePath: path.join(root, 'app/src/GoalWorkflows.tsx')};
  assert.equal(resolve(goal, './transport', 'ios').filePath, path.join(root, 'tests/native-fixture/transport.native.ts'));
  assert.equal(resolve({...goal, originModulePath: path.join(root, 'app/src/ChatScreen.tsx')}, './transport', 'ios').filePath, 'previous/./transport');
  assert.equal(resolve(context, './src/controller', 'ios').filePath, 'previous/./src/controller');
  assert.equal(resolve({...context, originModulePath: path.join(root, 'tests/native-fixture/transport.native.ts')}, '../../app/src/transport.native', 'ios').filePath, 'previous/../../app/src/transport.native');
  assert.throws(() => resolve(context, './src/transport', 'web'), /only the iOS/);
  assert.throws(() => resolve(context, './src/transport', 'android'), /only the iOS/);
});

test('Metro delegates to its context resolver when Expo supplied no previous resolver', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const {config} = loadMetro({BIRBFORGE_NATIVE_FIXTURE: '1', ENTRY_FILE: path.join(root, 'tests/native-fixture/index.tsx')});
  const resolve = config.resolver.resolveRequest;
  assert.ok(resolve);
  const context = {originModulePath: path.join(root, 'app/App.tsx'), resolveRequest: (_context: unknown, moduleName: string) => ({type: 'sourceFile', filePath: moduleName})};
  assert.equal(resolve(context, 'react', 'ios').filePath, 'react');
});
