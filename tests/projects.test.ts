import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createServer, type Server} from 'node:http';
import {createHash, randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {BeansProjects, ProjectError} from '../server/beans-projects';
import {ProjectIntents} from '../server/project-intents';
import {GatewayConfig, gateway} from '../server/gateway';

const execute = promisify(execFile);
const binary = process.env.BIRBFORGE_TEST_BN;
const owner = 'project-test-owner-'.repeat(3);
const stranger = 'project-test-stranger-'.repeat(3);
const repository = (id: string, name: string) => ({id, full_name: `owner/${name}`, html_url: `https://github.com/owner/${name}`});
const request = (projectId: string, operationId: string, revision: string | null, change: unknown) => ({
  schema_version: 1, project_id: projectId, operation_id: operationId, expected_revision: revision, change,
});
async function git(directory: string, ...args: string[]) {
  return (await execute('git', ['-C', directory, ...args], {env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}})).stdout.trim();
}
async function fixture() {
  assert.ok(binary, 'Set BIRBFORGE_TEST_BN to the exact candidate Beans executable');
  const root = await mkdtemp(join(tmpdir(), 'birbforge-projects-'));
  const remote = join(root, 'remote.git');
  const hub = join(root, 'hub');
  await execute('git', ['init', '--bare', '-q', '-b', 'main', remote]);
  await execute('git', ['init', '-q', '-b', 'main', hub]);
  await git(hub, 'config', 'user.name', 'Project test');
  await git(hub, 'config', 'user.email', 'project-test@localhost');
  await git(hub, 'commit', '--allow-empty', '-qm', 'Initialize disposable fixture');
  await git(hub, 'remote', 'add', 'origin', remote);
  await git(hub, 'push', '-qu', 'origin', 'main');
  const config = {binary: resolve(binary), home: root, hub, branch: 'main', actor: 'project-test'};
  return {root, remote, hub, config, beans: new BeansProjects(config)};
}
async function listen(server: Server) {
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(done => server.close(() => done()));
}

test('Beans consumer survives separate CLI retries and preserves namespace and history through archive', {skip: !binary}, async () => {
  const f = await fixture();
  try {
    const create = request('project-stable', randomUUID(), null, {type: 'create', name: null, repositories: [repository('22', 'zebra'), repository('11', 'alpha'), repository('22', 'zebra')]});
    const created = await f.beans.apply(create);
    assert.equal(created.project.name, 'zebra');
    assert.deepEqual(created.project.repositories.map(repo => repo.id), ['22', '11']);
    assert.equal(created.pushed, true);
    const firstHead = await git(f.hub, 'rev-parse', 'HEAD');
    const retry = await new BeansProjects(f.config).apply(create);
    assert.equal(retry.replayed, true);
    assert.deepEqual(retry.project, created.project);
    assert.equal(await git(f.hub, 'rev-parse', 'HEAD'), firstHead);
    const renamed = await f.beans.apply(request('project-stable', randomUUID(), created.project.revision, {type: 'rename', name: 'Custom display name'}));
    assert.equal(renamed.project.id, 'project-stable');
    assert.equal(renamed.project.name, 'Custom display name');
    const canonical = await f.beans.apply(request('project-stable', randomUUID(), renamed.project.revision, {type: 'add_repository', repository: repository('11', 'renamed-repository')}));
    assert.equal(canonical.project.name, 'Custom display name');
    assert.equal(canonical.project.repositories.length, 2);
    assert.equal(canonical.project.repositories[1].full_name, 'owner/renamed-repository');
    const removed = await f.beans.apply(request('project-stable', randomUUID(), canonical.project.revision, {type: 'remove_repository', repository_id: '22'}));
    assert.deepEqual(removed.project.repositories.map(repo => repo.id), ['11']);
    await assert.rejects(f.beans.apply(request('project-stable', randomUUID(), removed.project.revision, {type: 'remove_repository', repository_id: '11'})), error => error instanceof ProjectError && error.status === 409);
    const archived = await f.beans.apply(request('project-stable', randomUUID(), removed.project.revision, {type: 'archive'}));
    assert.equal(archived.project.archived, true);
    assert.deepEqual(await f.beans.list(), []);
    assert.equal((await new BeansProjects(f.config).get('project-stable')).archived, true);
    assert.ok((await git(f.hub, 'show', `${firstHead}:projects/project-stable/beans.toml`)).includes('zebra'));
    assert.equal(await git(f.remote, 'rev-parse', 'main'), await git(f.hub, 'rev-parse', 'HEAD'));
  } finally {await rm(f.root, {recursive: true, force: true});}
});

