import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {chmod, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test, {type TestContext} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {Chat, ChatIndex, awaitingReply, ended, type MemberStatus} from '../app/src/chat';
import type {Agent, Catalog} from '../app/src/catalog';
import {CatalogService} from '../server/catalog';
import {createChatService} from '../server/chat';
import {GatewayConfig} from '../server/gateway';
import {memberSpawnId} from '../server/members';
import {workspace} from '../server/workspace';
import {startFakeCrew} from './crew-members-fake';

type Service = ReturnType<typeof createChatService>;

async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'birbforge-members-'));
  const token = randomBytes(32).toString('hex');
  const tokenFile = join(root, 'members-token');
  await writeFile(tokenFile, token + '\n', {mode: 0o600});
  const crew = await startFakeCrew(token, ['pi/fixture.v1', 'codex/fixture.v1']);
  const agent: Agent = {id: randomUUID(), name: 'Robin', instructions: 'Review the mobile app.', projectIds: ['mobile'], engine: 'pi'};
  const catalog: Catalog = {agents: [agent], projectsAvailable: true, projects: [
    {id: 'mobile', repositories: ['crew/ios']}, {id: 'billing', repositories: ['crew/billing']},
  ]};
  const members = {url: crew.url, token_file: tokenFile, profiles: {pi: 'fixture.v1', codex: 'fixture.v1'}};
  const options = {
    directory: join(root, 'workspace'), mode: 'local' as const, members, memberTiming: {retry: 5, maxRetry: 20, timeout: 300},
    catalog: async () => catalog, inspect: async () => {throw new Error('Member chats never inspect the factory');},
  };
  const services: Service[] = [];
  const start = (overrides: Partial<typeof options> = {}) => {
    const service = createChatService({...options, ...overrides});
    services.push(service);
    return service;
  };
  t.after(async () => {
    await Promise.all(services.map(service => service.stop()));
    await crew.close();
    await rm(root, {recursive: true, force: true});
  });
  return {crew, token, tokenFile, agent, catalog, options, start, root};
}

