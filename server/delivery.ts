import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import { z } from 'zod/v4';
import {DeliveryCommand, DeliverySnapshot} from '../app/src/delivery-contract';

export const DeliveryConfig = z.object({
  python: z.string().startsWith('/'),
  configuration: z.string().startsWith('/'),
}).strict();

const Reply = z.discriminatedUnion('ok', [
  z.object({ok: z.literal(true), value: z.unknown()}).strict(),
  z.object({ok: z.literal(false), status: z.union([z.literal(400), z.literal(403), z.literal(404), z.literal(409), z.literal(413), z.literal(429), z.literal(503)]), code: z.string().max(160)}).strict(),
]);
let activeCommands = 0;

class DeliveryError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

async function command(config: z.infer<typeof DeliveryConfig>, input: {
  op: 'snapshot' | 'command'; principal: string; conversation_id: string; body: unknown;
}): Promise<unknown> {
  if (activeCommands >= 4) throw new DeliveryError(503, 'delivery_busy_retry_same_command');
  activeCommands++;
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn(config.python, ['-m', 'delivery.adapter', config.configuration], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: {PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', NODE_ENV: 'test', PYTHONNOUSERSITE: '1', PYTHONUNBUFFERED: '1',
          DD_INJECTION_ENABLED: 'false', DD_TRACE_ENABLED: 'false', DD_INSTRUMENTATION_TELEMETRY_ENABLED: 'false', OTEL_SDK_DISABLED: 'true'},
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const chunks: Buffer[] = [];
      let size = 0;
      let failed = false;
      const fail = () => {
        if (failed) return;
        failed = true;
        child.kill('SIGKILL');
        reject(new DeliveryError(503, input.op === 'snapshot' ? 'delivery_observation_unavailable' : 'delivery_acknowledgement_unknown'));
      };
      const timeout = setTimeout(fail, 20_000);
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1_048_576) fail();
        else chunks.push(chunk);
      });
      child.stderr.resume();
      child.stdin.on('error', fail);
      child.on('error', fail);
      child.on('close', code => {
        clearTimeout(timeout);
        if (code !== 0) fail();
        else if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
      });
      child.stdin.end(JSON.stringify(input));
    });
    const reply = Reply.parse(JSON.parse(raw));
    if (!reply.ok) throw new DeliveryError(reply.status, reply.code);
    return reply.value;
  } finally { activeCommands--; }
}

export async function serveDelivery(input: {
  config: z.infer<typeof DeliveryConfig> | undefined;
  producerUrl: string; credential: string; principal: string; conversationId: string;
  action: string | undefined; request: IncomingMessage; response: ServerResponse;
  readBody: () => Promise<unknown>;
}) {
  const {request, response, action, conversationId} = input;
  const send = (status: number, payload: unknown) => {
    response.writeHead(status, {'Content-Type': 'application/json'});
    response.end(JSON.stringify(payload));
  };
  if (!input.config) return send(404, {code: 'delivery_unavailable'});
  const observing = action === 'events';
  if (request.method !== (action ? 'POST' : 'GET')) return send(405, {code: 'method_not_allowed'});
  let payload: unknown = null;
  try {
    if (action) {
      const raw = await input.readBody();
      if (observing) {
        const run = RunAgentInputSchema.parse(raw);
        if (run.threadId !== conversationId || run.messages.length || run.tools.length || run.context.length || Object.keys(run.state ?? {}).length || Object.keys(run.forwardedProps ?? {}).length) return send(400, {code: 'observation_only'});
      } else payload = DeliveryCommand.parse(raw);
    }
  } catch {return send(400, {code: 'invalid_command'});}
  try {
    const ownership = await fetch(`${input.producerUrl}/conversations/${conversationId}`, {
      headers: {Authorization: `Bearer ${input.credential}`}, redirect: 'manual', signal: AbortSignal.timeout(10_000),
    });
    await ownership.body?.cancel();
    if (!ownership.ok) return send(ownership.status === 404 || ownership.status === 403 ? 404 : 503, {code: 'conversation_unavailable'});
    const snapshot = DeliverySnapshot.parse(await command(input.config, {
      op: action === 'command' ? 'command' : 'snapshot', principal: input.principal,
      conversation_id: conversationId, body: payload,
    }));
    if (!observing) return send(200, snapshot);
    const runId = randomUUID();
    response.writeHead(200, {'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no'});
    for (const event of [
      {type: 'RUN_STARTED', threadId: conversationId, runId},
      {type: 'STATE_SNAPSHOT', snapshot: {delivery: snapshot}},
      {type: 'RUN_FINISHED', threadId: conversationId, runId},
    ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.end();
  } catch (error) {
    if (error instanceof DeliveryError) return send(error.status, {code: error.code});
    return send(503, {code: 'delivery_acknowledgement_unknown'});
  }
}
