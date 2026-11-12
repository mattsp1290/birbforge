import {z} from 'zod/v4';
import {Engine} from './catalog';

export const chiefId = 'chief-of-staff';
export const chiefName = 'Chief of Staff';
export const NewChat = z.object({id: z.uuid(), agentId: z.string().min(1)}).strict();
export const NewMessage = z.object({id: z.uuid(), text: z.string().trim().min(1).max(4000)}).strict();
export const Thread = z.object({
  id: z.string(), agentId: z.string(), agentName: z.string(), title: z.string(), engine: Engine.optional(),
});
export const MemberStatus = z.enum(['pending', 'waiting', 'completed', 'failed', 'cancelled', 'uncertain', 'rejected', 'limit']);
export const Turn = z.object({id: z.uuid(), text: z.string(), answer: z.string().nullable(), status: MemberStatus.optional()});
export const Chat = Thread.extend({turns: z.array(Turn)});
export const ChatIndex = z.object({
  threads: z.array(Thread), agents: z.array(z.object({id: z.string(), name: z.string(), engine: Engine.optional()})),
  mode: z.enum(['local', 'live']), catalogAvailable: z.boolean(),
});
export type Chat = z.infer<typeof Chat>;
export type ChatIndex = z.infer<typeof ChatIndex>;
export type Turn = z.infer<typeof Turn>;
export type MemberStatus = z.infer<typeof MemberStatus>;

export const awaitingReply = (turn: Turn) => turn.answer === null && (!turn.status || turn.status === 'pending' || turn.status === 'waiting');
export const ended = (turn: Turn) => turn.answer === null && Boolean(turn.status) && !awaitingReply(turn);
