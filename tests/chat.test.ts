import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createServer, type AddressInfo} from 'node:net';
import {chmod, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {Chat, ChatIndex, chiefId} from '../app/src/chat';
import type {Catalog} from '../app/src/catalog';
import type {FactoryStatus} from '../app/src/factory';
import {ChatConfigurationError, chatRuntime, createChatService} from '../server/chat';
import {gateway} from '../server/gateway';
import {workspace} from '../server/workspace';

test('workspace chats stay pinned, persist turns, and inspect current state within the selected agent’s assignments', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'birbforge-chat-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const agent = {id: randomUUID(), name: 'Robin', instructions: 'Review the mobile app.', projectIds: ['mobile']};
  const catalog: Catalog = {agents: [agent], projectsAvailable: true, projects: [
    {id: 'mobile', repositories: ['crew/ios']}, {id: 'billing', repositories: ['crew/billing']},
  ]};
  const factory: FactoryStatus = {gateway: 'online', runtime: 'ready', verification: 'installed', checkedAt: new Date().toISOString(),
    queue: {conversationId: randomUUID(), environment: 'ready', queued: 2, running: 1, finished: 4}};
  const options = {directory, mode: 'local' as const, catalog: async () => catalog, inspect: async () => factory};
  const service = createChatService(options);
  const create = {id: randomUUID(), agentId: agent.id};
  await service.handle('POST', '/api/chats', create);
  await service.handle('POST', '/api/chats', create);
  const index = ChatIndex.parse(await service.handle('GET', '/api/chats', undefined));
  assert.deepEqual(index.threads.map(thread => thread.id), [chiefId, create.id]);
  assert.equal(index.mode, 'local');

  const path = `/api/chats/${create.id}/messages`;
  const message = {id: randomUUID(), text: 'What are my assignments?'};
  const results = await Promise.all([service.handle('POST', path, message), service.handle('POST', path, message)]);
  const first = Chat.parse(results[0]);
  assert.equal(first.turns.length, 1);
  assert.match(first.turns[0].answer!, /crew\/ios/);
  assert.doesNotMatch(first.turns[0].answer!, /billing/);
  assert.equal(first.title, message.text);
  assert.deepEqual(results[0], results[1]);
  await assert.rejects(service.handle('POST', path, {...message, text: 'Changed'}), /message_conflict/);
  const restarted = createChatService(options);
  assert.deepEqual(await restarted.handle('GET', '/api/chats/' + create.id, undefined), first);

  const report = async () => Chat.parse(await service.handle('POST', '/api/chats/' + chiefId + '/messages', {id: randomUUID(), text: 'Factory status?'})).turns.at(-1)?.answer ?? '';
  assert.match(await report(), /2 queued, 1 running, 4 finished/);
  factory.runtime = 'unavailable';
  catalog.agents = [];
  assert.match(await report(), /runtime: unavailable/);
  await assert.rejects(service.handle('POST', path, {id: randomUUID(), text: 'Try again'}), /agent_removed/);
  assert.deepEqual(await service.handle('GET', '/api/chats/' + create.id, undefined), first);
});

const status: FactoryStatus = {gateway: 'online', runtime: 'ready', verification: 'unconfigured', queue: null, checkedAt: new Date().toISOString()};
const chiefPath = '/api/chats/' + chiefId + '/messages';

/** A stand-in for scripts/chat-agent.py that records how the gateway called it. */
async function runner(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'birbforge-chat-runner-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const python = join(directory, 'fixture-runner');
  const log = join(directory, 'calls.jsonl');
  await writeFile(python, `#!/usr/bin/env python3
import json, sys
payload = json.load(sys.stdin)
with open(${JSON.stringify(log)}, 'a') as calls:
    calls.write(json.dumps({'argv': sys.argv[1:], 'key': payload.get('providerKey')}) + '\\n')
mode = sys.argv[-1]
if mode == '--local':
    assert 'providerKey' not in payload
    print(json.dumps('Local runner answered'))
elif mode == '--live':
    assert payload.pop('providerKey') == 'test-provider-value'
    assert 'test-provider-value' not in json.dumps(payload)
    print(json.dumps('Live runner answered'))
else:
    sys.exit('unknown mode')
`, {mode: 0o700});
  const calls = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line) as {argv: string[]; key?: string});
  let reads = 0;
  const options = {directory, python, catalog: async () => ({agents: [], projects: [], projectsAvailable: false}), inspect: async () => status,
    providerKey: async (): Promise<string | undefined> => {reads++; return 'test-provider-value';}};
  return {directory, python, options, calls, reads: () => reads};
}

