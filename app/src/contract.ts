import { MessageSchema } from '@ag-ui/core/schemas';
import { z } from 'zod/v4';

export const dependencyRevision = '88b219c18adeb352d2f291f099ede990a3190a58';
export const Choice = z.enum(['inspect', 'test']);
export const Decision = z.object({
  request_id: z.string().min(1).max(200),
  version: z.number().int(),
  choice: Choice,
}).strict();
export const Prompt = z.object({
  request_id: z.string().uuid(), text: z.string().refine(value => [...value].length >= 1 && [...value].length <= 4000),
}).strict();
export const HumanRequest = z.object({
  id: z.string(), version: z.number().int(), expected_responder: z.string(),
  tool_call_id: z.string(), resolution: Choice.nullable(),
});
export const ProjectContext = z.object({
  schema_version: z.literal('birbcrew.project-context.v1'), project_id: z.string(), project_revision: z.string(), project_name: z.string(),
  repositories: z.array(z.object({repository_id: z.string(), full_name: z.string(), url: z.string(), commit: z.string()})),
  unavailable_sources: z.array(z.object({repository_id: z.string(), path: z.string(), reason: z.string()})).default([]),
  unavailable_notes: z.array(z.object({key: z.string(), reason: z.string()})).default([]),
  sources: z.array(z.object({repository_id: z.string(), commit: z.string(), path: z.string(), sha256: z.string(), text: z.string()})),
});
export const Snapshot = z.object({
  mode: z.enum(['proof', 'approved-goal', 'project']).default('proof'),
  kind: z.enum(['proof', 'project']).optional(), project_context: ProjectContext.nullable().optional(), context_sha256: z.string().nullable().optional(),
  id: z.string().uuid(), revision: z.number().int().nonnegative(),
  phase: z.enum(['idle', 'running', 'waiting', 'cancelled', 'failed']),
  cursor: z.number().int().nonnegative(),
  inputs: z.array(z.object({request_id: z.string(), text: z.string(), outcome: z.string()})),
  human: HumanRequest.nullable(), decisions: z.array(HumanRequest),
  messages: z.array(MessageSchema),
  context: z.object({project: z.string(), commit: z.string(), notes: z.array(z.object({
    key: z.string(), content_sha256: z.string(),
  }))}),
  failure: z.string().nullable(),
});
export type Conversation = z.infer<typeof Snapshot>;
export type Decision = z.infer<typeof Decision>;
export type Prompt = z.infer<typeof Prompt>;
export type Choice = z.infer<typeof Choice>;
