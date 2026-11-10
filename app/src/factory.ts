import {z} from 'zod/v4';

export const QueueStatus = z.object({
  conversationId: z.string().uuid().nullable(), environment: z.string(),
  uncertain: z.number().int().nonnegative().optional(),
  queued: z.number().int().nonnegative(), running: z.number().int().nonnegative(), finished: z.number().int().nonnegative(),
});

export const FactoryStatus = z.object({
  checkedAt: z.iso.datetime(),
  gateway: z.literal('online'),
  runtime: z.enum(['ready', 'unavailable']),
  verification: z.enum(['installed', 'unconfigured', 'unavailable']),
  queue: QueueStatus.nullable(),
});
export type FactoryStatus = z.infer<typeof FactoryStatus>;
