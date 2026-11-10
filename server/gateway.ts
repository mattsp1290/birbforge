import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type RequestListener } from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import { z } from 'zod/v4';
import { Snapshot, Decision, Prompt } from '../app/src/contract';
import type { ListenerPolicy, ProxySettings } from './access';
import { VerificationConfig, serveVerification } from './verification';
import {DeliveryConfig, serveDelivery} from './delivery';
import {Projects, ProjectsConfig} from './projects';
import {ProjectError} from './beans-projects';
import {GitHubUnavailable} from './github';

export const GatewayConfig = z.object({
  url: z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1';
  }),
  tokens: z.record(z.string(), z.string().min(32)),
  verification: VerificationConfig.optional(),
  mode: z.enum(['proof', 'approved-goal']).default('proof'),
  delivery: DeliveryConfig.optional(),
  projects: ProjectsConfig.optional(),
}).superRefine((config, context) => {
  if (config.mode === 'approved-goal' && (!config.delivery || config.verification)) context.addIssue({code: 'custom', message: 'Approved goal mode requires delivery and disables fixture verification'});
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

export function gatewayHandler(config: z.infer<typeof GatewayConfig>, policy: ListenerPolicy, webRoot?: string): RequestListener {
  const projects = config.projects ? new Projects(config.projects) : null;
  const external = policy.kind === 'privateProxy' ? new URL(policy.settings.origin) : null;
  const hashes = Object.entries(config.tokens).map(([principal, token]) => ({
    principal, token, hash: createHash('sha256').update(token).digest(),
  }));
  const authentication = policy.kind === 'privateProxy' ? policy.settings.authentication : undefined;
  const owner = authentication?.kind === 'private-single-owner'
    ? hashes.find(entry => entry.principal === authentication.principal) : undefined;
  if (authentication?.kind === 'private-single-owner' && !owner) throw new Error('Private owner credential is not configured');
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status: number, code: string) => {
      response.writeHead(status, {'Content-Type': 'application/json'});
      response.end(JSON.stringify({code}));
    };
    if (policy.kind === 'privateProxy') {
      const source = request.socket.remoteAddress?.replace(/^::ffff:/, '') ?? '';
      if (source !== '127.0.0.1') return send(403, 'proxy_source_rejected');
      if (request.headers.host !== external?.host) return send(403, 'host_rejected');
    } else if (!/^127\.0\.0\.1(?::[0-9]+)?$/.test(request.headers.host ?? '')) {
      return send(403, 'host_rejected');
    }
    if (!request.url?.startsWith('/') || request.url.startsWith('//')) return send(400, 'invalid_path');
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/healthz' && request.method === 'GET' && !url.search) return send(200, 'ready');
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
    const allowedOrigin = external?.origin ?? `http://${request.headers.host}`;
    if (request.headers.origin !== undefined && request.headers.origin !== allowedOrigin) {
      return send(403, 'origin_rejected');
    }
    if (url.pathname === '/api/access' && request.method === 'GET' && !url.search) {
      response.writeHead(200, {'Content-Type': 'application/json'});
      response.end(JSON.stringify({kind: owner ? 'private-single-owner' : 'bearer'}));
      return;
    }
    const authorization = request.headers.authorization ?? '';
    const digest = createHash('sha256').update(authorization.slice(7)).digest();
    const credential = owner ?? (authorization.startsWith('Bearer ') && hashes.find(entry => timingSafeEqual(entry.hash, digest)));
    if (!credential) return send(401, 'authentication_required');
    if (url.pathname.startsWith('/api/projects') || url.pathname === '/api/github/repositories') {
      if (!projects) return send(404, 'projects_unavailable');
      return projects.serve({url, request, response, principal: credential.principal, producerUrl: config.url, credential: credential.token, readBody: () => body(request)});
    }
    const delivery = /^\/api\/conversations\/([0-9a-f-]{36})\/delivery(?:\/(command|events))?$/.exec(url.pathname);
    if (delivery && !url.search) {
      const [, conversationId, action] = delivery;
      if (!z.string().uuid().safeParse(conversationId).success) return send(400, 'invalid_conversation');
      if (projects) {
        try {
          const chat = z.object({kind: z.string().optional()}).parse(await projects.producer(config.url, credential.token, `/conversations/${conversationId}`));
          if (chat.kind === 'project') return send(409, 'ready_producer_not_admitted');
        } catch (error) {return send(error instanceof ProjectError && error.status === 404 ? 404 : 503, 'conversation_unavailable');}
      }
      return serveDelivery({config: config.mode === 'approved-goal' ? config.delivery : undefined, producerUrl: config.url,
        credential: credential.token, principal: credential.principal, conversationId, action,
        request, response, readBody: () => body(request)});
    }
    const verification = /^\/api\/conversations\/([0-9a-f-]{36})\/verification(?:\/(cancel|events))?$/.exec(url.pathname);
    if (verification && !url.search) {
      const [, conversationId, action] = verification;
      if (!z.string().uuid().safeParse(conversationId).success) return send(400, 'invalid_conversation');
      return serveVerification({config: config.verification, producerUrl: config.url,
        credential: credential.token, principal: credential.principal, conversationId, action,
        request, response, readBody: () => body(request)});
    }
    const match = /^\/api\/conversations(?:\/([0-9a-f-]{36})(?:\/(inputs|decision|events|cancel))?)?$/.exec(url.pathname);
    if (!match || url.search) return send(404, 'not_found');
    const [, cid, action] = match;
    if (cid && !z.string().uuid().safeParse(cid).success) return send(400, 'invalid_conversation');
    if (projects && cid && action === 'inputs' && request.method === 'POST' && !url.search) {
      try {
        const chat = z.object({kind: z.string().optional()}).parse(await projects.producer(config.url, credential.token, `/conversations/${cid}`));
        if (chat.kind === 'project') {
          if (credential.principal !== config.projects?.owner_principal) return send(404, 'not_found');
          const result = await projects.submit(cid, config.url, credential.token, await body(request));
          response.writeHead(200, {'Content-Type': 'application/json'}); response.end(JSON.stringify(result)); return;
        }
      } catch (error) {
        if (error instanceof ProjectError) return send(error.status, error.code);
        if (error instanceof GitHubUnavailable) return send(error.status, error.code);
        return send(error instanceof z.ZodError ? 400 : 503, 'project_input_unavailable');
      }
    }
    if (config.mode === 'approved-goal' && action && ['inputs', 'decision', 'cancel'].includes(action)) {
      if (!projects || action !== 'cancel' || !cid) return send(409, 'use_delivery_command');
      try {
        const chat = z.object({kind: z.string().optional()}).parse(await projects.producer(config.url, credential.token, `/conversations/${cid}`));
        if (chat.kind !== 'project') return send(409, 'use_delivery_command');
      } catch {return send(503, 'conversation_unavailable');}
    }
    const method = request.method;
    if (method !== (cid && !action ? 'GET' : !cid && request.method === 'GET' ? 'GET' : 'POST')) return send(405, 'method_not_allowed');
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
        if (!cid && method === 'GET') {
          const conversations = z.array(z.object({id: z.string().uuid(), revision: z.number().int().nonnegative()}).strict()).parse(await upstream.json());
          response.writeHead(200, {'Content-Type': 'application/json'});
          response.end(JSON.stringify(conversations));
          return;
        }
        const raw = z.record(z.string(), z.unknown()).parse(await upstream.json());
        const snapshot = Snapshot.parse({...raw, mode: raw.kind === 'project' ? 'project' : config.mode});
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
  };
}

export function gateway(config: z.infer<typeof GatewayConfig>, webRoot?: string) {
  return createServer(gatewayHandler(config, {kind: 'loopback'}, webRoot));
}

export function privateGateway(config: z.infer<typeof GatewayConfig>, settings: ProxySettings, webRoot?: string) {
  const server = createServer(gatewayHandler(config, {kind: 'privateProxy', settings}, webRoot));
  server.on('connection', socket => {
    const source = socket.remoteAddress?.replace(/^::ffff:/, '') ?? '';
    if (source !== '127.0.0.1') socket.destroy();
  });
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;
  return server;
}
