import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
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

const forced = {
  DD_REMOTE_CONFIGURATION_ENABLED: 'false', DD_APPSEC_ENABLED: 'false', DD_IAST_ENABLED: 'false', DD_DYNAMIC_INSTRUMENTATION_ENABLED: 'false',
  DD_TRACE_HEADER_TAGS: '', DD_TRACE_CLIENT_IP_ENABLED: 'false', DD_TRACE_BAGGAGE_TAG_KEYS: '', DD_TRACE_OBFUSCATION_QUERY_STRING_REGEXP: '.*',
  DD_TRACE_CHILD_PROCESS_ENABLED: 'false',
};
// Values that would record request data or let the agent change that later.
const hostile = {
  DD_REMOTE_CONFIGURATION_ENABLED: 'true', DD_APPSEC_ENABLED: 'true', DD_IAST_ENABLED: 'true', DD_DYNAMIC_INSTRUMENTATION_ENABLED: 'true',
  DD_TRACE_HEADER_TAGS: 'authorization:auth,cookie:cookie', DD_TRACE_CLIENT_IP_ENABLED: 'true', DD_TRACE_BAGGAGE_TAG_KEYS: '*',
  DD_TRACE_OBFUSCATION_QUERY_STRING_REGEXP: '', DD_TRACE_CHILD_PROCESS_ENABLED: 'true',
};

test('tracing preload loads nothing unless DD_TRACE_ENABLED is exactly true, and then forces private settings', () => {
  const keys = ['DD_SERVICE', ...Object.keys(forced)];
  const probe = `process.stdout.write(JSON.stringify([typeof globalThis._ddtrace, ${JSON.stringify(keys)}.map(key => process.env[key] ?? null)]))`;
  // Dead agent and DogStatsD ports keep these runs away from a developer's real agent. DogStatsD falls back to UDP when HTTP fails.
  const run = (env: Record<string, string>) => JSON.parse(execFileSync(process.execPath, ['--import', './server/tracing.mjs', '-e', probe],
    {env: {NODE_ENV: 'test', PATH: process.env.PATH ?? '/usr/bin:/bin', DD_TRACE_AGENT_URL: 'http://127.0.0.1:9', DD_DOGSTATSD_PORT: '9', DD_RUNTIME_METRICS_ENABLED: 'false', ...env}, encoding: 'utf8'}));
  for (const value of [undefined, 'false', '1', 'TRUE']) {
    assert.deepEqual(run(value === undefined ? {} : {DD_TRACE_ENABLED: value}), ['undefined', keys.map(() => null)]);
  }
  assert.deepEqual(run({DD_TRACE_ENABLED: 'true', DD_INSTRUMENTATION_TELEMETRY_ENABLED: 'false', ...hostile}),
    ['object', ['forge-gateway', ...Object.values(forced)]]);
});

test('traced gateway exports spans without credentials, cookies, query strings, client IPs, baggage, argv or message text', async () => {
  const token = randomBytes(24).toString('hex');
  const secrets = [token, `cookie-${randomUUID()}`, `query-${randomUUID()}`, `prompt-${randomUUID()}`, `chat-${randomUUID()}`,
    `baggage-${randomUUID()}`, `hub-${randomUUID()}`, `203.0.113.${1 + randomBytes(1)[0] % 254}`];
  const [, cookie, query, prompt, chat, baggage, hub, clientIp] = secrets;
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
  // The standalone catalog runs `bn --hub <path>`, so this path reaches a child's argv.
  mkdirSync(join(root, hub));
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--tsconfig', 'tsconfig.node.json', '--import', './server/tracing.mjs', 'server/main.ts'], {
    env: {NODE_ENV: 'test', PATH: '/usr/bin:/bin', BIRBFORGE_CLIENT_CONFIG: config, BIRBFORGE_PORT: String(port),
      BIRBFORGE_WORKSPACE_DIR: join(root, 'workspace'), BIRBFORGE_BEANS_HUB: join(root, hub), BIRBFORGE_CHAT_MODE: 'local', DD_TRACE_ENABLED: 'true',
      DD_TRACE_AGENT_URL: `http://127.0.0.1:${agentPort}`, DD_DOGSTATSD_PORT: '9', DD_RUNTIME_METRICS_ENABLED: 'false', DD_TRACE_FLUSH_INTERVAL: '100',
      DD_ENV: 'test', DD_VERSION: 'test', ...hostile},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => {output += chunk;});
  child.stderr.on('data', chunk => {output += chunk;});
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  try {
    await wait(() => output.includes('Forge loopback gateway ready.'), 'Traced gateway must start');
    const base = `http://127.0.0.1:${port}`;
    // Baggage is tagged only when the request also carries trace context.
    const headers = {Authorization: `Bearer ${token}`, Cookie: `session=${cookie}`, Baggage: `session.id=${baggage}`,
      Traceparent: `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`,
      'X-Forwarded-For': clientIp, 'Content-Type': 'application/json'};
    assert.equal((await fetch(`${base}/api/conversations?token=${query}`, {headers})).status, 404);
    const input = await fetch(`${base}/api/conversations/${randomUUID()}/inputs`, {method: 'POST', headers,
      body: JSON.stringify({request_id: randomUUID(), text: prompt})});
    assert.equal(input.status, 200);
    const message = await fetch(`${base}/api/chats/chief-of-staff/messages`, {method: 'POST', headers,
      body: JSON.stringify({id: randomUUID(), text: chat})});
    assert.equal(message.status, 200);
    assert.equal((await fetch(`${base}/api/catalog`, {headers})).status, 200);
    const traces = () => Buffer.concat(received.filter(body => body.toString('latin1').startsWith('/v0.4/traces')));
    await wait(() => ['web.request', 'http.request', '/api/chats/chief-of-staff/messages'].every(text => traces().includes(text)),
      'Server and client spans must reach the agent');
    assert.ok(traces().includes('forge-gateway'));
    assert.ok(propagated, 'Upstream calls carry trace context');
  } finally {
    child.kill('SIGTERM');
    await exited;
    await close(agent); await close(crew);
    rmSync(root, {recursive: true, force: true});
  }
  for (const secret of secrets) {
    assert.ok(!received.some(body => body.includes(secret)), 'Agent payloads must not contain request secrets or text');
    assert.ok(!output.includes(secret), 'Gateway output must not contain request secrets or text');
  }
});
