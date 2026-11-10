import {z} from 'zod/v4';
import {ProjectCommand, ProjectId} from './project-contract';

export const PendingProjectAction = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('mutation'), command: ProjectCommand}).strict(),
  z.object({kind: z.literal('chat'), project_id: ProjectId, conversation_id: z.string().uuid()}).strict(),
]);
export function pendingProjectKey(endpoint: string) {return `birbforge.pending-project.v1.${new URL(endpoint).origin}`;}
