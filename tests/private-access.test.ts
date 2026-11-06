import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer as httpServer, request as httpRequest, type Server} from 'node:http';
import {createServer as httpsServer, request as httpsRequest} from 'node:https';
import {mkdtempSync, readFileSync, writeFileSync, chmodSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {checkServerIdentity} from 'node:tls';
import {join} from 'node:path';
import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {HttpAgent, type HttpAgentFetchFn} from '@ag-ui/client';
import {z} from 'zod/v4';
import {gatewayHandler, GatewayConfig, privateGateway} from '../server/gateway';
import {ProxyConfig, loadProxyConfig} from '../server/access';
import {ConversationClient, ActionError} from '../app/src/controller';
import {dependencyRevision} from '../app/src/contract';

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
async function wait(check: () => boolean) {
  const deadline = Date.now() + 60_000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Authoritative state must converge');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
function tlsFetch(ca?: Buffer, servername?: string): HttpAgentFetchFn {
  return (url, init) => new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {headers[key] = value;});
    const request = httpsRequest(url, {ca, servername:servername ?? '', checkServerIdentity:(_host, cert) => checkServerIdentity(servername ?? new URL(url).hostname, cert), method:init.method, headers, agent:false}, incoming => {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const chunk of incoming) {
              const value: unknown = chunk;
              assert.ok(Buffer.isBuffer(value));
              if (!cancelled) controller.enqueue(value);
            }
            if (!cancelled) controller.close();
          } catch (error) {if (!cancelled) controller.error(error);}
        },
        cancel() {cancelled = true; request.destroy();},
      });
      resolve(new Response(body, {status:incoming.statusCode, headers:{'Content-Type':incoming.headers['content-type'] ?? 'application/json'}}));
    });
    const abort = () => request.destroy(new Error('Fixture transport aborted'));
    request.on('error', reject);
    request.on('close', () => init.signal?.removeEventListener('abort', abort));
    init.signal?.addEventListener('abort', abort, {once:true});
    if (init.signal?.aborted) abort();
    if (init.body !== undefined && typeof init.body !== 'string') return reject(new Error('Fixture accepts JSON string bodies'));
    request.end(init.body);
  });
}
async function plainRequest(url: string, headers: Record<string,string> = {}, localAddress?: string) {
  return new Promise<{status:number; code:string}>( (resolve,reject) => {
    const request = httpRequest(url,{headers, localAddress}, incoming => {
      let body = '';
      incoming.setEncoding('utf8');
      incoming.on('data', chunk => {body += chunk;});
      incoming.on('end', () => {
        const parsed = JSON.parse(body);
        resolve({status:incoming.statusCode ?? 0, code:parsed.code ?? ''});
      });
    });
    request.on('error',reject); request.end();
  });
}
function certificate(root: string) {
  const run = (...args: string[]) => execFileSync('openssl', args, {cwd:root, stdio:'ignore'});
  run('req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.pem','-days','1','-subj','/CN=Birbforge disposable test CA');
  run('req','-newkey','rsa:2048','-nodes','-keyout','server.key','-out','server.csr','-subj','/CN=127.0.0.1');
  writeFileSync(join(root,'extensions'), 'subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
  run('x509','-req','-in','server.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-out','server.pem','-days','1','-extfile','extensions');
  return {key:readFileSync(join(root,'server.key')), cert:readFileSync(join(root,'server.pem'))};
}

test('private proxy configuration rejects public, wildcard, ambiguous and readable settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'birbforge-access-config-'));
  const settings = {port:8788, origin:'https://phone.example.invalid'};
  const path = join(root,'proxy.json');
  writeFileSync(path, JSON.stringify(settings), {mode:0o600});
  assert.deepEqual(loadProxyConfig(path), settings);
  assert.equal(ProxyConfig.safeParse({...settings, listenAddress:'0.0.0.0'}).success, false);
  for (const origin of ['http://phone.example.invalid','https://phone.example.invalid/','https://user:password@phone.example.invalid','https://phone.example.invalid/path']) {
    assert.equal(ProxyConfig.safeParse({...settings, origin}).success, false);
  }
  assert.equal(ProxyConfig.safeParse({...settings, trustedProxyAddresses:[]}).success, false);
  assert.equal(ProxyConfig.safeParse({...settings, trustForwardedHeaders:true}).success, false);
  assert.throws(() => loadProxyConfig('relative.json'), /absolute/);
  const link = join(root,'linked.json'); symlinkSync(path,link);
  assert.throws(() => loadProxyConfig(link), error => error instanceof Error && 'code' in error && error.code === 'ELOOP');
  chmodSync(path, 0o644);
  assert.throws(() => loadProxyConfig(path), /owner-only/);
});