test('only live chat reads the configured provider credential', async t => {
  const {options, calls, reads} = await runner(t);
  const local = createChatService({...options, mode: 'local'});
  await local.handle('POST', chiefPath, {id: randomUUID(), text: 'Local report'});
  assert.equal(reads(), 0);
  assert.equal(ChatIndex.parse(await local.handle('GET', '/api/chats', undefined)).mode, 'local');
  const live = createChatService({...options, mode: 'live'});
  const chat = Chat.parse(await live.handle('POST', chiefPath, {id: randomUUID(), text: 'Live report'}));
  assert.equal(reads(), 1);
  assert.equal(ChatIndex.parse(await live.handle('GET', '/api/chats', undefined)).mode, 'live');
  assert.deepEqual(chat.turns.map(turn => turn.answer), ['Local runner answered', 'Live runner answered']);
  assert.doesNotMatch(JSON.stringify(chat), /test-provider-value/);
  // The runner is told the mode and nothing else: no attestation path is passed.
  assert.deepEqual((await calls()).map(call => call.argv.slice(-1)), [['--local'], ['--live']]);
  assert.ok((await calls()).every(call => call.argv.length === 3 && call.argv[0] === '-I' && call.argv[1].endsWith('scripts/chat-agent.py')));
});

test('live chat fails with the credential error and never answers from local inspection', async t => {
  const {options, calls} = await runner(t);
  const inspection = /Gateway: online\. Crew runtime: ready/;
  // A missing key is reported as such. No local answer is stored in its place.
  const noKey = createChatService({...options, mode: 'live', providerKey: async () => undefined});
  const turn = {id: randomUUID(), text: 'Report without a credential'};
  await assert.rejects(noKey.handle('POST', chiefPath, turn), /provider_secret_required/);
  await assert.rejects(noKey.handle('POST', chiefPath, turn), /provider_secret_required/);
  for (const blank of ['', ' ', '\n']) {
    await assert.rejects(createChatService({...options, mode: 'live', providerKey: async () => blank}).handle('POST', chiefPath, turn), /provider_secret_required/);
  }
  assert.deepEqual(await calls(), []);
  const pending = Chat.parse(await noKey.handle('GET', '/api/chats/' + chiefId, undefined));
  assert.deepEqual(pending.turns.map(item => item.answer), [null]);
  // A runner that fails is an error, not a fallback to the local model or the inspection text.
  await chmod(options.python, 0o600);
  const broken = createChatService({...options, mode: 'live'});
  await assert.rejects(broken.handle('POST', chiefPath, turn), /birbcrew_reply_unavailable/);
  assert.doesNotMatch(JSON.stringify(await broken.handle('GET', '/api/chats/' + chiefId, undefined)), inspection);
  await chmod(options.python, 0o700);
  // With the key back, the same pending turn is answered by the live runner.
  const restored = Chat.parse(await createChatService({...options, mode: 'live'}).handle('POST', chiefPath, turn));
  assert.deepEqual(restored.turns.map(item => item.answer), ['Live runner answered']);
  assert.deepEqual((await calls()).map(call => [call.argv.at(-1), call.key]), [['--live', 'test-provider-value']]);

  // Live mode cannot be constructed without its runner or its credential source, and no mode is ever assumed.
  const {python, providerKey, ...bare} = options;
  assert.throws(() => createChatService({...bare, mode: 'live', providerKey}), ChatConfigurationError);
  assert.throws(() => createChatService({...bare, mode: 'live', python}), ChatConfigurationError);
  for (const mode of [undefined, '', 'mock', 'test', 'LIVE', 'true', null]) {
    assert.throws(() => createChatService({...options, mode: mode as 'live'}), `mode ${String(mode)}`);
  }
  // Local mode without a runner keeps answering with the inspection text.
  const plain = Chat.parse(await createChatService({...bare, mode: 'local', directory: join(options.directory, 'plain')})
    .handle('POST', chiefPath, {id: randomUUID(), text: 'Status?'}));
  assert.match(plain.turns[0].answer!, inspection);
});

