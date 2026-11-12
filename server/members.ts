import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {z} from 'zod/v4';
import {Engine} from '../app/src/catalog';

const Profile = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
export const MembersConfig = z.object({
  url: z.string().regex(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/).refine(value => Number(value.slice('http://127.0.0.1:'.length)) <= 65535),
  token_file: z.string().startsWith('/'),
  profiles: z.object({codex: Profile.optional(), pi: Profile.optional()}).strict().refine(profiles => profiles.codex || profiles.pi),
}).strict();
export type MembersConfig = z.infer<typeof MembersConfig>;

export const PendingState = z.enum(['queued', 'accepted', 'running', 'waiting', 'cancellation_requested']);
export type TurnState =
  | {state: z.infer<typeof PendingState>}
  | {state: 'completed'; answer: string}
  | {state: 'failed' | 'cancelled' | 'uncertain' | 'rejected' | 'limit'};
export type MemberTurn = {
  conversationId: string; requestId: string; payload: string; position: number;
  engine: Engine; profile: string; spawn: string; memberId: string | null; opened: boolean;
  state: z.infer<typeof PendingState>;
};

const namespace = Buffer.from('5f64c5d3bc934c8d9d90a38b21e7bfad', 'hex');
export function memberSpawnId(agentId: string, engine: Engine, profile: string) {
  const hash = createHash('sha1').update(namespace).update(JSON.stringify([agentId.toLowerCase(), engine, profile])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

const ApiVersion = z.string().refine(value => value.split('.')[0] === '1');
const Capabilities = z.object({apiVersion: ApiVersion, rollover: z.object({maximumTurns: z.number().int().positive()})});
const Identity = z.object({apiVersion: ApiVersion, conversationId: z.uuid(), requestId: z.uuid()});
const Receipt = z.discriminatedUnion('status', [
  Identity.extend({status: z.literal('completed'), result: z.object({text: z.string()})}),
  Identity.extend({status: z.enum(['accepted', 'running', 'waiting', 'cancellation_requested', 'cancelled', 'failed', 'uncertain'])}),
]);
const Member = z.object({memberId: z.uuid(), engine: Engine, profile: Profile});
const Opened = z.object({state: z.object({conversationId: z.uuid(), memberId: z.uuid()})});
const Failure = z.object({error: z.string()});

type Reply = {status: number; body: unknown} | null;
const rejected = (reply: Reply): reply is {status: number; body: unknown} =>
  reply !== null && (reply.status === 400 || (reply.status === 409 && Failure.safeParse(reply.body).data?.error !== 'busy'));

async function credential(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new Error('members_token_rejected');
    const token = (await file.readFile('utf8')).trim();
    if (!/^[\x21-\x7e]+$/.test(token)) throw new Error('members_token_rejected');
    return token;
  } finally {await file.close();}
}

export class MemberClient {
  private capabilities: {value: z.infer<typeof Capabilities>; at: number} | null = null;
  constructor(private readonly config: MembersConfig, private readonly timeout = 30_000) {}

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Reply> {
    try {
      const response = await fetch(this.config.url + '/v1' + path, {
        method, redirect: 'manual', signal: AbortSignal.timeout(this.timeout),
        headers: {Authorization: 'Bearer ' + await credential(this.config.token_file), ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {status: response.status, body: await response.json().catch(() => null)};
    } catch {return null;}
  }

  private async limits() {
    if (this.capabilities && Date.now() - this.capabilities.at < 60_000) return this.capabilities.value;
    const reply = await this.call('GET', '/capabilities');
    const parsed = Capabilities.safeParse(reply?.status === 200 ? reply.body : null);
    this.capabilities = parsed.success ? {value: parsed.data, at: Date.now()} : null;
    return this.capabilities?.value ?? null;
  }

  private receipt(turn: MemberTurn, body: unknown): TurnState | null {
    const parsed = Receipt.safeParse(body);
    if (!parsed.success || parsed.data.conversationId !== turn.conversationId.toLowerCase() ||
      parsed.data.requestId !== turn.requestId.toLowerCase()) return null;
    return parsed.data.status === 'completed' ? {state: 'completed', answer: parsed.data.result.text} : {state: parsed.data.status};
  }

  private async lookup(turn: MemberTurn): Promise<TurnState | 'missing' | null> {
    const reply = await this.call('GET', `/conversations/${turn.conversationId}/requests/${turn.requestId}`);
    if (reply?.status === 404) return 'missing';
    return reply?.status === 200 ? this.receipt(turn, reply.body) : null;
  }

  async advance(turn: MemberTurn, record: {member: (id: string) => void; opened: () => void}): Promise<TurnState> {
    const unchanged: TurnState = {state: turn.state};
    if (turn.state !== 'queued') {
      const found = await this.lookup(turn);
      return found === 'missing' ? unchanged : found ?? unchanged;
    }
    const capabilities = await this.limits();
    if (!capabilities) return unchanged;
    let memberId = turn.memberId;
    if (!memberId) {
      const reply = await this.call('POST', '/members', {requestId: turn.spawn, engine: turn.engine, profile: turn.profile});
      const member = Member.safeParse(reply?.status === 201 ? reply.body : null);
      if (!member.success || member.data.engine !== turn.engine || member.data.profile !== turn.profile) {
        return rejected(reply) ? {state: 'rejected'} : unchanged;
      }
      memberId = member.data.memberId;
      record.member(memberId);
    }
    if (!turn.opened) {
      const reply = await this.call('POST', '/conversations', {conversationId: turn.conversationId, memberId});
      const opened = Opened.safeParse(reply?.status === 201 ? reply.body : null);
      if (!opened.success || opened.data.state.conversationId !== turn.conversationId.toLowerCase() ||
        opened.data.state.memberId !== memberId.toLowerCase()) return rejected(reply) ? {state: 'rejected'} : unchanged;
      record.opened();
    }
    const found = await this.lookup(turn);
    if (found !== 'missing') return found ?? unchanged;
    if (turn.position > capabilities.rollover.maximumTurns) return {state: 'limit'};
    const reply = await this.call('POST', `/conversations/${turn.conversationId}/requests`, {requestId: turn.requestId, text: turn.payload});
    if (reply?.status === 202) return this.receipt(turn, reply.body) ?? unchanged;
    if (!rejected(reply)) return unchanged;
    if (reply.status === 409) {
      const after = await this.lookup(turn);
      if (after !== 'missing') return after ?? unchanged;
    }
    return {state: 'rejected'};
  }
}