test('trusted HTTPS proxy preserves authorization, action identity and AG-UI convergence', async () => {
  const session = JSON.parse(readFileSync('.local/session.json','utf8'));
  const producer = GatewayConfig.parse(JSON.parse(readFileSync(join(session.fixture_root,'clients.json'),'utf8')));
  const root = mkdtempSync(join(tmpdir(), 'birbforge-private-proxy-'));
  const tls = certificate(root);
  const ca = readFileSync(join(root,'ca.pem'));
  let backendPort = 0;
  let disconnectedStreams = 0;
  let inputPosts = 0;
  const proxy = httpsServer(tls, (request, response) => {
    if (request.url?.endsWith('/inputs')) inputPosts++;
    const upstream = httpRequest({hostname:'127.0.0.1', port:backendPort, path:request.url, method:request.method, headers:request.headers}, result => {
      response.writeHead(result.statusCode ?? 502, result.headers);
      result.pipe(response);
    });
    response.on('close', () => {
      if (request.url?.endsWith('/events')) disconnectedStreams++;
      upstream.destroy();
    });
    upstream.on('error', () => {response.destroy();});
    request.pipe(upstream);
  });
  const port = await listen(proxy);
  const origin = `https://127.0.0.1:${port}`;
  const settings = ProxyConfig.parse({port:8788, origin});
  const backend = privateGateway(producer, settings);
  backendPort = await listen(backend);
  const denied = httpServer(gatewayHandler(producer, {kind:'privateProxy', settings}));
  const deniedPort = await listen(denied);
  const fetch = tlsFetch(ca);
  const id = randomUUID();
  const a = new ConversationClient(origin, session.tokens.owner, id, fetch);
  const b = new ConversationClient(origin, session.tokens.owner, id, fetch);
  const observer = new HttpAgent({url:origin+`/api/conversations/${id}/events`, threadId:id, headers:{Authorization:`Bearer ${session.tokens.owner}`}, fetch});
  let observedPhase = '';
  let observedDecisions = 0;
  observer.subscribe({onStateChanged: ({state}) => {
    const snapshot = z.object({phase:z.string(), decisions:z.array(z.unknown())}).parse(state);
    observedPhase = snapshot.phase;
    observedDecisions = snapshot.decisions.length;
  }});
  let observing: Promise<unknown> | undefined;
  try {
    await assert.rejects(tlsFetch()(origin, {method:'GET'}), error => error instanceof Error && 'code' in error && /CERT|ISSUER|UNABLE_TO_VERIFY_LEAF_SIGNATURE/.test(String(error.code)));
    await assert.rejects(tlsFetch(ca,'wrong.example.invalid')(origin, {method:'GET'}), error => error instanceof Error && 'code' in error && error.code === 'ERR_TLS_CERT_ALTNAME_INVALID');
    const authorized = {Authorization:`Bearer ${session.tokens.owner}`};
    const spoofed = await plainRequest(`http://127.0.0.1:${deniedPort}/api/conversations/${id}`, {...authorized, Host:new URL(origin).host, 'X-Forwarded-For':'127.0.0.1'}, '127.0.0.2');
    assert.equal(spoofed.status,403);
    assert.equal(spoofed.code,'proxy_source_rejected');
    await assert.rejects(plainRequest(`http://127.0.0.1:${backendPort}/api/conversations/${id}`, {...authorized,Host:new URL(origin).host}, '127.0.0.2'), error => error instanceof Error && 'code' in error && error.code === 'ECONNRESET');
    assert.equal((await fetch(origin+'/api/conversations', {method:'POST', body:'{}'})).status,401);
    assert.equal((await fetch(origin+'/api/conversations', {method:'POST', headers:{...authorized, Host:'wrong.example.invalid', 'X-Forwarded-Host':new URL(origin).host}, body:'{}'})).status,403);
    for (const untrustedOrigin of ['https://wrong.example.invalid', origin.replace('https:', 'http:')]) {
      assert.equal((await fetch(origin+'/api/conversations', {method:'POST', headers:{...authorized, Origin:untrustedOrigin, 'X-Forwarded-Proto':'https'}, body:'{}'})).status,403);
    }
    const sameOrigin = await fetch(origin+'/api/conversations', {method:'POST', headers:{...authorized, Origin:origin}, body:JSON.stringify({id})});
    assert.equal(sameOrigin.status,200);
    await a.connect();
    await a.submit({request_id:randomUUID(), text:'Verify the private coding fixture route and ask for the next step.'});
    await wait(() => a.getSnapshot().conversation?.phase === 'waiting');
    const pending = a.getSnapshot().conversation!.human!;
    observing = observer.runAgent().catch(() => undefined);
    await wait(() => observedPhase === 'waiting');
    await b.connect();
    await wait(() => b.getSnapshot().conversation?.human?.id === pending.id);
    const streamsBeforeDisconnect = disconnectedStreams;
    a.disconnect();
    await wait(() => disconnectedStreams > streamsBeforeDisconnect);
    await b.refresh();
    assert.equal(b.getSnapshot().conversation?.phase,'waiting');
    await assert.rejects(a.request(`/${id}/decision`, {request_id:pending.id, version:0, choice:'test'}), error => error instanceof ActionError && error.status === 409);
    const stranger = new ConversationClient(origin, session.tokens.stranger, id, fetch);
    await assert.rejects(stranger.request(`/${id}/decision`, {request_id:pending.id, version:pending.version, choice:'inspect'}), error => error instanceof ActionError && error.status === 404);
    const results = await Promise.allSettled([
      a.resolve({request_id:pending.id, version:pending.version, choice:'inspect'}),
      b.resolve({request_id:pending.id, version:pending.version, choice:'test'}),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length,1);
    assert.ok(results.some(result => result.status === 'rejected' && result.reason instanceof ActionError && result.reason.status === 409));
    await wait(() => b.getSnapshot().conversation?.phase === 'idle' && observedPhase === 'idle' && observedDecisions === 1);
    await a.connect();
    await wait(() => a.getSnapshot().connection === 'connected');
    await a.refresh(); await b.refresh();
    assert.deepEqual(a.getSnapshot().conversation,b.getSnapshot().conversation);
    assert.equal(a.getSnapshot().conversation?.decisions.length,1);
    assert.equal(inputPosts,1);
    assert.deepEqual(observer.messages.map(message => message.id), a.getSnapshot().conversation?.messages.map(message => message.id));
    writeFileSync('docs/evidence/private-access-checks.json', JSON.stringify({
      checkedAt:new Date().toISOString(), dependencyRevision, nodeVersion:process.version,
      target:'Linux TLS proxy fixture and actual pinned disposable producer; not live NetBird or native iPhone',
      tlsVerification:'Fixture CA trusted only by this test client; untrusted chain and hostname rejected',
      conversationId:id, requestId:pending.id, version:pending.version, inputPosts, decisions:1,
      disconnectedStreams, sseObserverFinalPhase:observedPhase, checks:['exact Host and HTTPS Origin','socket source checked; forwarded identity ignored','401 invalid auth and 404 stranger','one accepted raced decision and explicit 409 conflict','disconnect preserves durable wait; reconnect converges authoritative state'],
      liveNetBird:'NOT VERIFIED', nativePhone:'NOT VERIFIED', macBrowserOnNewRevision:'NOT VERIFIED',
    },null,2)+'\n');
  } finally {
    a.disconnect(); b.disconnect(); observer.abortRun();
    await observing;
    await close(proxy); await close(backend); await close(denied);
  }
});


test('launcher starts both policies only after validated private configuration', async () => {
  const session = JSON.parse(readFileSync('.local/session.json','utf8'));
  const root = mkdtempSync(join(tmpdir(), 'birbforge-private-startup-'));
  const reserveA = httpServer(); const reserveB = httpServer();
  const loopbackPort = await listen(reserveA); const proxyPort = await listen(reserveB);
  await close(reserveA); await close(reserveB);
  const path = join(root,'proxy.json');
  const ready = join(root,'ready.json');
  const origin = 'https://phone.example.invalid';
  writeFileSync(path,JSON.stringify({port:proxyPort,origin}),{mode:0o600});
  const child = spawn(process.execPath,['--import','tsx','server/main.ts'], {
    env:{NODE_ENV:'test', DD_INJECTION_ENABLED:'false', DD_TRACE_ENABLED:'false', DD_INSTRUMENTATION_TELEMETRY_ENABLED:'false', PATH:process.env.PATH ?? '/usr/bin:/bin', TSX_TSCONFIG_PATH:'tsconfig.node.json',
      BIRBFORGE_CLIENT_CONFIG:join(session.fixture_root,'clients.json'), BIRBFORGE_PORT:String(loopbackPort),
      BIRBFORGE_PROXY_CONFIG:path,BIRBFORGE_READY_FILE:ready}, stdio:'ignore',
  });
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  try {
    await wait(() => {
      assert.equal(child.exitCode,null,'Gateway startup must not exit');
      try {return JSON.parse(readFileSync(ready,'utf8')).proxyOrigin === origin;} catch {return false;}
    });
    const loopback = await globalThis.fetch(`http://127.0.0.1:${loopbackPort}/api/conversations`);
    assert.equal(loopback.status,401);
    const request = await plainRequest(`http://127.0.0.1:${proxyPort}/api/conversations`, {Host:'phone.example.invalid'});
    assert.equal(request.status,401);
    const wrongHost = await globalThis.fetch(`http://127.0.0.1:${proxyPort}/api/conversations`);
    assert.equal(wrongHost.status,403);
  } finally {child.kill('SIGTERM'); await exited;}
  chmodSync(path,0o644);
  const rejected = spawn(process.execPath,['--import','tsx','server/main.ts'], {
    env:{NODE_ENV:'test', DD_INJECTION_ENABLED:'false', DD_TRACE_ENABLED:'false', DD_INSTRUMENTATION_TELEMETRY_ENABLED:'false', PATH:process.env.PATH ?? '/usr/bin:/bin',TSX_TSCONFIG_PATH:'tsconfig.node.json',
      BIRBFORGE_CLIENT_CONFIG:join(session.fixture_root,'clients.json'),BIRBFORGE_PORT:String(loopbackPort),BIRBFORGE_PROXY_CONFIG:path}, stdio:'ignore',
  });
  const code = await new Promise<number | null>(resolve => rejected.once('exit',resolve));
  assert.equal(code,1);
});
