import {randomUUID} from 'node:crypto';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {z} from 'zod/v4';

type Status = 'accepted' | 'running' | 'waiting' | 'completed' | 'cancellation_requested' | 'cancelled' | 'failed' | 'uncertain';
export type Submit = 'drop' | 'lose-ack' | 'hang' | 'complete' | {status: number; error: string; record?: boolean};
type Request = {conversationId: string; requestId: string; text: string; status: Status; steps: Status[]; reason?: string};

const uuid = z.uuid().transform(value => value.toLowerCase());
const text = z.string().min(1).refine(value => Buffer.byteLength(value) <= 16_384 && value.isWellFormed() && !value.includes('\0'));
const Spawn = z.strictObject({requestId: uuid, engine: z.enum(['pi', 'claude', 'codex']), profile: z.string().min(1)});
const Open = z.strictObject({conversationId: uuid, memberId: uuid});
const Submission = z.strictObject({requestId: uuid, text});

export async function startFakeCrew(token: string, registered: string[]) {
  const members = new Map<string, {memberId: string; engine: string; profile: string}>();
  const conversations = new Map<string, string>();
  const requests = new Map<string, Request>();
  const fake = {
    url: '', apiVersion: '1', receiptVersion: '1', maximumTurns: 128,
    members, conversations, requests, registered, active: 0, peak: 0, lookups: 0,
    onRequest: (_path: string) => {},
    submissions: [] as {conversationId: string; requestId: string; text: string}[],
    authorizations: new Set<string>(),
    submits: [] as Submit[],
    steps: ['running', 'completed'] as Status[],
    reason: undefined as string | undefined,
    reply: (request: {text: string}) => 'Member reply: ' + request.text.split('\n').at(-1),
    close: async () => {},
  };
  const receipt = (request: Request) => ({
    apiVersion: fake.receiptVersion, conversationId: request.conversationId, requestId: request.requestId,
    acceptance: {boundary: 'sql_admission_and_temporal_queue'}, status: request.status,
    ...(request.status === 'completed' ? {result: {text: fake.reply(request)}} : {}),
    ...(request.reason ? {reason: request.reason} : {}),
  });
  async function body(request: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }
  function json(response: ServerResponse, status: number, data: unknown) {
    response.writeHead(status, {'Content-Type': 'application/json'});
    response.end(JSON.stringify(data));
  }
  async function route(request: IncomingMessage, response: ServerResponse) {
    fake.authorizations.add(request.headers.authorization ?? '');
    if (request.headers.authorization !== 'Bearer ' + token) return json(response, 401, {error: 'authentication_required'});
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    fake.onRequest(path);
    if (path === '/v1/capabilities' && request.method === 'GET') {
      return json(response, 200, {apiVersion: fake.apiVersion, requestContract: 'sql-admission-temporal-queue-v1',
        rollover: {version: 1, maximumTurns: fake.maximumTurns, generationTurns: 4}});
    }
    if (path === '/v1/members' && request.method === 'POST') {
      const input = Spawn.parse(await body(request));
      if (!registered.includes(`${input.engine}/${input.profile}`)) return json(response, 409, {error: 'unknown_profile'});
      const existing = members.get(input.requestId);
      if (existing && (existing.engine !== input.engine || existing.profile !== input.profile)) return json(response, 409, {error: 'conflict'});
      const member = existing ?? {memberId: randomUUID(), engine: input.engine, profile: input.profile};
      members.set(input.requestId, member);
      return json(response, 201, {ownerId: 'owner', ...member});
    }
    if (path === '/v1/conversations' && request.method === 'POST') {
      const input = Open.parse(await body(request));
      const member = [...members.values()].find(item => item.memberId === input.memberId);
      if (!member) return json(response, 404, {error: 'not_found'});
      if ((conversations.get(input.conversationId) ?? input.memberId) !== input.memberId) return json(response, 409, {error: 'conflict'});
      conversations.set(input.conversationId, input.memberId);
      return json(response, 201, {cursor: 0, messages: [], openText: null, openTools: {}, childText: {},
        state: {conversationId: input.conversationId, memberId: input.memberId, engine: member.engine, profile: member.profile, phase: 'idle', openStep: null, pendingApprovals: []}});
    }
    const match = /^\/v1\/conversations\/([^/]+)\/requests(?:\/([^/]+))?$/.exec(path);
    if (!match) return json(response, 404, {error: 'not_found'});
    const conversationId = uuid.parse(match[1]);
    if (!conversations.has(conversationId)) return json(response, 404, {error: 'not_found'});
    if (match[2] && request.method === 'GET') {
      fake.lookups++;
      const found = requests.get(conversationId + '/' + uuid.parse(match[2]));
      if (!found) return json(response, 404, {error: 'not_found'});
      found.status = found.steps.shift() ?? found.status;
      if (['failed', 'cancelled', 'uncertain'].includes(found.status)) found.reason = fake.reason;
      return json(response, 200, receipt(found));
    }
    if (match[2] || request.method !== 'POST') return json(response, 405, {error: 'method_not_allowed'});
    const input = Submission.parse(await body(request));
    fake.submissions.push({conversationId, ...input});
    const action = fake.submits.shift();
    if (action === 'drop') return response.destroy();
    if (typeof action === 'object' && !action.record) return json(response, action.status, {error: action.error});
    const key = conversationId + '/' + input.requestId;
    let found = requests.get(key);
    if (found && found.text !== input.text) return json(response, 409, {error: 'conflict'});
    if (!found) {
      if ([...requests.values()].filter(item => item.conversationId === conversationId).length >= fake.maximumTurns) return json(response, 409, {error: 'update_rejected'});
      found = {conversationId, requestId: input.requestId, text: input.text, status: 'accepted', steps: action === 'complete' ? ['completed'] : [...fake.steps]};
      requests.set(key, found);
    }
    if (action === 'complete') found.status = found.steps.shift() ?? found.status;
    if (typeof action === 'object') return json(response, action.status, {error: action.error});
    if (action === 'lose-ack') return response.destroy();
    if (action === 'hang') return;
    return json(response, 202, receipt(found));
  }
  const server = createServer((request, response) => {
    fake.peak = Math.max(fake.peak, ++fake.active);
    response.once('close', () => fake.active--);
    route(request, response).catch(() => {if (!response.headersSent) json(response, 400, {error: 'invalid_input'});});
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fake Crew did not bind');
  fake.url = 'http://127.0.0.1:' + address.port;
  fake.close = () => new Promise<void>(resolve => {server.close(() => resolve()); server.closeAllConnections();});
  return fake;
}
