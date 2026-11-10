import {readFile} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {z} from 'zod/v4';
import {Project, ProjectCommand, ProjectConversation, ProjectId} from '../app/src/project-contract';
import {Snapshot, Prompt} from '../app/src/contract';
import {BeansConfig, BeansProjects, ProjectError} from './beans-projects';
import {GitHubConfig, GitHubConnection, GitHubUnavailable} from './github';
import {ProjectIntents} from './project-intents';

export const ProjectsConfig = z.object({owner_principal: z.string().min(1), github: GitHubConfig, beans: BeansConfig,
  service_token_file: z.string().startsWith('/'), intent_directory: z.string().startsWith('/')}).strict();
const ResolvedChange = z.object({schema_version: z.literal(1), project_id: ProjectId, operation_id: z.string().uuid(), expected_revision: z.string().nullable(), change: z.unknown()}).strict();
export class Projects {
  readonly beans: BeansProjects;
  private readonly intents: ProjectIntents;
  private connection: Promise<GitHubConnection> | null = null;
  constructor(readonly config: z.infer<typeof ProjectsConfig>) {
    this.beans = new BeansProjects(config.beans);
    this.intents = new ProjectIntents(config.intent_directory);
  }
  private async github() {
    if (!this.connection) this.connection = GitHubConnection.configured(this.config.github).catch(error => {this.connection = null; throw error;});
    return this.connection;
  }
  private async repository(id: string) {
    const parsed = Number(id);
    if (!Number.isSafeInteger(parsed)) throw new ProjectError(400, 'invalid_repository_id');
    const repo = await (await this.github()).repository(parsed);
    return {id: String(repo.id), full_name: repo.full_name, html_url: repo.html_url};
  }
  async mutate(principal: string, raw: unknown) {
    const command = ProjectCommand.parse(raw);
    const frozen = ResolvedChange.parse(await this.intents.resolve('mutation', command.operation_id, principal, command, async () => {
      const change = command.change;
      if (change.type === 'create') {
        const ids = [...new Set(change.repository_ids)];
        const repositories = await Promise.all(ids.map(id => this.repository(id)));
        return {...command, schema_version: 1, change: {type: 'create', name: change.name ?? repositories[0].full_name.split('/')[1], repositories}};
      }
      if (change.type === 'add_repository') {
        const current = await this.beans.get(command.project_id);
        if (current.repositories.length >= 20 && !current.repositories.some(repository => repository.id === change.repository_id)) throw new ProjectError(409, 'project_repository_limit');
        return {...command, schema_version: 1, change: {type: 'add_repository', repository: await this.repository(change.repository_id)}};
      }
      return {...command, schema_version: 1};
    }));
    return this.beans.apply(frozen);
  }
  private async context(project: z.infer<typeof Project>) {
    await this.beans.assertPublished();
    const contexts = await Promise.all(project.repositories.map(repo => this.github().then(github => github.context(Number(repo.id)))));
    const notes = await this.beans.notes(project.id);
    await this.beans.assertPublished();
    const latest = await this.beans.get(project.id);
    if (latest.archived || latest.revision !== project.revision) throw new ProjectError(409, 'project_context_changed_retry');
    const unavailableNotes: {key: string; reason: string}[] = [];
    const context = {schema_version: 'birbcrew.project-context.v1', project_id: project.id, project_name: project.name, project_revision: project.revision,
      repositories: contexts.map(({repository, commit}) => ({repository_id: String(repository.id), full_name: repository.full_name, url: repository.html_url, commit})),
      sources: contexts.flatMap(({repository, files}) => files.map(file => ({repository_id: String(repository.id), commit: file.commit, path: file.path, sha256: file.content_sha256, text: file.content}))), notes,
      unavailable_sources: contexts.flatMap(({repository, unavailable_files}) => unavailable_files.map(file => ({repository_id: String(repository.id), ...file}))),
      unavailable_notes: unavailableNotes,
    };
    while (Buffer.byteLength(JSON.stringify(context), 'utf8') > 131_072) {
      const source = context.sources.pop();
      if (source) {context.unavailable_sources.push({repository_id: source.repository_id, path: source.path, reason: 'context_budget'}); continue;}
      const note = context.notes.notes.pop();
      if (note) {context.unavailable_notes.push({key: note.key, reason: 'context_budget'}); continue;}
      throw new ProjectError(413, 'project_context_metadata_too_large');
    }
    return context;
  }
  async producer(producerUrl: string, credential: string, path: string, body?: unknown, internal = false) {
    const token = internal ? (await readFile(this.config.service_token_file, 'utf8')).trim() : null;
    const response = await fetch(producerUrl + path, {method: body === undefined ? 'GET' : 'POST',
      redirect: 'manual', signal: AbortSignal.timeout(30_000),
      headers: {Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', ...(token ? {'X-Birbforge-Project-Token': token} : {})},
      body: body === undefined ? undefined : JSON.stringify(body)});
    const result: unknown = await response.json();
    if (!response.ok) {
      const error = z.object({detail: z.string().optional(), code: z.string().optional()}).safeParse(result);
      throw new ProjectError(response.status, error.success ? error.data.code ?? error.data.detail ?? 'project_conversation_rejected' : 'project_conversation_rejected');
    }
    return result;
  }
  async createChat(principal: string, projectId: string, id: string, url: string, credential: string) {
    const frozen = await this.intents.resolve('conversation', id, principal, {project_id: projectId, id}, async () => {
      const project = await this.beans.get(projectId);
      if (project.archived) throw new ProjectError(409, 'project_archived');
      return {id, context: await this.context(project)};
    });
    try {
      const existing = Snapshot.parse(await this.producer(url, credential, `/conversations/${id}`));
      if (existing.project_context?.project_id !== projectId) throw new ProjectError(409, 'conversation_project_conflict');
      return Snapshot.parse({...z.record(z.string(), z.unknown()).parse(await this.producer(url, credential, '/internal/project-conversations', frozen, true)), mode: 'project'});
    } catch (error) {if (!(error instanceof ProjectError && error.status === 404)) throw error;}
    const current = await this.beans.get(projectId);
    if (current.archived) throw new ProjectError(409, 'project_archived');
    const context = z.object({context: z.object({project_revision: z.string(), repositories: z.array(z.object({repository_id: z.string()}))})}).parse(frozen).context;
    if (context.project_revision !== current.revision) throw new ProjectError(409, 'project_context_changed_new_chat_required');
    await Promise.all(context.repositories.map(repository => this.repository(repository.repository_id)));
    return Snapshot.parse({...z.record(z.string(), z.unknown()).parse(await this.producer(url, credential, '/internal/project-conversations', frozen, true)), mode: 'project'});
  }
  async submit(id: string, url: string, credential: string, raw: unknown) {
    const prompt = Prompt.parse(raw);
    const snapshot = Snapshot.parse(await this.producer(url, credential, `/conversations/${id}`));
    if (!snapshot.project_context || snapshot.kind !== 'project' || !snapshot.context_sha256) throw new ProjectError(409, 'not_project_conversation');
    const reconciliation = z.discriminatedUnion('accepted', [
      z.object({accepted: z.literal(false)}).strict(),
      z.object({accepted: z.literal(true), input: z.object({request_id: z.string(), text: z.string()})}),
    ]).parse(await this.producer(url, credential, `/internal/project-conversations/${id}/reconcile`, {...prompt, context_sha256: snapshot.context_sha256}, true));
    const accepted = reconciliation.accepted ? reconciliation.input : null;
    if (accepted) {
      if (accepted.text !== prompt.text) throw new ProjectError(409, 'request_identity_conflict');
      return snapshot;
    }
    const project = await this.beans.get(snapshot.project_context.project_id);
    if (project.archived) throw new ProjectError(409, 'project_archived');
    const sources = snapshot.project_context.sources;
    await Promise.all(snapshot.project_context.repositories.map(async repo => (await this.github()).assertReadable(Number(repo.repository_id), repo.commit, sources.find(source => source.repository_id === repo.repository_id)?.path)));
    await this.producer(url, credential, `/internal/project-conversations/${id}/inputs`, {...prompt, context_sha256: snapshot.context_sha256}, true);
    return {accepted: true};
  }
  async serve(input: {url: URL; request: IncomingMessage; response: ServerResponse; principal: string; producerUrl: string; credential: string; readBody: () => Promise<unknown>}) {
    const {url, request, response} = input;
    const send = (status: number, result: unknown) => {response.writeHead(status, {'Content-Type': 'application/json'}); response.end(JSON.stringify(result));};
    if (input.principal !== this.config.owner_principal) return send(404, {code: 'not_found'});
    try {
      if (url.pathname === '/api/github/repositories' && request.method === 'GET') {
        const query = z.object({q: z.string().max(200).default(''), page: z.coerce.number().int().min(1).max(10000).default(1), refresh: z.enum(['true', 'false']).default('false')}).strict().parse(Object.fromEntries(url.searchParams));
        return send(200, await (await this.github()).repositories(query.q, query.page, query.refresh === 'true'));
      }
      if (url.search) return send(400, {code: 'invalid_query'});
      if (url.pathname === '/api/projects') {
        if (request.method === 'GET') return send(200, await this.beans.list());
        if (request.method === 'POST') return send(200, await this.mutate(input.principal, await input.readBody()));
        return send(405, {code: 'method_not_allowed'});
      }
      const match = /^\/api\/projects\/([^/]+)(?:\/(conversations))?$/.exec(url.pathname);
      if (!match) return send(404, {code: 'not_found'});
      const projectId = ProjectId.parse(match[1]);
      if (!match[2] && request.method === 'GET') return send(200, await this.beans.get(projectId));
      if (match[2] && request.method === 'GET') return send(200, z.array(ProjectConversation).parse(await this.producer(input.producerUrl, input.credential, `/conversations?project_id=${encodeURIComponent(projectId)}`)));
      if (match[2] && request.method === 'POST') {
        const {id} = z.object({id: z.string().uuid()}).strict().parse(await input.readBody());
        return send(200, await this.createChat(input.principal, projectId, id, input.producerUrl, input.credential));
      }
      return send(405, {code: 'method_not_allowed'});
    } catch (error) {
      if (error instanceof z.ZodError) return send(400, {code: 'invalid_project_command'});
      if (error instanceof ProjectError) return send(error.status, {code: error.code});
      if (error instanceof GitHubUnavailable) return send(error.status, {code: error.code});
      return send(503, {code: 'project_acknowledgement_unknown_retry_same_operation'});
    }
  }
}
