import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {URL} from 'node:url';
import ts from 'typescript';
import type {HttpAgentFetchFn} from '@ag-ui/client';
import {recentConversations} from '../app/src/access';

const requireNative = createRequire(import.meta.resolve('react-native/package.json'));
const nativeAbort = requireNative('abort-controller');
const source = ts.createSourceFile('App.tsx', readFileSync(new URL('../app/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handlerSource = '';
function findHandler(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'listConversations') handlerSource = node.getText(source);
  ts.forEachChild(node, findHandler);
}
findHandler(source);
assert.ok(handlerSource, 'Run the actual recent-conversation button handler');
const handler = ts.transpileModule(handlerSource, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;

function screen(transport: HttpAgentFetchFn) {
  let busy = false;
  let notice = '';
  let conversations: Awaited<ReturnType<typeof recentConversations>> = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const list: () => Promise<void> = runInNewContext(`${handler}\nlistConversations`, {
    access: {kind: 'private-single-owner'}, endpoint: 'https://private.example.invalid', transport, recentConversations,
    AbortController: nativeAbort.AbortController, AbortSignal: nativeAbort.AbortSignal,
    setBusy: (value: boolean) => {busy = value;}, setNotice: (value: string) => {notice = value;},
    setConversations: (value: typeof conversations) => {conversations = value;},
    setTimeout: (callback: () => void, delay: number) => {assert.equal(delay, 15000); timers.set(++timerId, callback); return timerId;},
    clearTimeout: (id: number) => {timers.delete(id);},
  });
  return {list, state: () => ({busy, notice, conversations}), timers};
}

test('recent-conversation button works with the native AbortSignal that has no timeout method', async () => {
  assert.equal(nativeAbort.AbortSignal.timeout, undefined);
  const recent = [{id: '00000000-0000-4000-8000-000000000001', revision: 4}];
  let requests = 0;
  const app = screen(async (url, init) => {
    requests++;
    assert.equal(url, 'https://private.example.invalid/api/conversations');
    assert.ok(init.signal instanceof nativeAbort.AbortSignal);
    assert.equal(init.signal?.aborted, false);
    return Response.json(recent);
  });
  await app.list();
  assert.equal(requests, 1);
  assert.deepEqual(app.state(), {busy: false, notice: '', conversations: recent});
  assert.equal(app.timers.size, 0);
});

test('native list timeout aborts the request and leaves the refresh button available', async () => {
  let aborted = false;
  const app = screen((_url, init) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {aborted = true; reject(new Error('Aborted'));});
  }));
  const pending = app.list();
  assert.equal(app.state().busy, true);
  assert.equal(app.timers.size, 1);
  for (const expire of app.timers.values()) expire();
  await pending;
  assert.equal(aborted, true);
  assert.equal(app.state().busy, false);
  assert.match(app.state().notice, /Could not list conversations/);
  assert.equal(app.timers.size, 0);
});

test('native list rejection clears its timeout and allows another refresh', async () => {
  let requests = 0;
  const app = screen(async () => {
    if (++requests === 1) throw new Error('Network unavailable');
    return Response.json([]);
  });
  await app.list();
  assert.equal(app.state().busy, false);
  assert.match(app.state().notice, /Could not list conversations/);
  assert.equal(app.timers.size, 0);
  await app.list();
  assert.equal(requests, 2);
  assert.equal(app.state().notice, '');
  assert.equal(app.timers.size, 0);
});
