import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {CatalogService} from '../server/catalog';
import {githubRepository, type Agent} from '../app/src/catalog';

test('projects show the same repository membership as the Beans CLI', async t => {
  const root = await mkdtemp(join(tmpdir(), 'birbforge-catalog-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const hub = join(root, 'hub');
  execFileSync('git', ['init', '-q', '-b', 'main', hub]);
  execFileSync('git', ['-C', hub, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '--allow-empty', '-qm', 'Fixture']);
  const service = new CatalogService({directory: root, hub});
  assert.deepEqual(await service.snapshot(), {projects: [], projectsAvailable: true, agents: []});
  const created = await service.apply({kind: 'createProject', id: 'flight'});
  assert.deepEqual(created.projects, [{id: 'flight', repositories: []}]);
  await Promise.all(['birds/engine', 'https://github.com/birds/native.git', 'git@github.com:birds/native.git'].map(repository =>
    service.apply({kind: 'linkRepository', id: 'flight', repository})));
  const config = JSON.parse(execFileSync('bn', ['--hub', hub, '--no-fetch', '--json', 'project', 'show', 'flight'], {encoding: 'utf8'})).config;
  assert.deepEqual(config.remotes, ['https://github.com/birds/engine', 'https://github.com/birds/native']);
  await assert.rejects(service.apply({kind: 'linkRepository', id: 'flight', repository: 'https://github.com@other.invalid/b/r'}), /invalid_catalog_command/);
  await assert.rejects(service.apply({kind: 'linkRepository', id: 'unlisted', repository: 'birds/a'}), /unknown_project/);
  const agent: Agent = {id: randomUUID(), name: 'Finch', instructions: 'Review builds', projectIds: ['flight']};
  assert.deepEqual((await service.apply({kind: 'saveAgent', previous: null, agent})).agents, [agent]);
  const reopened = new CatalogService({directory: root, hub});
  assert.deepEqual((await reopened.snapshot()).agents, [agent]);
  await assert.rejects(reopened.apply({kind: 'saveAgent', previous: agent, agent: {...agent, projectIds: ['unknown']}}), /unknown_project/);
  const revised = {...agent, name: 'Kestrel', projectIds: []};
  await reopened.apply({kind: 'saveAgent', previous: agent, agent: revised});
  await assert.rejects(reopened.apply({kind: 'deleteAgent', previous: agent}), /agent_changed/);
  assert.deepEqual((await reopened.apply({kind: 'deleteAgent', previous: revised})).agents, []);
});

test('crew profiles remain usable when this gateway has no configured Beans hub', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'birbforge-crew-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const service = new CatalogService({directory});
  const commands = ['Finch', 'Jay'].map(name => ({
    kind: 'saveAgent', previous: null, agent: {id: randomUUID(), name, instructions: '', projectIds: []},
  }));
  await Promise.all(commands.map(command => service.apply(command)));
  assert.deepEqual((await service.snapshot()).agents.map(agent => agent.name), ['Finch', 'Jay']);
  await assert.rejects(service.apply({kind: 'createProject', id: 'flight'}), /beans_hub_required/);
  const offline = new CatalogService({directory, hub: join(directory, 'missing-hub')});
  assert.equal((await offline.snapshot()).projectsAvailable, false);
  const previous = commands[0].agent;
  const updated = {...previous, instructions: 'Observe this factory'};
  assert.equal((await offline.apply({kind: 'saveAgent', previous, agent: updated})).agents[0].instructions, updated.instructions);
  await assert.rejects(offline.apply({kind: 'createProject', id: 'demo'}), /beans_unavailable/);
  assert.equal(githubRepository('https://secret@github.com/crew/private'), null);
  assert.equal(githubRepository('../outside'), null);
});
