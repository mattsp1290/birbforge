import type {HttpAgentFetchFn} from '@ag-ui/client';
import {z} from 'zod/v4';

export const AccessCapability = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('bearer')}).strict(),
  z.object({kind: z.literal('private-single-owner')}).strict(),
]);
export type AccessCapability = z.infer<typeof AccessCapability>;
export const ClientAccess = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('bearer'), token: z.string().min(1)}).strict(),
  z.object({kind: z.literal('private-single-owner')}).strict(),
]);
export type ClientAccess = z.infer<typeof ClientAccess>;

export function authorizationHeaders(access: ClientAccess): Record<string, string> {
  return access.kind === 'bearer' ? {Authorization: `Bearer ${access.token}`} : {};
}
export function endpointOrigin(endpoint: string) {
  const base = new URL(endpoint);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Invalid endpoint');
  return base.origin;
}
export async function discoverAccess(endpoint: string, transport: HttpAgentFetchFn, signal: AbortSignal) {
  const response = await transport(endpointOrigin(endpoint) + '/api/access', {method: 'GET', signal});
  if (!response.ok) throw new Error('Access discovery failed');
  return AccessCapability.parse(await response.json());
}

export async function recentConversations(endpoint: string, access: ClientAccess, transport: HttpAgentFetchFn, signal: AbortSignal) {
  const response = await transport(endpointOrigin(endpoint) + '/api/conversations', {method: 'GET', headers: authorizationHeaders(access), signal});
  if (!response.ok) throw new Error('Conversation access rejected');
  return z.array(z.object({id: z.string().uuid(), revision: z.number().int().nonnegative()}).strict()).parse(await response.json()).slice(0, 5);
}
