import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Octokit} from 'octokit';
import {z} from 'zod/v4';

export const GitHubRepository = z.object({
  id: z.number().int().positive(), name: z.string().min(1), full_name: z.string().min(3),
  html_url: z.string().url().startsWith('https://github.com/'), default_branch: z.string().min(1),
}).strict();
export type GitHubRepository = z.infer<typeof GitHubRepository>;
export const GitHubConfig = z.object({
  token_file: z.string().startsWith('/'), owner_login: z.string().min(1),
}).strict();
export class GitHubUnavailable extends Error {
  constructor(readonly code: 'github_unavailable' | 'repository_unavailable' | 'github_identity_mismatch' | 'repository_access_lost', readonly status = 503) { super(code); }
}
const RepositoryResponse = GitHubRepository.extend({archived: z.boolean(), disabled: z.boolean()}).strip();
const Commit = z.object({sha: z.string().regex(/^[a-f0-9]{40}$/)});
const Content = z.object({type: z.literal('file'), encoding: z.literal('base64'), content: z.string(), size: z.number().int().nonnegative()});
export type SourceFile = {path: string; commit: string; content_sha256: string; content: string};

export class GitHubConnection {
  private catalog: GitHubRepository[] | null = null;
  private refreshing: Promise<void> | null = null;
  constructor(private readonly client: Octokit, private readonly login: string) {}
  static async configured(config: z.infer<typeof GitHubConfig>) {
    const token = (await readFile(config.token_file, 'utf8')).trim();
    if (!token) throw new GitHubUnavailable('github_unavailable');
    return new GitHubConnection(new Octokit({auth: token, request: {timeout: 15_000}}), config.owner_login);
  }
  private async identity() {
    const {data} = await this.client.request('GET /user');
    if (data.login.toLowerCase() !== this.login.toLowerCase()) throw new GitHubUnavailable('github_identity_mismatch');
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        await this.identity();
        const complete = new Map<number, GitHubRepository>();
        for await (const page of this.client.paginate.iterator('GET /user/repos', {per_page: 100, sort: 'full_name', affiliation: 'owner,collaborator,organization_member'})) {
          for (const raw of page.data) {
            const parsed = RepositoryResponse.parse(raw);
            if (!parsed.disabled) complete.set(parsed.id, GitHubRepository.strip().parse(parsed));
          }
        }
        this.catalog = [...complete.values()];
      } catch (error) {
        if (error instanceof GitHubUnavailable) throw error;
        throw new GitHubUnavailable('github_unavailable');
      }
    })().finally(() => {this.refreshing = null;});
    return this.refreshing;
  }
  async repositories(query: string, page: number, refresh: boolean) {
    if (refresh || !this.catalog) await this.refresh();
    const matching = (this.catalog ?? []).filter(repo => repo.full_name.toLowerCase().includes(query.toLowerCase()));
    const start = (page - 1) * 30;
    return {repositories: matching.slice(start, start + 30), page, has_more: start + 30 < matching.length};
  }
  async repository(id: number): Promise<GitHubRepository> {
    try {
      await this.identity();
      const {data} = await this.client.request('GET /repositories/{repository_id}', {repository_id: id});
      const parsed = RepositoryResponse.parse(data);
      if (parsed.disabled || parsed.id !== id) throw new GitHubUnavailable('repository_unavailable');
      return GitHubRepository.strip().parse(parsed);
    } catch (error) {
      if (error instanceof GitHubUnavailable) throw error;
      if (error instanceof Error && 'status' in error && (error.status === 403 || error.status === 404)) throw new GitHubUnavailable('repository_access_lost', 403);
      throw new GitHubUnavailable('repository_unavailable');
    }
  }
  async assertReadable(id: number, commit: string, path?: string) {
    const repository = await this.repository(id);
    if (!path) return;
    const [owner, repo] = repository.full_name.split('/');
    try {await this.client.request('GET /repos/{owner}/{repo}/contents/{path}', {owner, repo, path, ref: commit});}
    catch (error) {
      if (error instanceof Error && 'status' in error && (error.status === 403 || error.status === 404)) throw new GitHubUnavailable('repository_access_lost', 403);
      throw new GitHubUnavailable('repository_unavailable');
    }
  }
  async context(id: number) {
    const repository = await this.repository(id);
    const [owner, repo] = repository.full_name.split('/');
    let commit: string;
    try {
      const result = await this.client.request('GET /repos/{owner}/{repo}/commits/{ref}', {owner, repo, ref: repository.default_branch});
      commit = Commit.parse(result.data).sha;
    } catch (error) {
      if (error instanceof Error && 'status' in error && (error.status === 403 || error.status === 404)) throw new GitHubUnavailable('repository_access_lost', 403);
      throw new GitHubUnavailable('repository_unavailable');
    }
    const files: SourceFile[] = [];
    const unavailable_files: {path: string; reason: string}[] = [];
    for (const path of ['README.md', 'AGENTS.md', 'docs/architecture.md', 'docs/design-decisions.md']) {
      try {
        const result = await this.client.request('GET /repos/{owner}/{repo}/contents/{path}', {owner, repo, path, ref: commit});
        const parsed = Content.safeParse(result.data);
        if (!parsed.success) {unavailable_files.push({path, reason: 'unsupported_type'}); continue;}
        const file = parsed.data;
        if (file.size > 24_000) {unavailable_files.push({path, reason: 'too_large'}); continue;}
        const bytes = Buffer.from(file.content, 'base64');
        if (bytes.length !== file.size || bytes.includes(0)) {unavailable_files.push({path, reason: 'invalid_content'}); continue;}
        let content: string;
        try {content = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);}
        catch {unavailable_files.push({path, reason: 'invalid_utf8'}); continue;}
        files.push({path, commit, content_sha256: createHash('sha256').update(bytes).digest('hex'), content});
      } catch (error) {
        if (error instanceof Error && 'status' in error && error.status === 404) {unavailable_files.push({path, reason: 'missing'}); continue;}
        if (error instanceof Error && 'status' in error && error.status === 403) throw new GitHubUnavailable('repository_access_lost', 403);
        throw new GitHubUnavailable('repository_unavailable');
      }
    }
    return {repository, commit, files, unavailable_files};
  }
}
