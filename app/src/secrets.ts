import {z} from 'zod/v4';

export const SecretName = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,99}$/);
const SecretValue = z.string().min(1).max(8192);
export const SecretCommand = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('set'), name: SecretName, value: SecretValue}).strict(),
  z.object({kind: z.literal('remove'), name: SecretName}).strict(),
]);
export type SecretCommand = z.infer<typeof SecretCommand>;
export const SecretNames = z.object({names: z.array(SecretName)}).strict();
