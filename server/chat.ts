import {execFile} from 'node:child_process';
import {chmodSync, mkdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod/v4';
import {Chat, MemberStatus, NewChat, NewMessage, Thread, Turn, chiefId, chiefName, ended} from '../app/src/chat';
import {Engine, type Agent, type Catalog} from '../app/src/catalog';
import type {FactoryStatus} from './factory';
import {MemberClient, PendingState, memberSpawnId, type MembersConfig, type TurnState} from './members';

export class ChatError extends Error {
  constructor(readonly status: number, code: string) {super(code);}
}

type ChatOptions = {
  directory: string;
  catalog: () => Promise<Catalog>;
  inspect: () => Promise<FactoryStatus>;
  python?: string;
  attestation?: string;
  providerKey?: () => Promise<string | undefined>;
  members?: MembersConfig;
  memberTiming?: {retry: number; maxRetry: number; timeout: number};
};

const chief: Agent = {
  id: chiefId, name: chiefName,
  instructions: 'Answer questions about this Forge workspace. Use inspect_factory to check its current state before reporting status.',
  projectIds: [],
};

function report(agent: Agent, catalog: Catalog | null, factory: FactoryStatus | null) {
  const isChief = agent.id === chiefId;
  const lines = [];
  if (isChief) {
    lines.push(factory ? `Gateway: ${factory.gateway}. Crew runtime: ${factory.runtime}. Verification: ${factory.verification}. Checked ${factory.checkedAt}.` : 'Factory status is unavailable.');
    if (factory?.queue) {
      const {environment, queued, running, finished} = factory.queue;
      lines.push(`Verification queue: ${queued} queued, ${running} running, ${finished} finished. Environment: ${environment}.`);
      if (factory.queue.uncertain) lines.push(`Requests awaiting reconciliation: ${factory.queue.uncertain}.`);
    }
  } else {
    lines.push(agent.instructions ? `${agent.name}: ${agent.instructions}` : agent.name);
  }
  if (!catalog) return [...lines, 'The project and agent catalog is unavailable.'].join('\n\n');
  const projects = isChief ? catalog.projects : catalog.projects.filter(project => agent.projectIds.includes(project.id));
  if (isChief) lines.push(catalog.agents.length ? 'Crew: ' + catalog.agents.map(item => item.name).join(', ') + '.' : 'The crew roster is empty.');
  if (!catalog.projectsAvailable) return [...lines, 'The Beans project hub is unavailable.'].join('\n\n');
  lines.push(projects.length
    ? 'Projects\n' + projects.map(project => `${project.id}: ${project.repositories.join(', ') || 'No repositories'}`).join('\n')
    : isChief ? 'No projects configured.' : 'No projects assigned.');
  return lines.join('\n\n');
}

const textLimit = 16_384;
function preface(agent: Agent, catalog: Catalog, text: string) {
  const open = '<forge-agent-context>\nForge sends this read-only workspace context once, before the first message. It is not part of the message.\n\n';
  const close = '\n</forge-agent-context>\n\n';
  const marker = '\n[context truncated]';
  const context = Buffer.from(report(agent, catalog, null).replaceAll('\0', ''));
  const budget = textLimit - Buffer.byteLength(open + close + text);
  if (context.length <= budget) return open + context.toString() + close + text;
  let end = budget - Buffer.byteLength(marker);
  while (end > 0 && (context[end] & 0xc0) === 0x80) end--;
  return open + context.subarray(0, end).toString() + marker + close + text;
}

async function agentReply(options: ChatOptions, chat: Chat, agent: Agent, inspection: string): Promise<string> {
  const {python, attestation} = options;
  if (!python) throw new ChatError(503, 'birbcrew_runner_unconfigured');
  const providerKey = attestation ? await options.providerKey?.() : undefined;
  if (attestation && !providerKey) throw new ChatError(503, 'provider_secret_required');
  const payload = JSON.stringify({id: chat.id, agent, turns: chat.turns, inspection, providerKey});
  return new Promise((accept, reject) => {
    const child = execFile(python, ['-I', resolve('scripts/chat-agent.py'), attestation ?? '--local'],
      {encoding: 'utf8', timeout: 90_000, maxBuffer: 256_000}, (error, stdout) => {
        if (error) return reject(new ChatError(503, 'birbcrew_reply_unavailable'));
        try { accept(z.string().min(1).parse(JSON.parse(stdout))); }
        catch { reject(new ChatError(503, 'birbcrew_reply_unavailable')); }
      });
    child.stdin?.on('error', () => {});
    child.stdin?.end(payload);
  });
}

const PendingTurn = z.object({
  thread: z.string(), id: z.string(), payload: z.string(), state: PendingState, position: z.number().int(),
  engine: Engine, profile: z.string(), spawn: z.string(), member: z.string().nullable(), opened: z.number().int(),
});

export function createChatService(options: ChatOptions) {
  let database: DatabaseSync | undefined;
  const replying = new Map<string, Promise<Chat>>();
  const timing = options.memberTiming ?? {retry: 1000, maxRetry: 15_000, timeout: 30_000};
  const abort = new AbortController();
  const members = options.members ? new MemberClient(options.members, timing.timeout, abort.signal) : null;
  function db() {
    if (!database) {
      mkdirSync(options.directory, {recursive: true, mode: 0o700});
      const file = join(options.directory, 'workspace-chats.sqlite');
      const opened = new DatabaseSync(file);
      chmodSync(file, 0o600);
      opened.exec(`
        CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY, agentId TEXT NOT NULL, agentName TEXT NOT NULL, title TEXT NOT NULL, updated INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS turns(id TEXT NOT NULL, thread TEXT NOT NULL REFERENCES threads(id), text TEXT NOT NULL, answer TEXT, PRIMARY KEY(thread,id));
        CREATE UNIQUE INDEX IF NOT EXISTS pending ON turns(thread) WHERE answer IS NULL;
        CREATE TABLE IF NOT EXISTS member_threads(thread TEXT PRIMARY KEY REFERENCES threads(id), engine TEXT NOT NULL, profile TEXT NOT NULL, spawn TEXT NOT NULL, opened INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS members(spawn TEXT PRIMARY KEY, id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS member_turns(thread TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(thread,id), FOREIGN KEY(thread,id) REFERENCES turns(thread,id));
      `);
      opened.prepare('INSERT OR IGNORE INTO threads VALUES (?, ?, ?, ?, 0)').run(chiefId, chiefId, chiefName, chiefName);
      database = opened;
    }
    return database;
  }
  function transaction(work: () => void) {
    db().exec('BEGIN IMMEDIATE');
    try {work(); db().exec('COMMIT');}
    catch (error) {db().exec('ROLLBACK'); throw error;}
  }
  const threadOf = ({engine, ...row}: Record<string, unknown>) => Thread.parse(engine ? {...row, engine} : row);
  const turnOf = ({state, ...row}: Record<string, unknown>) => Turn.parse(state ? {...row, status: MemberStatus.safeParse(state).data ?? 'pending'} : row);
  function read(id: string): Chat {
    const row = db().prepare('SELECT t.*,m.engine FROM threads t LEFT JOIN member_threads m ON m.thread=t.id WHERE t.id=?').get(id);
    if (!row) throw new ChatError(404, 'chat_not_found');
    const turns = db().prepare('SELECT t.id,t.text,t.answer,m.state FROM turns t LEFT JOIN member_turns m ON m.thread=t.thread AND m.id=t.id WHERE t.thread=? ORDER BY t.rowid').all(id);
    return {...threadOf(row), turns: turns.map(turnOf)};
  }
  async function catalog() {
    try {return await options.catalog();} catch {return null;}
  }
  function lookup(id: string, current: Catalog | null) {
    if (id === chiefId) return chief;
    if (!current) throw new ChatError(503, 'catalog_unavailable');
    const agent = current.agents.find(item => item.id === id);
    if (!agent) throw new ChatError(409, 'agent_removed');
    return agent;
  }

  const delays = new Map<string, {delay: number; due: number}>();
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function pendingTurns() {
    return z.array(PendingTurn).parse(db().prepare(`
      SELECT m.thread,m.id,m.payload,m.state,b.engine,b.profile,b.spawn,b.opened,s.id AS member,
        (SELECT count(*) FROM turns x WHERE x.thread=t.thread AND x.rowid<=t.rowid) AS position
      FROM member_turns m JOIN turns t ON t.thread=m.thread AND t.id=m.id
      JOIN member_threads b ON b.thread=m.thread LEFT JOIN members s ON s.spawn=b.spawn
      WHERE m.state IN (SELECT value FROM json_each(?)) ORDER BY t.rowid`).all(JSON.stringify(PendingState.options)));
  }
  function save(row: z.infer<typeof PendingTurn>, next: TurnState) {
    if (next.state === row.state) return;
    transaction(() => {
      if (next.state === 'completed') db().prepare('UPDATE turns SET answer=? WHERE thread=? AND id=? AND answer IS NULL').run(next.answer, row.thread, row.id);
      if (!PendingState.safeParse(next.state).success) db().prepare('UPDATE threads SET updated=? WHERE id=?').run(Date.now(), row.thread);
      db().prepare('UPDATE member_turns SET state=? WHERE thread=? AND id=?').run(next.state, row.thread, row.id);
    });
  }
  async function pass(client: MemberClient) {
    for (const row of pendingTurns()) {
      if (stopped) return;
      const key = row.thread + '/' + row.id;
      if ((delays.get(key)?.due ?? 0) > Date.now()) continue;
      let next: TurnState = {state: row.state};
      try {
        const advanced = await client.advance({
          conversationId: row.thread, requestId: row.id, payload: row.payload, position: row.position,
          engine: row.engine, profile: row.profile, spawn: row.spawn, memberId: row.member, opened: row.opened === 1, state: row.state,
        }, {
          member: id => db().prepare('INSERT OR IGNORE INTO members(spawn,id) VALUES(?,?)').run(row.spawn, id),
          opened: () => db().prepare('UPDATE member_threads SET opened=1 WHERE thread=?').run(row.thread),
          forget: () => db().prepare('DELETE FROM members WHERE spawn=?').run(row.spawn),
        });
        save(row, advanced);
        next = advanced;
      } catch {}
      if (!PendingState.safeParse(next.state).success) {delays.delete(key); continue;}
      const delay = next.state === row.state ? Math.min((delays.get(key)?.delay ?? timing.retry / 2) * 2, timing.maxRetry) : timing.retry;
      delays.set(key, {delay, due: Date.now() + delay});
    }
  }
  function wake(delay: number) {
    if (stopped) return;
    timer = setTimeout(reconcile, Math.max(0, delay));
    timer.unref();
  }
  function reconcile() {
    if (!members || stopped) return;
    if (running) {again = true; return;}
    clearTimeout(timer);
    running = pass(members).then(() => {
      const due = pendingTurns().map(row => delays.get(row.thread + '/' + row.id)?.due ?? 0);
      if (due.length) wake(Math.min(...due) - Date.now());
    }).catch(() => wake(timing.maxRetry)).finally(() => {
      running = null;
      if (again) {again = false; reconcile();}
    });
  }
  if (members) setImmediate(reconcile);

  function bind(agent: Agent) {
    if (!agent.engine) return null;
    const profile = options.members?.profiles[agent.engine];
    if (!profile) throw new ChatError(409, 'engine_unavailable');
    return {engine: agent.engine, profile, spawn: memberSpawnId(agent.id, agent.engine, profile)};
  }
  function sendMember(id: string, chat: Chat, input: z.infer<typeof NewMessage>, current: Catalog | null) {
    if (chat.turns.some(item => item.id === input.id)) {reconcile(); return chat;}
    if (input.id !== input.id.toLowerCase()) throw new ChatError(400, 'invalid_message');
    if (!members) throw new ChatError(409, 'members_unconfigured');
    const agent = lookup(chat.agentId, current);
    if (chat.turns.some(ended)) throw new ChatError(409, 'member_chat_closed');
    if (chat.turns.some(item => item.answer === null)) throw new ChatError(409, 'reply_pending');
    if (!input.text.isWellFormed() || input.text.includes('\0')) throw new ChatError(400, 'invalid_message');
    const payload = chat.turns.length ? input.text : preface(agent, current!, input.text);
    transaction(() => {
      db().prepare('INSERT INTO turns(thread,id,text) VALUES(?,?,?)').run(id, input.id, input.text);
      if (!chat.turns.length) db().prepare('UPDATE threads SET title=? WHERE id=?').run(input.text.slice(0, 64), id);
      db().prepare("INSERT INTO member_turns(thread,id,payload,state) VALUES(?,?,?,'queued')").run(id, input.id, payload);
    });
    reconcile();
    return read(id);
  }
  async function send(id: string, input: z.infer<typeof NewMessage>) {
    const current = await catalog();
    const chat = read(id);
    const existing = chat.turns.find(turn => turn.id === input.id);
    if (existing && existing.text !== input.text) throw new ChatError(409, 'message_conflict');
    if (existing?.answer != null) return chat;
    if (chat.engine) return sendMember(id, chat, input, current);
    const agent = lookup(chat.agentId, current);
    if (chat.turns.some(turn => turn.answer === null && turn.id !== input.id)) throw new ChatError(409, 'reply_pending');
    const active = replying.get(id);
    if (active) return active;
    if (!existing) {
      db().prepare('INSERT INTO turns(thread,id,text) VALUES(?,?,?)').run(id, input.id, input.text);
      if (!chat.turns.length && id !== chiefId) db().prepare('UPDATE threads SET title=? WHERE id=?').run(input.text.slice(0, 64), id);
      chat.turns.push({...input, answer: null});
    }
    const reply = (async () => {
      const factory = id === chiefId ? await options.inspect().catch(() => null) : null;
      const inspection = report(agent, current, factory);
      const answer = (options.python || options.attestation) ? await agentReply(options, chat, agent, inspection) : inspection;
      db().prepare('UPDATE turns SET answer=? WHERE thread=? AND id=? AND answer IS NULL').run(answer, id, input.id);
      db().prepare('UPDATE threads SET updated=? WHERE id=?').run(Date.now(), id);
      return read(id);
    })();
    replying.set(id, reply);
    try {return await reply;} finally {replying.delete(id);}
  }
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      abort.abort();
      await running;
    },
    async handle(method: string, path: string, payload: unknown) {
      if (path === '/api/chats') {
        if (method === 'GET') {
          const current = await catalog();
          const rows = db().prepare('SELECT t.*,m.engine FROM threads t LEFT JOIN member_threads m ON m.thread=t.id ORDER BY (t.id=?) DESC,t.updated DESC,t.rowid DESC').all(chiefId);
          return {threads: rows.map(threadOf), agents: (current?.agents ?? []).map(({id, name, engine}) => engine ? {id, name, engine} : {id, name}),
            mode: options.attestation ? 'live' : 'local', catalogAvailable: current !== null};
        }
        if (method !== 'POST') throw new ChatError(405, 'method_not_allowed');
        const parsed = NewChat.safeParse(payload);
        if (!parsed.success || parsed.data.agentId === chiefId) throw new ChatError(400, 'invalid_chat');
        const {id, agentId} = parsed.data;
        const agent = lookup(agentId, await catalog());
        if (!db().prepare('SELECT 1 FROM threads WHERE id=?').get(id)) {
          const binding = bind(agent);
          if (binding && id !== id.toLowerCase()) throw new ChatError(400, 'invalid_chat');
          transaction(() => {
            db().prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?)').run(id, agentId, agent.name, 'New chat', Date.now());
            if (binding) db().prepare('INSERT INTO member_threads(thread,engine,profile,spawn) VALUES(?,?,?,?)').run(id, binding.engine, binding.profile, binding.spawn);
          });
        }
        const result = read(id);
        if (result.agentId !== agentId) throw new ChatError(409, 'chat_conflict');
        return result;
      }
      const match = /^\/api\/chats\/([^/]+)(\/messages)?$/.exec(path);
      if (!match || (match[1] !== chiefId && !z.uuid().safeParse(match[1]).success)) throw new ChatError(404, 'chat_not_found');
      if (!match[2] && method === 'GET') return read(match[1]);
      if (match[2] && method === 'POST') {
        const parsed = NewMessage.safeParse(payload);
        if (!parsed.success) throw new ChatError(400, 'invalid_message');
        return send(match[1], parsed.data);
      }
      throw new ChatError(405, 'method_not_allowed');
    },
  };
}
