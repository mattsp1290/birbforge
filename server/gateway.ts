import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import { z } from 'zod/v4';
import { Snapshot, Decision, Prompt } from '../app/src/contract';

export const GatewayConfig = z.object({
  url: z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1';
  }),
  tokens: z.record(z.string(), z.string().min(32)),
});

async function body(request: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64_000) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function gateway(config: z.infer<typeof GatewayConfig>, webRoot?: string) {
  const hashes = Object.values(config.tokens).map(token => ({
    token, hash: createHash('sha256').update(token).digest(),
  }));
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status: number, code: string) => {
      response.writeHead(status, {'Content-Type': 'application/json'});
      response.end(JSON.stringify({code}));
    };
    if (!/^127\.0\.0\.1(?::[0-9]+)?$/.test(request.headers.host ?? '')) return send(403, 'host_rejected');
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/api/')) {
      if (!webRoot || request.method !== 'GET') return send(404, 'not_found');
      const root = resolve(webRoot);
      let pathname: string;
      try { pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); }
      catch { return send(400, 'invalid_path'); }
      const path = resolve(root, '.' + pathname);
      if (!path.startsWith(root + sep)) return send(404, 'not_found');
      try {
        const content = await readFile(path);
        response.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript' : extname(path) === '.html' ? 'text/html' : 'application/octet-stream');
        response.end(content);
      } catch { send(404, 'not_found'); }
      return;
    }
    const authorization = request.headers.authorization ?? '';
    const digest = createHash('sha256').update(authorization.slice(7)).digest();
    const credential = authorization.startsWith('Bearer ') && hashes.find(entry => timingSafeEqual(entry.hash, digest));
    if (!credential) return send(401, 'authentication_required');
    if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
      return send(403, 'origin_rejected');
    }
    const match = /^\/api\/conversations(?:\/([0-9a-f-]{36})(?:\/(inputs|decision|events|cancel))?)?$/.exec(url.pathname);
    if (!match || url.search) return send(404, 'not_found');
    const [, cid, action] = match;
    if (cid && !z.string().uuid().safeParse(cid).success) return send(400, 'invalid_conversation');
    const method = request.method;
    if (method !== (cid && !action ? 'GET' : 'POST')) return send(405, 'method_not_allowed');
    let payload: unknown;
    try {
      if (method === 'POST') {
        const input = await body(request);
        if (!cid) payload = z.object({id: z.string().uuid()}).strict().parse(input);
        else if (action === 'inputs') payload = Prompt.parse(input);
        else if (action === 'decision') payload = Decision.parse(input);
        else if (action === 'cancel') payload = z.object({}).strict().parse(input);
        else {
          const observation = RunAgentInputSchema.parse(input);
          if (observation.threadId !== cid || observation.messages.length || observation.tools.length || observation.context.length || Object.keys(observation.state ?? {}).length || Object.keys(observation.forwardedProps ?? {}).length) return send(400, 'observation_only');
          payload = observation;
        }
      }
    } catch { return send(400, 'invalid_command'); }
    const path = '/conversations' + (cid ? `/${cid}` : '') + (action ? `/${action === 'decision' ? 'human' : action}` : '');
    const abort = new AbortController();
    response.on('close', () => abort.abort());
    try {
      const upstream = await fetch(config.url + path, {
        method, redirect: 'manual', headers: {Authorization: `Bearer ${credential.token}`, 'Content-Type': 'application/json'},
        body: method === 'POST' ? JSON.stringify(payload) : undefined, signal: abort.signal,
      });
      if (upstream.ok && (!action || !cid)) {
        const snapshot = Snapshot.parse(await upstream.json());
        response.writeHead(upstream.status, {'Content-Type': 'application/json'});
        response.end(JSON.stringify(snapshot));
        return;
      }
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
        ...(action === 'events' ? {'X-Accel-Buffering': 'no'} : {}),
      });
      if (upstream.body) {
        const reader = upstream.body.getReader();
        const stream = Readable.from((async function* () {
          try {
            while (true) {
              const next = await reader.read();
              if (next.done) return;
              yield next.value;
            }
          } finally { reader.releaseLock(); }
        })());
        stream.on('error', () => response.end());
        stream.pipe(response);
      }
      else response.end();
    } catch {
      if (!response.headersSent) send(503, 'acknowledgement_unknown_retry_same_request');
      else response.end();
    }
  });
}
