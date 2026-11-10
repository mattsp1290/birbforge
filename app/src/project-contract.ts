import {z} from 'zod/v4';

export const ProjectId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/);
export const Repository = z.object({id: z.string().regex(/^[1-9][0-9]*$/), full_name: z.string(), html_url: z.string().url()}).strict();
export const Project = z.object({id: ProjectId, name: z.string(), revision: z.string(), archived: z.boolean(), repositories: z.array(Repository).min(1)}).strict();
export type Project = z.infer<typeof Project>;
const ProjectName = z.string().trim().min(1).refine(value => new TextEncoder().encode(value).length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value), 'Project name needs 1 to 200 UTF-8 bytes without controls');
export const ProjectCommand = z.object({
  project_id: ProjectId, operation_id: z.string().uuid(), expected_revision: z.string().nullable(),
  change: z.discriminatedUnion('type', [
    z.object({type: z.literal('create'), name: ProjectName.nullable(), repository_ids: z.array(z.string().regex(/^[1-9][0-9]*$/)).min(1).max(20)}).strict(),
    z.object({type: z.literal('rename'), name: ProjectName}).strict(),
    z.object({type: z.literal('add_repository'), repository_id: z.string().regex(/^[1-9][0-9]*$/)}).strict(),
    z.object({type: z.literal('remove_repository'), repository_id: z.string().regex(/^[1-9][0-9]*$/)}).strict(),
    z.object({type: z.literal('archive')}).strict(),
  ]),
}).strict();
export type ProjectCommand = z.infer<typeof ProjectCommand>;
export const ProjectMutation = z.object({
  schema_version: z.literal(1), operation_id: z.string(), replayed: z.boolean(), project: Project,
  commit: z.string(), sha: z.string(), pushed: z.boolean(), message: z.string(),
});
export const ProjectConversation = z.object({id: z.string().uuid(), revision: z.number().int(), project_id: ProjectId, project_revision: z.string()});
export const RepositoryPage = z.object({repositories: z.array(z.object({id: z.number().int().positive(), name: z.string(), full_name: z.string(), html_url: z.string().url(), default_branch: z.string()})), page: z.number(), has_more: z.boolean()});
