import {z} from 'zod/v4';

export const chiefId = 'chief-of-staff';
export const chiefName = 'Chief of Staff';
export const NewChat = z.object({id: z.uuid(), agentId: z.string().min(1)}).strict();
export const NewMessage = z.object({id: z.uuid(), text: z.string().trim().min(1).max(4000)}).strict();
export const Thread = z.object({
  id: z.string(), agentId: z.string(), agentName: z.string(), title: z.string(),
});
export const Turn = z.object({id: z.uuid(), text: z.string(), answer: z.string().nullable()});
export const Chat = Thread.extend({turns: z.array(Turn)});
export const ChatIndex = z.object({
  threads: z.array(Thread), agents: z.array(z.object({id: z.string(), name: z.string()})),
  mode: z.enum(['local', 'live']), catalogAvailable: z.boolean(),
});
export type Chat = z.infer<typeof Chat>;
export type ChatIndex = z.infer<typeof ChatIndex>;