test('the gateway requires an explicit chat mode and a runnable Crew Python for live', async t => {
  const {python, directory} = await runner(t);
  assert.deepEqual(chatRuntime({BIRBFORGE_CHAT_MODE: 'live', BIRBFORGE_CHAT_PYTHON: python}), {mode: 'live', python});
  assert.deepEqual(chatRuntime({BIRBFORGE_CHAT_MODE: 'local', BIRBFORGE_CHAT_PYTHON: python}), {mode: 'local', python});
  assert.deepEqual(chatRuntime({BIRBFORGE_CHAT_MODE: 'local'}), {mode: 'local', python: undefined});
  // Absent is not local. Neither the runner nor the old attestation variable implies a mode.
  for (const env of [{}, {BIRBFORGE_CHAT_PYTHON: python}, {BIRBFORGE_CHAT_PYTHON: python, BIRBFORGE_CHAT_ATTESTATION: join(directory, 'opencode-go.json')}]) {
    assert.throws(() => chatRuntime(env), (error: Error) => error instanceof ChatConfigurationError && /Set BIRBFORGE_CHAT_MODE to live or local/.test(error.message));
  }
  for (const mode of ['', ' ', 'Live', 'LIVE', 'live ', 'mock', 'test', 'true', '1', 'project-live']) {
    assert.throws(() => chatRuntime({BIRBFORGE_CHAT_MODE: mode, BIRBFORGE_CHAT_PYTHON: python}),
      (error: Error) => error instanceof ChatConfigurationError && /must be exactly live or local/.test(error.message) && !error.message.includes(python), mode);
  }
  const notExecutable = join(directory, 'not-executable');
  await writeFile(notExecutable, '', {mode: 0o600});
  for (const missing of [undefined, '', 'python3', join(directory, 'absent'), notExecutable, directory]) {
    assert.throws(() => chatRuntime({BIRBFORGE_CHAT_MODE: 'live', BIRBFORGE_CHAT_PYTHON: missing}),
      (error: Error) => error instanceof ChatConfigurationError && /BIRBFORGE_CHAT_MODE=live requires BIRBFORGE_CHAT_PYTHON/.test(error.message), String(missing));
  }
});

test('a leftover attestation file in any state has no effect on live chat', async t => {
  const {options, python, directory, calls} = await runner(t);
  const statement = join(directory, 'opencode-go.json');
  // Every statement written here is past the removed 12-hour limit. None is one the removed gate accepted.
  const former = (hoursOld: number, extra: object = {}) => JSON.stringify({provider: 'opencode-go', account_path: 'fixture owner', evidence: 'fixture',
    extra_usage_disabled: true, eligible_coding_use: true, checked_at: new Date(Date.now() - hoursOld * 3600_000).toISOString(), ...extra});
  const states: [string, () => Promise<unknown>][] = [
    ['absent', () => rm(statement, {force: true})],
    ['one minute past the former limit', () => writeFile(statement, former(12.02))],
    ['a month old', () => writeFile(statement, former(24 * 30))],
    ['expired and stating Extra Usage is on', () => writeFile(statement, former(13, {extra_usage_disabled: false}))],
    ['not JSON', () => writeFile(statement, 'renew me')],
  ];
  for (const [state, arrange] of states) {
    await arrange();
    const runtime = chatRuntime({BIRBFORGE_CHAT_MODE: 'live', BIRBFORGE_CHAT_PYTHON: python, BIRBFORGE_CHAT_ATTESTATION: statement});
    assert.deepEqual(runtime, {mode: 'live', python}, state);
    const service = createChatService({...options, ...runtime, directory: join(directory, randomUUID())});
    const chat = Chat.parse(await service.handle('POST', chiefPath, {id: randomUUID(), text: 'Report'}));
    assert.equal(chat.turns[0].answer, 'Live runner answered', state);
  }
  assert.deepEqual((await calls()).map(call => call.argv.at(-1)), states.map(() => '--live'));
  assert.ok((await calls()).every(call => !call.argv.some(argument => argument.includes('opencode-go.json'))));
});

