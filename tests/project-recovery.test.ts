import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import type {HttpAgentFetchFn} from '@ag-ui/client';
import {ConversationClient, type PendingPromptStore} from '../app/src/controller';
import {Prompt} from '../app/src/contract';
import {ProjectCommand} from '../app/src/project-contract';

test('project names reject multibyte overflow and controls before an immutable operation is prepared', () => {
  const request = {project_id: 'stable', operation_id: randomUUID(), expected_revision: 'sha256:a', change: {type: 'rename', name: '猫'.repeat(100)}};
  assert.equal(ProjectCommand.safeParse(request).success, false);
  assert.equal(ProjectCommand.safeParse({...request, change: {type: 'rename', name: 'bad\tname'}}).success, false);
  assert.equal(ProjectCommand.safeParse({...request, change: {type: 'rename', name: 'A short name'}}).success, true);
});

test('client restart restores an unacknowledged prompt and observes accepted history without resubmitting', async () => {
  const id = randomUUID();
  const prompt = {request_id: randomUUID(), text: 'Explain the selected project sources.'};
  let saved: unknown = null;
  let inputs: {request_id: string; text: string; outcome: string}[] = [];
  let calls = 0;
  const storage: PendingPromptStore = {async load() {return saved;}, async save(value) {saved = structuredClone(value);}, async clear() {saved = null;}};
  const snapshot = () => ({id, revision: inputs.length, phase: 'idle', cursor: inputs.length, inputs, human: null, decisions: [], messages: [], context: {project: 'stable', commit: 'a'.repeat(40), notes: []}, failure: null});
  const transport: HttpAgentFetchFn = async (url, init) => {
    if (url.endsWith('/inputs')) {
      assert.deepEqual(Prompt.parse(saved), prompt, 'The original prompt is durable before the external effect');
      calls++;
      inputs = [{...prompt, outcome: 'completed'}];
      return new Response('{"code":"acknowledgement_unknown"}', {status: 503, headers: {'Content-Type': 'application/json'}});
    }
    if (url.endsWith('/events')) return new Response(`data: ${JSON.stringify({type: 'RUN_STARTED', threadId: id, runId: 'observe'})}\n\ndata: ${JSON.stringify({type: 'STATE_SNAPSHOT', snapshot: snapshot()})}\n\ndata: ${JSON.stringify({type: 'RUN_FINISHED', threadId: id, runId: 'observe'})}\n\n`, {headers: {'Content-Type': 'text/event-stream'}});
    return new Response(JSON.stringify(snapshot()), {headers: {'Content-Type': 'application/json'}});
  };
  const first = new ConversationClient('http://127.0.0.1', {kind: 'bearer', token: 'fixture'}, id, transport, storage);
  const second = new ConversationClient('http://127.0.0.1', {kind: 'bearer', token: 'fixture'}, id, transport, storage);
  try {
    await first.connect();
    await assert.rejects(first.submit(prompt));
    first.disconnect();
    assert.deepEqual(saved, prompt);
    await second.connect();
    assert.equal(second.getSnapshot().pendingPrompt, null);
    assert.equal(saved, null);
    assert.equal(calls, 1);
    assert.equal(second.getSnapshot().conversation?.inputs.length, 1);
  } finally {first.disconnect(); second.disconnect();}
});

test('creation retry reenters trusted producer reconciliation when the stored conversation has no started workflow', async () => {
  const {mkdtemp, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {createServer} = await import('node:http');
  const {Projects} = await import('../server/projects');
  const {ProjectIntents} = await import('../server/project-intents');
  const root = await mkdtemp(join(tmpdir(), 'project-create-recovery-'));
  const id = randomUUID();
  const context = {schema_version: 'birbcrew.project-context.v1', project_id: 'stable', project_revision: 'sha256:old', project_name: 'Project', repositories: [{repository_id: '1', full_name: 'owner/first', url: 'https://github.com/owner/first', commit: 'a'.repeat(40)}], sources: [], notes: {project: 'stable', actor: 'owner', commit: 'b'.repeat(40), notes: []}};
  const snapshot = {id, kind: 'project', context_sha256: 'c'.repeat(64), project_context: context, revision: 0, phase: 'idle', cursor: 0, inputs: [], human: null, decisions: [], messages: [], context: context.notes, failure: null};
  const config = {owner_principal: 'owner', github: {owner_login: 'owner', token_file: join(root, 'must-not-read')}, beans: {binary: '/unused', hub: root, home: root, branch: 'main', actor: 'owner'}, service_token_file: join(root, 'service'), intent_directory: join(root, 'intents')};
  await writeFile(config.service_token_file, 'fixture-service-token', {mode: 0o600});
  await new ProjectIntents(config.intent_directory).resolve('conversation', id, 'owner', {project_id: 'stable', id}, async () => ({id, context}));
  let reconciliations = 0;
  const server = createServer(async (request, response) => {
    if (request.method === 'POST') {
      assert.equal(request.url, '/internal/project-conversations');
      assert.equal(request.headers['x-birbforge-project-token'], 'fixture-service-token');
      let body = '';
      for await (const chunk of request) body += chunk;
      assert.deepEqual(JSON.parse(body), {id, context});
      reconciliations++;
    }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(snapshot));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const projects = new Projects(config);
    await projects.createChat('owner', 'stable', id, `http://127.0.0.1:${address.port}`, 'fixture-owner');
    assert.equal(reconciliations, 1);
  } finally {server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await rm(root, {recursive: true, force: true});}
});

test('accepted prompt reconciliation uses the durable receipt before fresh GitHub or Beans access', async () => {
  const {createServer} = await import('node:http');
  const {Projects, ProjectsConfig} = await import('../server/projects');
  const {mkdtemp, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'project-input-recovery-'));
  const id = randomUUID();
  const prompt = {request_id: randomUUID(), text: 'A durable accepted turn.'};
  const snapshot = {id, kind: 'project', context_sha256: 'c'.repeat(64), project_context: {schema_version: 'birbcrew.project-context.v1', project_id: 'stable', project_revision: 'old', project_name: 'Project', repositories: [{repository_id: '1', full_name: 'owner/first', url: 'https://github.com/owner/first', commit: 'a'.repeat(40)}], sources: []}, revision: 0, phase: 'idle', cursor: 0, inputs: [], human: null, decisions: [], messages: [], context: {project: 'stable', commit: 'b'.repeat(40), notes: []}, failure: null};
  const service = join(root, 'service'); await writeFile(service, 'fixture-service-token', {mode: 0o600});
  let newDispatches = 0;
  let reconciliations = 0;
  const server = createServer((request, response) => {
    let payload: unknown = snapshot;
    if (request.url?.endsWith('/reconcile')) {reconciliations++; payload = {accepted: true, input: {...prompt, outcome: 'accepted'}};}
    if (request.url?.endsWith('/inputs')) newDispatches++;
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(payload));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const projects = new Projects(ProjectsConfig.parse({owner_principal: 'owner', github: {owner_login: 'owner', token_file: '/must-not-read'}, beans: {binary: '/must-not-invoke', hub: root, home: root, branch: 'main', actor: 'owner'}, service_token_file: service, intent_directory: join(root, 'intents')}));
    const result = await projects.submit(id, `http://127.0.0.1:${address.port}`, 'fixture-owner', prompt);
    assert.ok('id' in result);
    assert.equal(result.id, id);
    assert.equal(reconciliations, 1);
    assert.equal(newDispatches, 0);
  } finally {server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await rm(root, {recursive: true, force: true});}
});
