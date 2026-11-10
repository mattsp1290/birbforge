import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import { z } from 'zod/v4';
import { VerificationAdmission, VerificationCancellation, VerificationRequest, VerificationSnapshot } from '../app/src/verification-contract';
import { validVerificationManifest } from './verification-contract';

export const VerificationConfig = z.object({
  python: z.string().startsWith('/'),
  configuration: z.string().startsWith('/'),
}).strict();

const Reply = z.discriminatedUnion('ok', [
  z.object({ok: z.literal(true), value: z.unknown()}).strict(),
  z.object({ok: z.literal(false), status: z.union([z.literal(400), z.literal(403), z.literal(404), z.literal(409), z.literal(413), z.literal(429), z.literal(503)]), code: z.string().max(160)}).strict(),
]);
let activeCommands = 0;

class VerificationError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

async function command(config: z.infer<typeof VerificationConfig>, input: {
  op: 'snapshot' | 'admit' | 'cancel'; principal: string; conversation_id: string; body: unknown;
} | {op: 'factory'; principal: string}): Promise<unknown> {
  if (activeCommands >= 4) throw new VerificationError(503, 'verification_busy_retry_same_command');
  activeCommands++;
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn(config.python, ['-m', 'verification.adapter', config.configuration], {
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
        reject(new VerificationError(503, input.op === 'snapshot' || input.op === 'factory' ? 'verification_observation_unavailable' : 'verification_acknowledgement_unknown'));
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
    if (!reply.ok) throw new VerificationError(reply.status, reply.code);
    return reply.value;
  } finally { activeCommands--; }
}

export function verificationQueueStatus(config: z.infer<typeof VerificationConfig>, principal: string) {
  return command(config, {op: 'factory', principal});
}

export async function serveVerification(input: {
  config: z.infer<typeof VerificationConfig> | undefined;
  producerUrl: string; credential: string; principal: string; conversationId: string;
  action: string | undefined; request: IncomingMessage; response: ServerResponse;
  readBody: () => Promise<unknown>;
}) {
  const {request, response, action, conversationId} = input;
  const send = (status: number, payload: unknown) => {
    response.writeHead(status, {'Content-Type': 'application/json'});
    response.end(JSON.stringify(payload));
  };
  if (!input.config) return send(404, {code: 'verification_unavailable'});
  const observing = action === 'events';
  const method = request.method;
  if ((action && method !== 'POST') || (!action && method !== 'GET' && method !== 'POST')) {
    return send(405, {code: 'method_not_allowed'});
  }
  let payload: unknown = {};
  try {
    if (method === 'POST') {
      const body = await input.readBody();
      if (observing) {
        const observation = RunAgentInputSchema.parse(body);
        if (observation.threadId !== conversationId || observation.messages.length || observation.tools.length || observation.context.length || Object.keys(observation.state ?? {}).length || Object.keys(observation.forwardedProps ?? {}).length) {
          return send(400, {code: 'observation_only'});
        }
      } else payload = action === 'cancel' ? VerificationCancellation.parse(body) : VerificationAdmission.parse(body);
    }
  } catch { return send(400, {code: 'invalid_command'}); }
  try {
    const ownership = await fetch(`${input.producerUrl}/conversations/${conversationId}`, {
      headers: {Authorization: `Bearer ${input.credential}`}, redirect: 'manual', signal: AbortSignal.timeout(10_000),
    });
    await ownership.body?.cancel();
    if (!ownership.ok) return send(ownership.status === 404 || ownership.status === 403 ? 404 : 503, {code: 'conversation_unavailable'});
    const op = observing || method === 'GET' ? 'snapshot' : action === 'cancel' ? 'cancel' : 'admit';
    const result = await command(input.config, {op, principal: input.principal, conversation_id: conversationId, body: payload});
    if (op !== 'snapshot') {
      const receipt = VerificationRequest.parse(result);
      if (receipt.manifest !== null && !validVerificationManifest(receipt.manifest)) {
        throw new VerificationError(503, 'verification_manifest_invalid');
      }
      return send(200, receipt);
    }
    const snapshot = VerificationSnapshot.parse(result);
    if (snapshot.requests.some(row => row.manifest !== null && !validVerificationManifest(row.manifest))) {
      throw new VerificationError(503, 'verification_manifest_invalid');
    }
    if (!observing) return send(200, snapshot);
    const runId = randomUUID();
    response.writeHead(200, {'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no'});
    for (const event of [
      {type: 'RUN_STARTED', threadId: conversationId, runId},
      {type: 'STATE_SNAPSHOT', snapshot: {verification: snapshot}},
      {type: 'RUN_FINISHED', threadId: conversationId, runId},
    ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.end();
  } catch (error) {
    if (error instanceof VerificationError) return send(error.status, {code: error.code});
    return send(503, {code: observing || method === 'GET' ? 'verification_observation_unavailable' : 'verification_acknowledgement_unknown'});
  }
}
