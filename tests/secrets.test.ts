import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {chmod, mkdtemp, rm, stat, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {SecretStore, SecretStoreError} from '../server/secrets';

test('named secrets survive replacement and restart in owner-only files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'birbforge-secrets-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const store = new SecretStore(directory);
  const first = randomBytes(32).toString('hex');
  const second = randomBytes(32).toString('hex');
  await Promise.all([store.set('MODEL_TOKEN', first), store.set('Repository-key', second)]);
  assert.deepEqual(await store.list(), ['MODEL_TOKEN', 'Repository-key']);
  assert.equal((await stat(join(directory, 'secrets'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(directory, 'secrets', 'MODEL_TOKEN'))).mode & 0o777, 0o600);
  await store.set('MODEL_TOKEN', second);
  const reopened = new SecretStore(directory);
  assert.equal(await reopened.get('MODEL_TOKEN') === second, true);
  await reopened.remove('MODEL_TOKEN');
  await reopened.remove('MODEL_TOKEN');
  assert.equal(await reopened.get('MODEL_TOKEN'), null);
  assert.equal(await reopened.get('Repository-key') === second, true);
  assert.deepEqual(await store.list(), ['Repository-key']);
});

test('the secret store rejects invalid names, symlinks and permissive files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'birbforge-secrets-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const store = new SecretStore(directory);
  const value = randomBytes(32).toString('hex');
  const denied = (status: number) => (reason: unknown) => reason instanceof SecretStoreError &&
    reason.status === status && !reason.message.includes(value);
  await assert.rejects(store.set('../outside', value), denied(400));
  await assert.rejects(store.remove('../outside'), denied(400));
  await store.set('Key', value);
  await symlink(join(directory, 'secrets', 'Key'), join(directory, 'secrets', 'Link'));
  await assert.rejects(store.get('Link'), denied(503));
  assert.deepEqual(await store.list(), ['Key']);
  await chmod(join(directory, 'secrets', 'Key'), 0o644);
  await assert.rejects(store.get('Key'), denied(503));
  await chmod(join(directory, 'secrets'), 0o755);
  await assert.rejects(store.list(), denied(503));
});