test('gateway reports stale revisions and conflicting operation reuse without changing a real Beans project', {skip: !binary}, async () => {
  const f = await fixture();
  const producer = createServer((_request, response) => {response.writeHead(404, {'Content-Type': 'application/json'}); response.end('{"detail":"not_found"}');});
  const producerUrl = await listen(producer);
  const server = gateway(GatewayConfig.parse({url: producerUrl, tokens: {owner, stranger}, projects: {
    owner_principal: 'owner', github: {token_file: join(f.root, 'unused-github-token'), owner_login: 'owner'},
    beans: f.config, service_token_file: join(f.root, 'unused-service-token'), intent_directory: join(f.root, 'intents'),
  }}));
  const url = await listen(server);
  async function api(path: string, body?: unknown, token = owner) {
    return fetch(url + '/api' + path, {method: body === undefined ? 'GET' : 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  }
  try {
    const created = await f.beans.apply(request('project-stable', randomUUID(), null, {type: 'create', name: null, repositories: [repository('1', 'first')]}));
    assert.equal((await api('/projects', undefined, stranger)).status, 404);
    assert.equal((await fetch(url + '/api/projects')).status, 401);
    const command = {project_id: 'project-stable', operation_id: randomUUID(), expected_revision: created.project.revision, change: {type: 'rename', name: 'Browser edit'}};
    assert.equal((await api('/projects', command)).status, 200);
    const editedHead = await git(f.hub, 'rev-parse', 'HEAD');
    assert.equal((await api('/projects', command)).status, 200);
    assert.equal(await git(f.hub, 'rev-parse', 'HEAD'), editedHead);
    const stale = await api('/projects', {...command, operation_id: randomUUID(), change: {type: 'rename', name: 'Phone stale edit'}});
    assert.equal(stale.status, 409);
    const reused = await api('/projects', {...command, change: {type: 'rename', name: 'Conflicting reuse'}});
    assert.equal(reused.status, 409);
    assert.equal((await f.beans.get('project-stable')).name, 'Browser edit');
    const forged = await api('/projects', {...command, actor: 'stranger'});
    assert.equal(forged.status, 400);
    assert.equal((await api('/github/repositories?page=0')).status, 400);
    assert.equal((await api('/github/repositories?page=NaN')).status, 400);
    assert.equal((await api('/github/repositories?unexpected=true')).status, 400);
    assert.equal(await git(f.hub, 'rev-parse', 'HEAD'), editedHead);
  } finally {await close(server); await close(producer); await rm(f.root, {recursive: true, force: true});}
});

test('failed Beans publication stays uncertain and unchanged retry reconciles one authored effect', {skip: !binary}, async () => {
  const f = await fixture();
  const hook = join(f.remote, 'hooks', 'pre-receive');
  try {
    await writeFile(hook, '#!/bin/sh\nexit 1\n', {mode: 0o700});
    const create = request('project-failure', randomUUID(), null, {type: 'create', name: 'Retained', repositories: [repository('1', 'first')]});
    await assert.rejects(f.beans.apply(create), error => error instanceof ProjectError && error.status === 503 && error.code.includes('uncertain'));
    const localHead = await git(f.hub, 'rev-parse', 'HEAD');
    assert.equal((await f.beans.get('project-failure')).name, 'Retained');
    assert.notEqual(await git(f.remote, 'rev-parse', 'main'), localHead);
    await rm(hook);
    const result = await new BeansProjects(f.config).apply(create);
    assert.equal(result.replayed, true);
    assert.equal(result.pushed, true);
    assert.equal(await git(f.hub, 'rev-parse', 'HEAD'), localHead);
    assert.equal(await git(f.remote, 'rev-parse', 'main'), localHead);
  } finally {await rm(f.root, {recursive: true, force: true});}
});

test('project note capture excludes global and unrelated notes and retains exact provenance', {skip: !binary}, async () => {
  const f = await fixture();
  assert.ok(binary);
  const bn = async (projectId: string, ...args: string[]) => execute(binary, ['--hub', f.hub, '--branch', 'main', '--actor', 'project-test', '--project', projectId, '--json', ...args], {cwd: f.root, env: {...process.env, HOME: f.root, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  try {
    for (const id of ['project-first', 'project-second']) await f.beans.apply(request(id, randomUUID(), null, {type: 'create', name: id, repositories: [repository('1', 'first')]}));
    await bn('project-first', 'remember', '--key', 'relevant', 'Scoped project guidance');
    await bn('project-second', 'remember', '--key', 'unrelated', 'UNRELATED_SENTINEL');
    await bn('project-first', 'remember', '--global', '--key', 'global', 'GLOBAL_SENTINEL');
    const context = await f.beans.notes('project-first');
    assert.equal(context.project, 'project-first');
    assert.equal(context.commit, await git(f.hub, 'rev-parse', 'HEAD'));
    assert.deepEqual(context.notes.map(note => note.key), ['relevant']);
    assert.equal(context.notes[0].body, 'Scoped project guidance');
    const recordedBytes = (await execute('git', ['-C', f.hub, 'show', `${context.commit}:${context.notes[0].path}`])).stdout;
    assert.equal(context.notes[0].file_sha256, createHash('sha256').update(recordedBytes).digest('hex'));
    assert.equal(context.notes[0].content_sha256, createHash('sha256').update('Scoped project guidance').digest('hex'));
    assert.ok(!JSON.stringify(context).includes('SENTINEL'));
  } finally {await rm(f.root, {recursive: true, force: true});}
});

test('immutable project intents converge across concurrent processes and reject changed identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'birbforge-project-intents-'));
  const id = randomUUID();
  const moduleUrl = new URL('../server/project-intents.ts', import.meta.url).href;
  const script = `import {ProjectIntents} from ${JSON.stringify(moduleUrl)}; const [directory,id,value] = process.argv.slice(1); const result = await new ProjectIntents(directory).resolve('mutation',id,'owner',{repository_ids:['22','11']},async()=>({canonical:value})); process.stdout.write(JSON.stringify(result));`;
  try {
    const processes = await Promise.all(['first-enrichment', 'second-enrichment'].map(value => execute(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, root, id, value], {cwd: resolve('.')})));
    assert.deepEqual(JSON.parse(processes[0].stdout), JSON.parse(processes[1].stdout));
    const fresh = new ProjectIntents(root);
    const retry = await fresh.resolve('mutation', id, 'owner', {repository_ids: ['22', '11']}, async () => {throw new Error('A frozen retry must not resolve current metadata');});
    assert.deepEqual(retry, JSON.parse(processes[0].stdout));
    await assert.rejects(fresh.resolve('mutation', id, 'owner', {repository_ids: ['11', '22']}, async () => null), error => error instanceof ProjectError && error.status === 409);
    await assert.rejects(fresh.resolve('mutation', id, 'another-owner', {repository_ids: ['22', '11']}, async () => null), error => error instanceof ProjectError && error.status === 409);
    assert.ok(JSON.parse(await readFile(join(root, `mutation-${id}.json`), 'utf8')).fingerprint);
  } finally {await rm(root, {recursive: true, force: true});}
});

test('project conversations cannot use the old pilot delivery launcher', async () => {
  let dispatches = 0;
  const id = randomUUID();
  const producer = createServer((request, response) => {
    if (request.method !== 'GET') dispatches++;
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.end(JSON.stringify({kind: 'project'}));
  });
  const producerUrl = await listen(producer);
  const server = gateway(GatewayConfig.parse({url: producerUrl, tokens: {owner}, mode: 'approved-goal', delivery: {python: '/not-invoked', configuration: '/not-invoked'}, projects: {
    owner_principal: 'owner', github: {token_file: '/not-read', owner_login: 'owner'}, beans: {binary: '/not-invoked', home: '/not-read', hub: '/not-read', branch: 'main', actor: 'owner'}, service_token_file: '/not-read', intent_directory: '/not-read',
  }}));
  const url = await listen(server);
  try {
    for (const path of ['', '/command', '/events']) {
      const response = await fetch(`${url}/api/conversations/${id}/delivery${path}`, {method: path ? 'POST' : 'GET', headers: {Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json'}, body: path ? JSON.stringify({action: 'approve', project_id: 'forged'}) : undefined});
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {code: 'ready_producer_not_admitted'});
    }
    assert.equal(dispatches, 0);
  } finally {await close(server); await close(producer);}
});
