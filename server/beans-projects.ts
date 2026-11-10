import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {z} from 'zod/v4';
import {Project, ProjectMutation} from '../app/src/project-contract';

export const BeansConfig = z.object({binary: z.string().startsWith('/'), hub: z.string().startsWith('/'), home: z.string().startsWith('/'), branch: z.string().min(1), actor: z.string().min(1)}).strict();
export class ProjectError extends Error {
  constructor(readonly status: number, readonly code: string) {super(code);}
}
export async function processOutput(binary: string, args: string[], input?: string, cwd?: string, home?: string) {
  const unavailable = input === undefined ? 'beans_observation_unavailable' : 'beans_publication_uncertain_reconcile_same_operation';
  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, {cwd, env: {
      HOME: home, NODE_ENV: 'production', PATH: process.env.PATH, LANG: 'C.UTF-8', GIT_TERMINAL_PROMPT: '0',
    }, stdio: ['pipe', 'pipe', 'pipe']});
    const chunks: Buffer[] = [];
    let size = 0;
    let diagnostic = '';
    let exceeded = false;
    const timer = setTimeout(() => {exceeded = true; child.kill('SIGKILL');}, 600_000);
    child.stdout.on('data', (bytes: Buffer) => {size += bytes.length; if (size > 2_000_000) {exceeded = true; child.kill('SIGKILL');} else chunks.push(bytes);});
    child.stderr.on('data', (bytes: Buffer) => {if (diagnostic.length < 4000) diagnostic += bytes.toString();});
    child.on('error', () => {clearTimeout(timer); reject(new ProjectError(503, unavailable));});
    child.stdin.on('error', () => {});
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && !exceeded) resolve(Buffer.concat(chunks).toString('utf8'));
      else {
        const known = [
          ['project revision conflict', 'project_revision_conflict'],
          ['project operation identity reused', 'project_operation_conflict'],
          ['managed project not found', 'project_not_found'],
          ['project is archived', 'project_archived'],
          ['cannot remove the last project repository', 'last_repository'],
          ['project identity already exists', 'project_identity_exists'],
          ['project repository limit reached', 'project_repository_limit'],
        ].find(([message]) => diagnostic.includes(message));
        reject(new ProjectError(known ? 409 : 503, known?.[1] ?? unavailable));
      }
    });
    child.stdin.end(input);
  });
}
export class BeansProjects {
  constructor(readonly config: z.infer<typeof BeansConfig>) {}
  private async call(args: string[], input?: string) {
    return JSON.parse(await processOutput(this.config.binary, ['--hub', this.config.hub, '--branch', this.config.branch, '--actor', this.config.actor, '--json', ...args], input, this.config.hub, this.config.home)) as unknown;
  }
  async list() {return z.object({schema_version: z.literal(1), projects: z.array(Project)}).parse(await this.call(['project', 'catalog'])).projects;}
  async get(id: string) {return z.object({schema_version: z.literal(1), project: Project}).parse(await this.call(['project', 'inspect', id])).project;}
  async apply(request: unknown) {return ProjectMutation.parse(await this.call(['project', 'apply', '--request-file', '-'], JSON.stringify(request)));}
  async assertPublished() {
    const status = await processOutput('git', ['-C', this.config.hub, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], undefined, this.config.hub, this.config.home);
    if (!/^0\s+0\s*$/.test(status)) throw new ProjectError(503, 'beans_publication_not_confirmed');
  }
  async notes(projectId: string) {
    const git = (...args: string[]) => processOutput('git', ['-C', this.config.hub, ...args], undefined, this.config.hub, this.config.home);
    const before = (await git('rev-parse', 'HEAD')).trim();
    if ((await git('status', '--porcelain')).trim()) throw new ProjectError(503, 'beans_context_not_clean');
    const records = z.array(z.object({project: z.string(), key: z.string(), path: z.string(), updated: z.record(z.string(), z.number().int()), body: z.string()})).parse(await this.call(['--project', projectId, 'memories', '--limit', '8']));
    const notes = [];
    for (const note of records.filter(record => record.project === projectId)) {
      if (note.project !== projectId || !note.path.startsWith(`projects/${projectId}/`) || note.path.split('/').some(part => ['.', '..', ''].includes(part))) throw new ProjectError(503, 'beans_context_scope_mismatch');
      const bytes = await git('show', `${before}:${note.path}`);
      notes.push({key: note.key, path: note.path, updated: note.updated, body: note.body,
        file_sha256: createHash('sha256').update(bytes).digest('hex'), content_sha256: createHash('sha256').update(note.body).digest('hex')});
    }
    if (before !== (await git('rev-parse', 'HEAD')).trim() || (await git('status', '--porcelain')).trim()) throw new ProjectError(503, 'beans_context_changed_retry');
    return {project: projectId, actor: this.config.actor, commit: before, notes};
  }
}