async function open(service: Service, agentId: string) {
  return Chat.parse(await service.handle('POST', '/api/chats', {id: randomUUID(), agentId}));
}
async function send(service: Service, chatId: string, text: string) {
  const message = {id: randomUUID(), text};
  const chat = Chat.parse(await service.handle('POST', `/api/chats/${chatId}/messages`, message));
  return {message, chat};
}
async function until(service: Service, chatId: string, turnId: string, statuses: MemberStatus[]) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const chat = Chat.parse(await service.handle('GET', '/api/chats/' + chatId, undefined));
    const turn = chat.turns.find(item => item.id === turnId);
    if (turn?.status && statuses.includes(turn.status)) return {chat, turn};
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${statuses.join(' or ')}; last ${turn?.status}`);
    await delay(5);
  }
}

test('a crew agent with an engine chats through a durable Crew member without holding the request open', async t => {
  const {crew, agent, catalog, options, start} = await setup(t);
  crew.steps = ['running', 'running', 'completed'];
  const service = start();
  await assert.rejects(service.handle('POST', '/api/chats', {id: randomUUID().toUpperCase(), agentId: agent.id}), /invalid_chat/);
  const thread = await open(service, agent.id);
  assert.equal(thread.engine, 'pi');
  await assert.rejects(service.handle('POST', `/api/chats/${thread.id}/messages`, {id: randomUUID().toUpperCase(), text: 'Upper'}), /invalid_message/);
  const outbox = new DatabaseSync(join(options.directory, 'workspace-chats.sqlite'), {readOnly: true});
  t.after(() => outbox.close());
  const committed: unknown[] = [];
  crew.onRequest = path => committed.push([path, outbox.prepare('SELECT state FROM member_turns WHERE thread=?').all(thread.id).map(row => ({...row}))]);
  const first = await send(service, thread.id, 'What are my assignments?');
  assert.deepEqual(first.chat.turns, [{...first.message, answer: null, status: 'pending'}]);
  assert.equal(first.chat.title, 'What are my assignments?');
  const done = await until(service, thread.id, first.message.id, ['completed']);
  assert.equal(done.turn.answer, 'Member reply: What are my assignments?');
  assert.deepEqual(committed[0], ['/v1/capabilities', [{state: 'queued'}]]);
  crew.onRequest = () => {};

  const [member] = [...crew.members.entries()];
  assert.deepEqual(member, [memberSpawnId(agent.id, 'pi', 'fixture.v1'), {memberId: member[1].memberId, engine: 'pi', profile: 'fixture.v1'}]);
  assert.equal(crew.conversations.get(thread.id), member[1].memberId);
  assert.equal(crew.submissions.length, 1);
  const [submitted] = crew.submissions;
  assert.equal(submitted.conversationId, thread.id);
  assert.equal(submitted.requestId, first.message.id);
  assert.match(submitted.text, /^<forge-agent-context>\n/);
  assert.match(submitted.text, /Robin: Review the mobile app\./);
  assert.match(submitted.text, /mobile: crew\/ios/);
  assert.doesNotMatch(submitted.text, /billing/);
  assert.ok(submitted.text.endsWith('</forge-agent-context>\n\nWhat are my assignments?'));

  const second = await send(service, thread.id, 'And next?');
  await until(service, thread.id, second.message.id, ['completed']);
  assert.equal(crew.submissions[1].text, 'And next?');
  assert.equal(crew.members.size, 1);
  const repeated = Chat.parse(await service.handle('POST', `/api/chats/${thread.id}/messages`, second.message));
  assert.equal(repeated.turns.length, 2);
  await assert.rejects(service.handle('POST', `/api/chats/${thread.id}/messages`, {...second.message, text: 'Changed'}), /message_conflict/);
  assert.equal(crew.submissions.length, 2);

  const verbose: Agent = {id: randomUUID(), name: 'Wren', instructions: '€'.repeat(2000), projectIds: [], engine: 'pi'};
  catalog.agents.push(verbose);
  const capped = await open(service, verbose.id);
  const long = '€'.repeat(4000);
  const sent = await send(service, capped.id, long);
  await until(service, capped.id, sent.message.id, ['completed']);
  const text = crew.submissions.at(-1)!.text;
  assert.ok(Buffer.byteLength(text) <= 16_384 && Buffer.byteLength(text) > 16_000);
  assert.ok(text.endsWith('\n[context truncated]\n</forge-agent-context>\n\n' + long));
  assert.doesNotMatch(text, /\uFFFD/);

  const nul: Agent = {id: randomUUID(), name: 'Tern', instructions: 'be \0 nice', projectIds: [], engine: 'pi'};
  catalog.agents.push(nul);
  crew.peak = 0;
  const parallel = await Promise.all([nul, verbose, agent].map(async item => {
    const chat = await open(service, item.id);
    return {chat, sent: await send(service, chat.id, 'In parallel')};
  }));
  for (const {chat, sent} of parallel) await until(service, chat.id, sent.message.id, ['completed']);
  assert.equal(crew.peak, 1);
  assert.ok(crew.submissions.some(item => item.text.includes('Tern: be  nice')));
});

test('a reply committed before the submit response arrives is stored once', async t => {
  const {crew, agent, start} = await setup(t);
  crew.submits.push('complete');
  const service = start();
  const thread = await open(service, agent.id);
  const {message} = await send(service, thread.id, 'Fast question');
  const {turn} = await until(service, thread.id, message.id, ['completed']);
  assert.equal(turn.answer, 'Member reply: Fast question');
  assert.equal(crew.submissions.length, 1);
});

test('ambiguous or transient submissions reconcile the same identity and payload', async t => {
  const {crew, agent, catalog, start} = await setup(t);
  const service = start();
  const cases = [
    {submit: 'lose-ack', sends: 1},
    {submit: 'hang', sends: 1},
    {submit: 'drop', sends: 2},
    {submit: {status: 503, error: 'retry_same_request'}, sends: 2},
    {submit: {status: 401, error: 'authentication_required'}, sends: 2},
    {submit: {status: 409, error: 'busy'}, sends: 2},
  ] as const;
  for (const {submit, sends} of cases) {
    crew.submits.push(submit);
    const thread = await open(service, agent.id);
    const {message} = await send(service, thread.id, 'Reconcile ' + JSON.stringify(submit));
    await until(service, thread.id, message.id, ['completed']);
    const attempts = crew.submissions.filter(item => item.conversationId === thread.id);
    assert.equal(attempts.length, sends, JSON.stringify(submit));
    assert.ok(attempts.every(item => item.requestId === message.id && item.text === attempts[0].text), JSON.stringify(submit));
  }

  crew.registered.splice(crew.registered.indexOf('pi/fixture.v1'), 1);
  const late: Agent = {...agent, id: randomUUID(), name: 'Kite'};
  catalog.agents.push(late);
  const thread = await open(service, late.id);
  const {message} = await send(service, thread.id, 'Before the worker registers its profile');
  await delay(60);
  assert.equal((await until(service, thread.id, message.id, ['pending'])).turn.status, 'pending');
  assert.equal(crew.conversations.has(thread.id), false);
  crew.registered.push('pi/fixture.v1');
  await until(service, thread.id, message.id, ['completed']);

  const spawn = memberSpawnId(agent.id, 'pi', 'fixture.v1');
  const lost = crew.members.get(spawn)!.memberId;
  crew.members.delete(spawn);
  const reset = await open(service, agent.id);
  const after = await send(service, reset.id, 'After Crew lost the member');
  await until(service, reset.id, after.message.id, ['completed']);
  assert.notEqual(crew.conversations.get(reset.id), lost);
  assert.equal(crew.conversations.get(reset.id), crew.members.get(spawn)!.memberId);
});

test('explicit rejections and terminal Crew outcomes are shown, closed, and never replayed', async t => {
  const {crew, agent, start} = await setup(t);
  const service = start();
  const outcomes = [
    {submit: {status: 409, error: 'conflict'}, steps: [], status: 'rejected'},
    {submit: {status: 400, error: 'invalid_input'}, steps: [], status: 'rejected'},
    {submit: {status: 409, error: 'request_rejected', record: true}, steps: ['failed'], status: 'failed'},
    {steps: ['failed'], status: 'failed'},
    {steps: ['running', 'cancelled'], status: 'cancelled'},
    {steps: ['uncertain'], status: 'uncertain'},
  ] as const;
  crew.reason = 'predecessor_failed';
  for (const outcome of outcomes) {
    if ('submit' in outcome) crew.submits.push(outcome.submit);
    crew.steps = [...outcome.steps];
    const thread = await open(service, agent.id);
    const {message} = await send(service, thread.id, 'Outcome ' + outcome.status);
    const {chat, turn} = await until(service, thread.id, message.id, [outcome.status]);
    assert.equal(turn.answer, null);
    assert.ok(ended(turn) && !awaitingReply(turn));
    await delay(60);
    assert.equal(crew.submissions.filter(item => item.conversationId === thread.id).length, 1, outcome.status);
    assert.deepEqual(Chat.parse(await service.handle('GET', '/api/chats/' + thread.id, undefined)), chat);
    await assert.rejects(send(service, thread.id, 'Try again'), /member_chat_closed/);
    assert.ok(crew.submissions.every(item => item.requestId === message.id || item.conversationId !== thread.id));
  }

  crew.steps = ['waiting'];
  const thread = await open(service, agent.id);
  const {message} = await send(service, thread.id, 'Needs a decision');
  const waiting = await until(service, thread.id, message.id, ['waiting']);
  assert.ok(awaitingReply(waiting.turn) && !ended(waiting.turn));
  await assert.rejects(send(service, thread.id, 'Another'), /reply_pending/);
  crew.requests.get(thread.id + '/' + message.id)!.steps.push('completed');
  await until(service, thread.id, message.id, ['completed']);
});

test('a restarted gateway reconciles a pending turn without creating a new request identity', async t => {
  const {crew, agent, start, options, root} = await setup(t);
  crew.submits.push('hang');
  const first = start();
  const thread = await open(first, agent.id);
  const started = Date.now();
  const sent = await send(first, thread.id, 'Survive a restart');
  assert.ok(Date.now() - started < 300, 'sending must not wait for Crew');
  assert.equal(sent.chat.turns[0].status, 'pending');
  for (let waited = 0; !crew.submissions.length && waited < 5000; waited += 5) await delay(5);
  await first.stop();
  assert.equal((await first.handle('GET', '/api/chats/' + thread.id, undefined) as Chat).turns[0].status, 'pending');
  const second = start();
  await until(second, thread.id, sent.message.id, ['completed']);
  assert.deepEqual(crew.submissions.map(item => item.requestId), [sent.message.id]);
  await second.stop();

  const unsent = start({members: {...options.members, token_file: join(root, 'missing-token')}});
  const later = await open(unsent, agent.id);
  const queued = await send(unsent, later.id, 'Never left the outbox');
  await delay(60);
  await unsent.stop();
  assert.equal(crew.submissions.filter(item => item.conversationId === later.id).length, 0);
  const third = start();
  await until(third, later.id, queued.message.id, ['completed']);
  assert.deepEqual(crew.submissions.filter(item => item.conversationId === later.id).map(item => item.requestId), [queued.message.id]);
});

test('changing an agent engine leaves existing threads on the member they opened with', async t => {
  const {crew, agent, catalog, start} = await setup(t);
  const service = start();
  const original = await open(service, agent.id);
  const before = await send(service, original.id, 'Hello Pi');
  await until(service, original.id, before.message.id, ['completed']);
  catalog.agents = [{...agent, engine: 'codex'}];
  const after = await send(service, original.id, 'Still Pi?');
  await until(service, original.id, after.message.id, ['completed']);
  const switched = await open(service, agent.id);
  assert.equal(switched.engine, 'codex');
  const codex = await send(service, switched.id, 'Hello Codex');
  await until(service, switched.id, codex.message.id, ['completed']);

  const memberOf = (engine: string) => [...crew.members.values()].find(member => member.engine === engine)!.memberId;
  assert.equal(crew.members.size, 2);
  assert.equal(crew.conversations.get(original.id), memberOf('pi'));
  assert.equal(crew.conversations.get(switched.id), memberOf('codex'));
  const index = ChatIndex.parse(await service.handle('GET', '/api/chats', undefined));
  assert.deepEqual(index.threads.filter(item => item.engine).map(item => [item.id, item.engine]).sort(),
    [[original.id, 'pi'], [switched.id, 'codex']].sort());
  assert.deepEqual(index.agents, [{id: agent.id, name: agent.name, engine: 'codex'}]);
});

test('without a members block chats and the catalog are byte-for-byte unchanged', async t => {
  const {agent, start, root} = await setup(t);
  const plain: Agent = {id: randomUUID(), name: 'Jay', instructions: '', projectIds: []};
  const catalog: Catalog = {agents: [plain], projects: [], projectsAvailable: true};
  async function transcript(service: Service) {
    const id = '0b4f1fb8-1f43-4c8e-9c69-6f9f3a1f6d1a';
    const message = {id: '7c1b8f7e-3f58-4c45-b4f8-1a1f0d4b2c3e', text: 'Show my assigned projects.'};
    return JSON.stringify([
      await service.handle('POST', '/api/chats', {id, agentId: plain.id}),
      await service.handle('POST', `/api/chats/${id}/messages`, message),
      await service.handle('GET', '/api/chats/' + id, undefined),
      await service.handle('GET', '/api/chats', undefined),
    ]);
  }
  const absent = start({members: undefined, directory: join(root, 'absent'), catalog: async () => catalog});
  const configured = start({directory: join(root, 'configured'), catalog: async () => catalog});
  const recorded = await transcript(absent);
  assert.equal(recorded, await transcript(configured));
  const [created, , read, index] = JSON.parse(recorded);
  assert.deepEqual(Object.keys(created), ['id', 'agentId', 'agentName', 'title', 'turns']);
  assert.deepEqual(Object.keys(read.turns[0]), ['id', 'text', 'answer']);
  assert.deepEqual(index.threads.map(Object.keys), [['id', 'agentId', 'agentName', 'title'], ['id', 'agentId', 'agentName', 'title']]);
  assert.deepEqual(index.agents, [{id: plain.id, name: 'Jay'}]);

  const withEngine = start({members: undefined, directory: join(root, 'disabled')});
  await assert.rejects(open(withEngine, agent.id), /engine_unavailable/);
  const bound = start({directory: join(root, 'bound')});
  const chat = await open(bound, agent.id);
  await bound.stop();
  const off = start({members: undefined, directory: join(root, 'bound')});
  await assert.rejects(send(off, chat.id, 'Hello'), /members_unconfigured/);
  assert.equal(Chat.parse(await off.handle('GET', '/api/chats/' + chat.id, undefined)).engine, 'pi');
  const plainCatalog = new CatalogService({directory: join(root, 'catalog')});
  assert.deepEqual(await plainCatalog.snapshot(), {projects: [], agents: [], projectsAvailable: false});
  await assert.rejects(plainCatalog.apply({kind: 'saveAgent', previous: null, agent: {...agent, projectIds: []}}), /engine_unavailable/);
});

test('the gateway offers only configured engines and validates the members block', async t => {
  const {options, root} = await setup(t);
  const agent: Agent = {id: randomUUID(), name: 'Finch', instructions: '', projectIds: [], engine: 'pi'};
  const base = {url: 'http://127.0.0.1:1', tokens: {owner: randomBytes(32).toString('hex')}};
  const members = {...options.members, profiles: {pi: 'fixture.v1'}};
  const config = GatewayConfig.parse({...base, members});
  const services = workspace(config, {directory: join(root, 'gateway'), chatMode: 'local'});
  t.after(() => services.chat.stop());
  assert.deepEqual((await services.catalog.snapshot()).engines, ['pi']);
  const saved = await services.catalog.apply({kind: 'saveAgent', previous: null, agent});
  assert.deepEqual(saved.agents, [agent]);
  await assert.rejects(services.catalog.apply({kind: 'saveAgent', previous: agent, agent: {...agent, engine: 'codex'}}), /engine_unavailable/);
  const {engine: _, ...legacy} = agent;
  assert.deepEqual((await services.catalog.apply({kind: 'saveAgent', previous: agent, agent: legacy})).agents, [legacy]);
  for (const url of ['http://localhost:4000', 'https://127.0.0.1:4000', 'http://127.0.0.1:4000/v1', 'http://127.0.0.1', 'http://127.0.0.1:70000']) {
    assert.equal(GatewayConfig.safeParse({...base, members: {...members, url}}).success, false, url);
  }
  assert.equal(GatewayConfig.safeParse({...base, members: {...members, token_file: 'members-token'}}).success, false);
  assert.equal(GatewayConfig.safeParse({...base, members: {...members, profiles: {}}}).success, false);
  assert.equal(GatewayConfig.safeParse({...base, members: {...members, profiles: {claude: 'fixture.v1'}}}).success, false);
});

test('the members token never reaches responses, errors or the chat database', async t => {
  const {crew, token, tokenFile, agent, options, start, root} = await setup(t);
  const link = join(root, 'members-token-link');
  await symlink(tokenFile, link);
  const linked = start({directory: join(root, 'linked'), members: {...options.members, token_file: link}});
  const refusedLink = await open(linked, agent.id);
  await send(linked, refusedLink.id, 'Through a symbolic link');
  await delay(60);
  assert.equal(crew.authorizations.size, 0);
  await linked.stop();
  const service = start();
  const outputs: unknown[] = [];
  const thread = await open(service, agent.id);
  const {message} = await send(service, thread.id, 'Hello');
  outputs.push(await until(service, thread.id, message.id, ['completed']));
  await chmod(tokenFile, 0o644);
  const exposed = await open(service, agent.id);
  const held = await send(service, exposed.id, 'Unprotected token');
  await delay(60);
  assert.equal(crew.submissions.filter(item => item.conversationId === exposed.id).length, 0);
  await chmod(tokenFile, 0o600);
  outputs.push(await until(service, exposed.id, held.message.id, ['completed']));
  crew.submits.push({status: 409, error: 'conflict'});
  const rejected = await open(service, agent.id);
  const refused = await send(service, rejected.id, 'Rejected');
  outputs.push(await until(service, rejected.id, refused.message.id, ['rejected']));
  outputs.push(await service.handle('GET', '/api/chats', undefined));
  outputs.push(await send(service, rejected.id, 'Closed').catch((error: Error) => error.message));
  assert.ok(crew.authorizations.has('Bearer ' + token));
  assert.doesNotMatch(JSON.stringify(outputs), new RegExp(token));
  for (const file of await readdir(options.directory)) {
    assert.equal((await readFile(join(options.directory, file))).includes(token), false, file);
  }
});

test('a thread at Crew’s turn limit asks for a new chat and an unsupported API version is never used', async t => {
  const {crew, agent, start} = await setup(t);
  crew.maximumTurns = 3;
  crew.apiVersion = '2';
  const service = start();
  const thread = await open(service, agent.id);
  const first = await send(service, thread.id, 'One');
  await delay(60);
  assert.equal(crew.members.size + crew.submissions.length, 0);
  crew.apiVersion = '1.4';
  await until(service, thread.id, first.message.id, ['completed']);
  crew.receiptVersion = '2';
  const second = await send(service, thread.id, 'Two');
  await delay(60);
  assert.equal((await until(service, thread.id, second.message.id, ['pending'])).turn.answer, null);
  crew.receiptVersion = '1';
  await until(service, thread.id, second.message.id, ['completed']);

  crew.submits.push('hang');
  const third = await send(service, thread.id, 'Three');
  for (let waited = 0; crew.submissions.length < 3 && waited < 5000; waited += 5) await delay(5);
  await service.stop();
  crew.maximumTurns = 2;
  const restarted = start();
  await until(restarted, thread.id, third.message.id, ['completed']);
  const fourth = await send(restarted, thread.id, 'Four');
  const {turn} = await until(restarted, thread.id, fourth.message.id, ['limit']);
  assert.equal(turn.answer, null);
  assert.equal(crew.submissions.length, 3);
  await assert.rejects(send(restarted, thread.id, 'Five'), /member_chat_closed/);
});

test('a reply Forge cannot persist is retried with backoff instead of a tight loop', async t => {
  const {crew, agent, options, start} = await setup(t);
  crew.steps = ['waiting'];
  const service = start();
  const thread = await open(service, agent.id);
  const {message} = await send(service, thread.id, 'Hold the database');
  await until(service, thread.id, message.id, ['waiting']);
  await delay(60);
  const lock = new DatabaseSync(join(options.directory, 'workspace-chats.sqlite'));
  t.after(() => lock.close());
  lock.exec('BEGIN IMMEDIATE');
  const before = crew.lookups;
  crew.requests.get(thread.id + '/' + message.id)!.steps.push('completed');
  await delay(300);
  const during = crew.lookups - before;
  lock.exec('ROLLBACK');
  assert.ok(during >= 2 && during <= 30, `lookups while locked: ${during}`);
  await until(service, thread.id, message.id, ['completed']);
});
