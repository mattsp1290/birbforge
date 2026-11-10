import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {Chat, ChatIndex, chiefId} from '../app/src/chat';
import type {Catalog} from '../app/src/catalog';
import type {FactoryStatus} from '../app/src/factory';
import {createChatService} from '../server/chat';

test('workspace chats stay pinned, persist turns, and inspect current state within the selected agent’s assignments', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'birbforge-chat-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const agent = {id: randomUUID(), name: 'Robin', instructions: 'Review the mobile app.', projectIds: ['mobile']};
  const catalog: Catalog = {agents: [agent], projectsAvailable: true, projects: [
    {id: 'mobile', repositories: ['crew/ios']}, {id: 'billing', repositories: ['crew/billing']},
  ]};
  const factory: FactoryStatus = {gateway: 'online', runtime: 'ready', verification: 'installed', checkedAt: new Date().toISOString(),
    queue: {conversationId: randomUUID(), environment: 'ready', queued: 2, running: 1, finished: 4}};
  const options = {directory, catalog: async () => catalog, inspect: async () => factory};
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

test('only live chat reads the configured provider credential', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'birbforge-chat-runner-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const python = join(directory, 'fixture-runner');
  await writeFile(python, `#!/usr/bin/env python3
import json, sys
payload = json.load(sys.stdin)
if sys.argv[-1] == '--local':
    assert 'providerKey' not in payload
else:
    assert payload.pop('providerKey') == 'test-provider-value'
    assert 'test-provider-value' not in json.dumps(payload)
print(json.dumps('Runner answered'))
`, {mode: 0o700});
  let reads = 0;
  const options = {directory, python,
    providerKey: async () => {reads++; return 'test-provider-value';},
    catalog: async () => ({agents: [], projects: [], projectsAvailable: false}),
    inspect: async (): Promise<FactoryStatus> => ({gateway: 'online', runtime: 'ready', verification: 'unconfigured', queue: null, checkedAt: new Date().toISOString()}),
  };
  const path = '/api/chats/' + chiefId + '/messages';
  await createChatService(options).handle('POST', path, {id: randomUUID(), text: 'Local report'});
  assert.equal(reads, 0);
  const chat = Chat.parse(await createChatService({...options, attestation: 'fixture-only'}).handle('POST', path, {id: randomUUID(), text: 'Live report'}));
  assert.equal(reads, 1);
  assert.deepEqual(chat.turns.map(turn => turn.answer), ['Runner answered', 'Runner answered']);
  assert.doesNotMatch(JSON.stringify(chat), /test-provider-value/);
  const nextTurn = {id: randomUUID(), text: 'Report after removing the credential'};
  const noKey = createChatService({...options, attestation: 'fixture-only', providerKey: async () => undefined});
  await assert.rejects(noKey.handle('POST', path, nextTurn), /provider_secret_required/);
});
