import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isDeepStrictEqual, promisify} from 'node:util';
import {z} from 'zod/v4';
import {Agent, CatalogCommand, githubRepository, type Catalog, type Engine, type Project} from '../app/src/catalog';
import {BeansProjects, type BeansConfig} from './beans-projects';

const run = promisify(execFile);
const BasicProjects = z.array(z.object({
  name: z.string(), config: z.object({remotes: z.array(z.string()).nullish()}),
}));

export class CatalogError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export class CatalogService {
  private pending: Promise<void> = Promise.resolve();
  private readonly managedProjects: BeansProjects | null;
  constructor(private options: {directory: string; hub?: string; managedBeans?: z.infer<typeof BeansConfig>; engines?: Engine[]}) {
    this.managedProjects = options.managedBeans ? new BeansProjects(options.managedBeans) : null;
  }

  private async bn(args: string[], cwd: string) {
    if (!this.options.hub) throw new CatalogError(503, 'beans_hub_required');
    const env = {
      PATH: process.env.PATH,
      NODE_ENV: process.env.NODE_ENV,
      HOME: this.options.directory,
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'Forge', GIT_AUTHOR_EMAIL: 'birbforge@localhost',
      GIT_COMMITTER_NAME: 'Forge', GIT_COMMITTER_EMAIL: 'birbforge@localhost',
    };
    try {
      const result = await run('bn', ['--hub', this.options.hub, '--actor', 'birbforge', '--no-fetch', '--no-sync', '--json', 'project', ...args],
        {cwd, env, timeout: 15_000, maxBuffer: 8 * 1024 * 1024});
      return JSON.parse(result.stdout) as unknown;
    } catch { throw new CatalogError(503, 'beans_unavailable'); }
  }

  private async projects(): Promise<Project[] | null> {
    if (this.managedProjects) {
      const projects = await this.managedProjects.list();
      return projects.filter(project => !project.archived).map(({id, name, repositories}) => ({
        id, name, repositories: repositories.map(repo => repo.full_name),
      }));
    }
    const hub = this.options.hub;
    if (!hub) return null;
    const rows = BasicProjects.safeParse(await this.bn(['list'], hub));
    if (!rows.success) throw new CatalogError(503, 'beans_unavailable');
    return rows.data.map(({name, config}) => ({
      id: name,
      repositories: [...new Set((config.remotes ?? []).flatMap(remote => githubRepository(remote) ?? []))],
    }));
  }

  private async agents(): Promise<Agent[]> {
    try {
      const data = await readFile(join(this.options.directory, 'crew.json'), 'utf8');
      return z.array(Agent).parse(JSON.parse(data));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw new CatalogError(503, 'crew_unavailable');
    }
  }

  async snapshot(): Promise<Catalog> {
    const [projects, agents] = await Promise.all([
      this.projects().catch(() => null),
      this.agents(),
    ]);
    const {engines} = this.options;
    return {projects: projects ?? [], agents, projectsAvailable: projects !== null, ...(engines ? {engines} : {})};
  }

  apply(input: unknown): Promise<Catalog> {
    const operation = this.pending.then(async () => {
      const parsed = CatalogCommand.safeParse(input);
      if (!parsed.success) throw new CatalogError(400, 'invalid_catalog_command');
      const command = parsed.data;
      if (this.managedProjects && (command.kind === 'createProject' || command.kind === 'linkRepository')) {
        throw new CatalogError(409, 'use_managed_project_command');
      }
      const catalog = await this.snapshot();
      if (command.kind === 'createProject' || command.kind === 'linkRepository') {
        if (!catalog.projectsAvailable) throw new CatalogError(503, this.options.hub ? 'beans_unavailable' : 'beans_hub_required');
        const project = catalog.projects.find(row => row.id === command.id);
        if (command.kind === 'createProject' && project) return catalog;
        if (command.kind === 'linkRepository' && !project) throw new CatalogError(409, 'unknown_project');
        const cwd = await mkdtemp(join(tmpdir(), 'birbforge-repository-'));
        try {
          // bn infers the remote from the working repository, even during creation.
          await run('git', ['init', '-q', cwd]);
          if (command.kind === 'createProject') {
            await this.bn(['create', command.id], cwd);
          } else {
            const repository = githubRepository(command.repository);
            if (!repository) throw new CatalogError(400, 'invalid_catalog_command');
            if (project?.repositories.includes(repository)) return catalog;
            await run('git', ['-C', cwd, 'remote', 'add', 'origin', 'https://github.com/' + repository]);
            await this.bn(['link', command.id], cwd);
          }
        } finally { await rm(cwd, {recursive: true, force: true}); }
        return this.snapshot();
      }
      const id = command.kind === 'deleteAgent' ? command.previous.id : command.agent.id;
      const current = catalog.agents.find(agent => agent.id === id) ?? null;
      if (command.kind === 'deleteAgent' && !current) return catalog;
      if (command.kind === 'saveAgent' && isDeepStrictEqual(current, command.agent)) return catalog;
      if (!isDeepStrictEqual(command.previous, current)) throw new CatalogError(409, 'agent_changed');
      if (command.kind === 'saveAgent' && command.agent.projectIds.some(projectId =>
        !catalog.projects.some(project => project.id === projectId) && !current?.projectIds.includes(projectId))) {
        throw new CatalogError(409, 'unknown_project');
      }
      if (command.kind === 'saveAgent' && command.agent.engine && command.agent.engine !== current?.engine &&
        !this.options.engines?.includes(command.agent.engine)) throw new CatalogError(409, 'engine_unavailable');
      const agents = catalog.agents.filter(agent => agent.id !== id);
      if (command.kind === 'saveAgent') agents.push(command.agent);
      agents.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      await mkdir(this.options.directory, {recursive: true, mode: 0o700});
      const temporary = join(this.options.directory, 'crew-' + randomUUID() + '.tmp');
      try {
        await writeFile(temporary, JSON.stringify(agents), {mode: 0o600, flag: 'wx'});
        await rename(temporary, join(this.options.directory, 'crew.json'));
      } finally { await rm(temporary, {force: true}); }
      return {...catalog, agents};
    });
    this.pending = operation.then(() => {}, () => {});
    return operation;
  }
}
