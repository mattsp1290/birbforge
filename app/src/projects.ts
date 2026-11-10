import {z} from 'zod/v4';
import {authorizationHeaders, endpointOrigin, type ClientAccess} from './access';
import {Project, ProjectCommand, ProjectConversation, ProjectMutation, RepositoryPage} from './project-contract';
import {ActionError} from './controller';
import {transport} from './transport';

export class ProjectClient {
  constructor(readonly endpoint: string, readonly access: ClientAccess) {}
  private async request(path: string, body?: unknown) {
    let response;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 40_000);
    try {
      response = await transport(endpointOrigin(this.endpoint) + '/api' + path, {method: body === undefined ? 'GET' : 'POST',
        headers: {...authorizationHeaders(this.access), 'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body), signal: abort.signal});
    } catch {throw new ActionError(503, 'acknowledgement_unknown');}
    finally {clearTimeout(timer);}
    const payload: unknown = await response.json();
    if (!response.ok) {
      const error = z.object({code: z.string()}).safeParse(payload);
      throw new ActionError(response.status, error.success ? error.data.code : 'project_unavailable');
    }
    return payload;
  }
  async list() {return z.array(Project).parse(await this.request('/projects'));}
  async get(id: string) {return Project.parse(await this.request(`/projects/${id}`));}
  async mutate(command: z.infer<typeof ProjectCommand>) {return ProjectMutation.parse(await this.request('/projects', command));}
  async repositories(query: string, page: number, refresh = false) {return RepositoryPage.parse(await this.request(`/github/repositories?q=${encodeURIComponent(query)}&page=${page}&refresh=${refresh}`));}
  async chats(id: string) {return z.array(ProjectConversation).parse(await this.request(`/projects/${id}/conversations`));}
  async createChat(projectId: string, id: string) {return this.request(`/projects/${projectId}/conversations`, {id});}
}
