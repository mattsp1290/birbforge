import {test} from 'node:test';
import type {HttpAgentFetchFn} from '@ag-ui/client';
import assert from 'node:assert/strict';
import {createServer, request as httpRequest, type Server} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GatewayConfig, gateway, gatewayHandler, privateGateway} from '../server/gateway';
import {ProxyConfig} from '../server/access';
import {AccessCapability, authorizationHeaders, discoverAccess, type ClientAccess} from '../app/src/access';
import {ConversationClient} from '../app/src/controller';
import {VerificationClient} from '../app/src/verification';

async function listen(server: Server, host = '127.0.0.1') {
  await new Promise<void>(resolve => server.listen(0, host, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://${host === '::1' ? '[::1]' : host}:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
const requestFetch: HttpAgentFetchFn = (url, init) => new Promise((resolve, reject) => {
  const headers = Object.fromEntries(new Headers(init.headers));
  const request = httpRequest(url, {method: init.method, headers}, incoming => {
    const chunks: Buffer[] = [];
    incoming.on('data', chunk => chunks.push(chunk));
    incoming.on('end', () => resolve(new Response(Buffer.concat(chunks), {status: incoming.statusCode, headers: {'Content-Type': incoming.headers['content-type'] ?? 'application/json'}})));
    incoming.on('error', reject);
  });
  request.on('error', reject);
  request.end(init.body);
});
async function wait(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Client must observe the HTTP fixture');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const owner = 'fixture-owner-'.repeat(4);
const stranger = 'fixture-stranger-'.repeat(4);
const id = randomUUID();
const snapshot = {id, revision: 0, phase: 'idle', cursor: 0, inputs: [], human: null, decisions: [], messages: [],
  context: {project: 'forge', commit: 'a'.repeat(40), notes: []}, failure: null};
const delivery = {revision: 0, offer: {offer_id: 'pilot', title: 'Write docs', goal_text: 'Write docs', repository_id: 'owner/repo',
  base_commit: 'a'.repeat(40), policy_revision: 'b'.repeat(64), allowed_paths: ['docs/operator.md'], acceptance_id: 'docs-check',
  goal_ref: {project: 'forge', record_id: 'one', revision: '1', content_sha256: 'c'.repeat(64)}}, offer_sha256: 'd'.repeat(64),
  conversation_id: null, delivery_id: null, cancellation: 'none', command_ids: [], stage: {kind: 'awaiting_approval'}};

function events(response: import('node:http').ServerResponse, state: unknown) {
  response.writeHead(200, {'Content-Type': 'text/event-stream'});
  response.end([{type: 'RUN_STARTED', threadId: id, runId: 'fixture'}, {type: 'STATE_SNAPSHOT', snapshot: state},
    {type: 'RUN_FINISHED', threadId: id, runId: 'fixture'}].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
}

test('private owner listener keeps identity on the server and preserves bearer listeners', async () => {
  const forwarded: (string | undefined)[] = [];
  let observations = 0;
  const producer = createServer((request, response) => {
    forwarded.push(request.headers.authorization);
    if (request.url?.endsWith('/events')) {observations++; return events(response, snapshot);}
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url === '/conversations' && request.method === 'GET' ? [{id, revision: 0}] : snapshot));
  });
  const producerUrl = await listen(producer);
  const root = mkdtempSync(join(tmpdir(), 'birbforge-owner-adapter-'));
  const adapter = join(root, 'adapter');
  writeFileSync(adapter, `#!/usr/bin/python3
import json, sys
request = json.load(sys.stdin)
assert request['principal'] == 'owner'
assert request['conversation_id'] == '${id}'
print(json.dumps({'ok': True, 'value': json.loads(${JSON.stringify(JSON.stringify(delivery))})}))
`, {mode: 0o700});
  const config = GatewayConfig.parse({url: producerUrl, tokens: {owner, stranger}, mode: 'approved-goal', delivery: {python: adapter, configuration: '/unused-fixture'}});
  const settings = ProxyConfig.parse({port: 8788, origin: 'https://private.example.invalid', authentication: {kind: 'private-single-owner', principal: 'owner'}});
  assert.throws(() => privateGateway(config, {...settings, authentication: {kind: 'private-single-owner', principal: 'missing'}}), /not configured/);
  const privateServer = privateGateway(config, settings);
  const base = await listen(privateServer);
  const loopback = gateway(config);
  const loopbackUrl = await listen(loopback);
  const bearerProxy = privateGateway(config, {...settings, authentication: {kind: 'bearer'}});
  const bearerUrl = await listen(bearerProxy);
  const denied = createServer(gatewayHandler(config, {kind: 'privateProxy', settings}));
  const deniedUrl = await listen(denied, '::1');
  const headers = {Host: 'private.example.invalid'};
  try {
    assert.deepEqual(await (await requestFetch(base + '/api/access', {headers})).json(), {kind: 'private-single-owner'});
    assert.deepEqual(await (await fetch(loopbackUrl + '/api/access')).json(), {kind: 'bearer'});
    assert.deepEqual(await (await requestFetch(bearerUrl + '/api/access', {headers})).json(), {kind: 'bearer'});
    assert.equal((await fetch(loopbackUrl + '/api/conversations')).status, 401);
    assert.equal((await requestFetch(bearerUrl + '/api/conversations', {headers})).status, 401);
    assert.equal((await requestFetch(base + '/api/access', {})).status, 403);
    for (const Origin of ['https://wrong.invalid', 'null']) {
      assert.equal((await requestFetch(base + '/api/access', {headers: {...headers, Origin}})).status, 403);
    }
    assert.equal((await requestFetch(base + '/api/access?extra=1', {headers})).status, 404);
    assert.equal((await requestFetch(base + '/api/access', {method: 'POST', headers})).status, 404);
    const rejectedSource = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(deniedUrl + '/api/access', {headers: {...headers, 'X-Forwarded-For': '127.0.0.1'}}, response => {response.resume(); resolve(response.statusCode);});
      request.on('error', reject); request.end();
    });
    assert.equal(rejectedSource, 403);
    assert.deepEqual(await (await requestFetch(base + '/api/session', {headers})).json(), {authenticated: true, managedProjects: false});
    assert.equal((await fetch(loopbackUrl + '/api/session')).status, 401);
    assert.equal((await fetch(loopbackUrl + '/api/secrets', {headers: {Authorization: `Bearer ${stranger}`}})).status, 403);
    assert.equal((await requestFetch(base + '/api/secrets', {headers: {...headers, Origin: 'https://outside.invalid'}})).status, 403);
    assert.equal((await requestFetch(base + '/api/conversations', {headers})).status, 200);
    assert.equal((await requestFetch(base + '/api/conversations', {headers: {...headers, Authorization: `Bearer ${stranger}`}})).status, 200);
    assert.equal((await requestFetch(base + '/api/conversations', {method: 'POST', headers, body: JSON.stringify({id})})).status, 200);
    assert.equal((await requestFetch(base + `/api/conversations/${id}`, {headers})).status, 200);
    assert.equal((await requestFetch(base + '/api/conversations', {method: 'POST', headers, body: JSON.stringify({id, principal: 'stranger'})})).status, 400);
    const command = {command_id: randomUUID(), expected_revision: 0, offer_sha256: delivery.offer_sha256, action: 'approve'};
    const commandUrl = base + `/api/conversations/${id}/delivery/command`;
    assert.equal((await requestFetch(commandUrl, {method: 'POST', headers: {...headers, Authorization: `Bearer ${stranger}`}, body: JSON.stringify(command)})).status, 200);
    assert.equal((await requestFetch(commandUrl, {method: 'POST', headers, body: JSON.stringify({...command, principal: 'stranger'})})).status, 400);
    const client = new ConversationClient(base, {kind: 'private-single-owner'}, id, (url, init) => requestFetch(url, {...init, headers: {...Object.fromEntries(new Headers(init.headers)), ...headers}}));
    try {await client.connect(); await wait(() => observations > 0);}
    finally {client.disconnect();}
    assert.ok(forwarded.length >= 5);
    assert.ok(forwarded.every(value => value === `Bearer ${owner}`));
  } finally {await Promise.all([producer, privateServer, loopback, bearerProxy, denied].map(close)); rmSync(root, {recursive: true});}
});

for (const access of [{kind: 'private-single-owner'}, {kind: 'bearer', token: 'fixture-owner'}] satisfies ClientAccess[]) {
  test(`shared ${access.kind} clients retain access through reconnect and actions`, async () => {
    const paths: string[] = [];
    const authorization: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url ?? ''); authorization.push(request.headers.authorization);
      if (request.url?.endsWith('/events')) return events(response, request.url.includes('/delivery/') ? {delivery} : {...snapshot, mode: 'approved-goal'});
      response.setHeader('Content-Type', 'application/json');
      if (request.url?.includes('/verification')) {response.writeHead(404); response.end('{}'); return;}
      response.end(JSON.stringify(request.url?.endsWith('/command') ? delivery : {...snapshot, mode: 'approved-goal'}));
    });
    const base = await listen(server);
    const client = new ConversationClient(base, access, id);
    const verification = new VerificationClient({url: base, access, conversationId: id});
    try {
      await client.create();
      await wait(() => !!client.delivery.getSnapshot().snapshot);
      client.disconnect(); await client.connect();
      await wait(() => client.delivery.getSnapshot().connected);
      await client.delivery.act('approve', randomUUID());
      await assert.rejects(verification.refresh(), /HTTP 404/);
      assert.equal(paths.filter(path => path.endsWith('/command')).length, 1);
      assert.ok(paths.filter(path => path.endsWith('/delivery/events')).length >= 2);
      assert.ok(authorization.every(value => value === authorizationHeaders(access).Authorization));
    } finally {client.disconnect(); verification.disconnect(); await close(server);}
  });
}

test('access discovery parses only public capabilities and fails closed', async () => {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({kind: 'private-single-owner', token: owner}));
  });
  const base = await listen(server);
  try {
    await assert.rejects(discoverAccess(base, (url, init) => fetch(url, init), AbortSignal.timeout(3000)));
    await assert.rejects(discoverAccess(base + '/path', (url, init) => fetch(url, init), AbortSignal.timeout(3000)));
    assert.equal(AccessCapability.safeParse({kind: 'private-single-owner', principal: 'owner'}).success, false);
  } finally {await close(server);}
});
