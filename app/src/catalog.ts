import {z} from 'zod/v4';

export const ProjectId = z.string().max(160).regex(/^[a-z0-9][a-z0-9-]*$/);
export const Project = z.object({id: z.string(), name: z.string().optional(), repositories: z.array(z.string())});
export const Engine = z.enum(['codex', 'pi']);
export const engineLabels: Record<Engine, string> = {codex: 'Codex', pi: 'Pi'};
export const Agent = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(100),
  instructions: z.string().trim().max(2000),
  projectIds: z.array(z.string().min(1)).refine(ids => new Set(ids).size === ids.length),
  engine: Engine.optional(),
}).strict();
export const Catalog = z.object({projects: z.array(Project), projectsAvailable: z.boolean(), agents: z.array(Agent), engines: z.array(Engine).optional()});
export type Engine = z.infer<typeof Engine>;
export type Project = z.infer<typeof Project>;
export type Agent = z.infer<typeof Agent>;
export type Catalog = z.infer<typeof Catalog>;

export function githubRepository(value: string): string | null {
  const path = value.trim().replace(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)/i, '')
    .replace(/\/$/, '').replace(/\.git$/i, '');
  if (!/^[a-z\d](?:[a-z\d-]*[a-z\d])?\/[a-z\d_.-]+$/i.test(path) || /\/\.{1,2}$/.test(path)) return null;
  return path.toLowerCase();
}

export const CatalogCommand = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('createProject'), id: ProjectId}).strict(),
  z.object({kind: z.literal('linkRepository'), id: ProjectId, repository: z.string().max(500).refine(value => !!githubRepository(value))}).strict(),
  z.object({kind: z.literal('saveAgent'), agent: Agent, previous: Agent.nullable()}).strict(),
  z.object({kind: z.literal('deleteAgent'), previous: Agent}).strict(),
]);
export type CatalogCommand = z.infer<typeof CatalogCommand>;
