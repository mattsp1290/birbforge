import {execFile} from 'node:child_process';
import {chmodSync, mkdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod/v4';
import {Chat, chiefId, chiefName, NewChat, NewMessage, Thread, Turn} from '../app/src/chat';
import type {Agent, Catalog} from '../app/src/catalog';
import type {FactoryStatus} from './factory';

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

export function createChatService(options: ChatOptions) {
  let database: DatabaseSync | undefined;
  const replying = new Map<string, Promise<Chat>>();
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
      `);
      opened.prepare('INSERT OR IGNORE INTO threads VALUES (?, ?, ?, ?, 0)').run(chiefId, chiefId, chiefName, chiefName);
      database = opened;
    }
    return database;
  }
  function read(id: string): Chat {
    const row = db().prepare('SELECT * FROM threads WHERE id=?').get(id);
    if (!row) throw new ChatError(404, 'chat_not_found');
    const turns = db().prepare('SELECT id,text,answer FROM turns WHERE thread=? ORDER BY rowid').all(id);
    return {...Thread.parse(row), turns: z.array(Turn).parse(turns)};
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
  async function send(id: string, input: z.infer<typeof NewMessage>) {
    const current = await catalog();
    const chat = read(id);
    const existing = chat.turns.find(turn => turn.id === input.id);
    if (existing && existing.text !== input.text) throw new ChatError(409, 'message_conflict');
    if (existing?.answer != null) return chat;
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
    async handle(method: string, path: string, payload: unknown) {
      if (path === '/api/chats') {
        if (method === 'GET') {
          const current = await catalog();
          const rows = db().prepare('SELECT * FROM threads ORDER BY (id=?) DESC,updated DESC,rowid DESC').all(chiefId);
          return {threads: z.array(Thread).parse(rows), agents: (current?.agents ?? []).map(({id,name}) => ({id,name})), mode: options.attestation ? 'live' : 'local', catalogAvailable: current !== null};
        }
        if (method !== 'POST') throw new ChatError(405, 'method_not_allowed');
        const parsed = NewChat.safeParse(payload);
        if (!parsed.success || parsed.data.agentId === chiefId) throw new ChatError(400, 'invalid_chat');
        const {id, agentId} = parsed.data;
        const agent = lookup(agentId, await catalog());
        db().prepare('INSERT OR IGNORE INTO threads VALUES (?, ?, ?, ?, ?)').run(id, agentId, agent.name, 'New chat', Date.now());
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