async function gatewayProcess(t: TestContext, env: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'birbforge-chat-startup-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const config = join(directory, 'clients.json');
  await writeFile(config, JSON.stringify({url: 'http://127.0.0.1:9', tokens: {owner: 'o'.repeat(32)}}), {mode: 0o600});
  const reserve = createServer().listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = (reserve.address() as AddressInfo).port;
  await new Promise(resolve => reserve.close(resolve));
  const ready = join(directory, 'ready.json');
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], {stdio: ['ignore', 'ignore', 'pipe'],
    env: {NODE_ENV: 'test', PATH: process.env.PATH ?? '/usr/bin:/bin', TSX_TSCONFIG_PATH: 'tsconfig.node.json', DD_TRACE_ENABLED: 'false', DD_INJECTION_ENABLED: 'false',
      DD_INSTRUMENTATION_TELEMETRY_ENABLED: 'false', BIRBFORGE_CLIENT_CONFIG: config, BIRBFORGE_PORT: String(port), BIRBFORGE_READY_FILE: ready, ...env}});
  let stderr = '';
  child.stderr.on('data', chunk => {stderr += chunk;});
  let code: number | null | undefined;
  const exited = once(child, 'exit').then(([value]) => {code = value as number | null;});
  t.after(async () => {child.kill('SIGKILL'); await exited;});
  let outcome: 'ready' | number | null | undefined;
  while (outcome === undefined) {
    if (code !== undefined) outcome = code;
    else if (await readFile(ready, 'utf8').then(() => true, () => false)) outcome = 'ready';
    else await new Promise(resolve => setTimeout(resolve, 50));
  }
  return {outcome, stderr: () => stderr, stop: async () => {child.kill('SIGTERM'); await exited;}};
}

test('the gateway process refuses to start without an explicit valid chat mode', {timeout: 120_000}, async t => {
  const {python, directory} = await runner(t);
  const statement = join(directory, 'opencode-go.json');
  await writeFile(statement, '{}');
  const refused: [Record<string, string>, RegExp][] = [
    [{}, /Set BIRBFORGE_CHAT_MODE to live or local/],
    [{BIRBFORGE_CHAT_PYTHON: python}, /Set BIRBFORGE_CHAT_MODE to live or local/],
    // The pre-removal production environment: a runner and an attestation path, and no mode.
    [{BIRBFORGE_CHAT_PYTHON: python, BIRBFORGE_CHAT_ATTESTATION: statement}, /BIRBFORGE_CHAT_ATTESTATION is no longer read/],
    [{BIRBFORGE_CHAT_MODE: 'mock', BIRBFORGE_CHAT_PYTHON: python}, /must be exactly live or local/],
    [{BIRBFORGE_CHAT_MODE: 'live'}, /BIRBFORGE_CHAT_MODE=live requires BIRBFORGE_CHAT_PYTHON/],
    [{BIRBFORGE_CHAT_MODE: 'live', BIRBFORGE_CHAT_PYTHON: join(directory, 'absent')}, /BIRBFORGE_CHAT_MODE=live requires BIRBFORGE_CHAT_PYTHON/],
  ];
  for (const [env, message] of refused) {
    const started = await gatewayProcess(t, env);
    assert.equal(started.outcome, 1, JSON.stringify(Object.keys(env)));
    assert.match(started.stderr(), /^Forge startup failed\. /);
    assert.match(started.stderr(), message);
    assert.ok(!started.stderr().includes(directory));
  }
  const accepted: Record<string, string>[] = [{BIRBFORGE_CHAT_MODE: 'live', BIRBFORGE_CHAT_PYTHON: python}, {BIRBFORGE_CHAT_MODE: 'local'}];
  for (const env of accepted) {
    const started = await gatewayProcess(t, env);
    assert.equal(started.outcome, 'ready', started.stderr());
    await started.stop();
  }
});

test('health reports the chat mode so a deployment can require live', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'birbforge-chat-health-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const {python} = await runner(t);
  const config = {url: 'http://127.0.0.1:9', tokens: {owner: 'o'.repeat(32)}, mode: 'proof' as const};
  for (const mode of ['live', 'local'] as const) {
    const server = gateway(config, undefined, workspace(config, {directory: join(directory, mode), chatMode: mode, python}));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => {server.closeAllConnections(); server.close();});
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {code: 'ready', chat: mode});
  }
});
