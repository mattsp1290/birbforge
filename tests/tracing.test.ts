import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {createServer, type Server} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
async function wait(check: () => boolean, label: string) {
  const deadline = Date.now() + 30_000;
  while (!check()) {
    assert.ok(Date.now() < deadline, label);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

test('tracing preload loads nothing unless DD_TRACE_ENABLED is exactly true', () => {
  const probe = 'process.stdout.write(JSON.stringify([typeof globalThis._ddtrace, process.env.DD_SERVICE ?? null]))';
  for (const value of [undefined, 'false', '1', 'TRUE']) {
    const env = {NODE_ENV: 'test', PATH: process.env.PATH ?? '/usr/bin:/bin', ...(value === undefined ? {} : {DD_TRACE_ENABLED: value})};
    assert.equal(execFileSync(process.execPath, ['--import', './server/tracing.mjs', '-e', probe], {env, encoding: 'utf8'}), '["undefined",null]');
  }
});

test('traced gateway exports spans without credentials, cookies, query strings or message text', async () => {
  const token = randomBytes(24).toString('hex');
  const secrets = [token, `cookie-${randomUUID()}`, `query-${randomUUID()}`, `prompt-${randomUUID()}`, `chat-${randomUUID()}`];
  const [, cookie, query, prompt, chat] = secrets;
  const received: Buffer[] = [];
  const agent = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk)).on('end', () => {
      received.push(Buffer.concat([Buffer.from(`${request.url} ${JSON.stringify(request.headers)}\n`), ...chunks]));
      response.writeHead(200, {'Content-Type': 'application/json'});
      response.end(request.url === '/info' ? JSON.stringify({endpoints: ['/v0.4/traces']}) : '{}');
    });
  });
  let propagated = false;
  const crew = createServer((request, response) => {
    propagated ||= typeof request.headers['x-datadog-trace-id'] === 'string';
    request.resume().on('end', () => {response.writeHead(200, {'Content-Type': 'application/json'}); response.end('{}');});
  });
  const reserve = createServer();
  const [agentPort, crewPort, port] = [await listen(agent), await listen(crew), await listen(reserve)];
  await close(reserve);
  const root = mkdtempSync(join(tmpdir(), 'forge-tracing-'));
  const config = join(root, 'client.json');
  writeFileSync(config, JSON.stringify({url: `http://127.0.0.1:${crewPort}`, tokens: {owner: token}}), {mode: 0o600});
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--tsconfig', 'tsconfig.node.json', '--import', './server/tracing.mjs', 'server/main.ts'], {
    env: {NODE_ENV: 'test', PATH: process.env.PATH ?? '/usr/bin:/bin', BIRBFORGE_CLIENT_CONFIG: config, BIRBFORGE_PORT: String(port),
      BIRBFORGE_WORKSPACE_DIR: join(root, 'workspace'), DD_TRACE_ENABLED: 'true', DD_TRACE_AGENT_URL: `http://127.0.0.1:${agentPort}`,
      DD_RUNTIME_METRICS_ENABLED: 'false', DD_TRACE_FLUSH_INTERVAL: '100', DD_ENV: 'test', DD_VERSION: 'test',
      // The preload must override attempts to record request data.
      DD_TRACE_HEADER_TAGS: 'authorization:auth,cookie:cookie', DD_TRACE_OBFUSCATION_QUERY_STRING_REGEXP: '', DD_TRACE_CLIENT_IP_ENABLED: 'true'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => {output += chunk;});
  child.stderr.on('data', chunk => {output += chunk;});
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  try {
    await wait(() => output.includes('Forge loopback gateway ready.'), 'Traced gateway must start');
    const base = `http://127.0.0.1:${port}`;
    const headers = {Authorization: `Bearer ${token}`, Cookie: `session=${cookie}`, 'Content-Type': 'application/json'};
    assert.equal((await fetch(`${base}/api/conversations?token=${query}`, {headers})).status, 404);
    const input = await fetch(`${base}/api/conversations/${randomUUID()}/inputs`, {method: 'POST', headers,
      body: JSON.stringify({request_id: randomUUID(), text: prompt})});
    assert.equal(input.status, 200);
    const message = await fetch(`${base}/api/chats/chief-of-staff/messages`, {method: 'POST', headers,
      body: JSON.stringify({id: randomUUID(), text: chat})});
    assert.equal(message.status, 200);
    const traces = () => Buffer.concat(received.filter(body => body.toString('latin1').startsWith('/v0.4/traces')));
    await wait(() => ['web.request', 'http.request', '/api/chats/chief-of-staff/messages'].every(text => traces().includes(text)),
      'Server and client spans must reach the agent');
    assert.ok(traces().includes('forge-gateway'));
    assert.ok(propagated, 'Upstream calls carry trace context');
  } finally {
    child.kill('SIGTERM');
    await exited;
    await close(agent); await close(crew);
  }
  for (const secret of secrets) {
    assert.ok(!received.some(body => body.includes(secret)), 'Agent payloads must not contain request secrets or text');
    assert.ok(!output.includes(secret), 'Gateway output must not contain request secrets or text');
  }
});
