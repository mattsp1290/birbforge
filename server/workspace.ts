import type {IncomingMessage} from 'node:http';
import {CatalogError, CatalogService} from './catalog';
import {ChatError, createChatService} from './chat';
import {SecretCommand, SecretStore, SecretStoreError} from './secrets';
import {inspectFactory} from './factory';

type Config = Parameters<typeof inspectFactory>[0];
type Options = {directory: string; ownerPrincipal?: string; hub?: string; python?: string; attestation?: string};

export function workspace(config: Config, options: Options) {
  const ownerPrincipal = config.projects?.owner_principal ?? options.ownerPrincipal ?? 'owner';
  const catalog = new CatalogService({...options, managedBeans: config.projects?.beans});
  const inspect = () => inspectFactory(config, ownerPrincipal);
  const secrets = new SecretStore(options.directory);
  const chat = createChatService({...options, catalog: () => catalog.snapshot(), inspect,
    providerKey: async () => (await secrets.get('OPENCODE_GO_API_KEY')) ?? undefined});
  return {catalog, chat, inspect, secrets, ownerPrincipal};
}
export type Workspace = ReturnType<typeof workspace>;

export async function workspaceAction(services: Workspace | undefined, path: string, method: string | undefined,
  request: IncomingMessage, read: (request: IncomingMessage) => Promise<unknown>, managedProjects: boolean) {
  if (path === '/api/session' && method === 'GET') return {status: 200, data: {authenticated: true, managedProjects}};
  if (!services) return {status: 503, data: {code: 'workspace_unavailable'}};
  if (method !== 'GET' && method !== 'POST') return {status: 405, data: {code: 'method_not_allowed'}};
  let payload: unknown;
  if (method === 'POST') {
    try {payload = await read(request);}
    catch {return {status: 400, data: {code: 'invalid_command'}};}
  }
  try {
    if (path === '/api/secrets') {
      if (method === 'POST') {
        const command = SecretCommand.safeParse(payload);
        if (!command.success) return {status: 400, data: {code: 'invalid_secret_command'}};
        if (command.data.kind === 'set') await services.secrets.set(command.data.name, command.data.value);
        else await services.secrets.remove(command.data.name);
      }
      return {status: 200, data: {names: await services.secrets.list()}};
    }
    if (path === '/api/catalog') {
      return {status: 200, data: method === 'GET' ? await services.catalog.snapshot() : await services.catalog.apply(payload)};
    }
    if (path === '/api/factory' && method === 'GET') return {status: 200, data: await services.inspect()};
    if (path === '/api/chats' || path.startsWith('/api/chats/')) {
      return {status: 200, data: await services.chat.handle(method, path, payload)};
    }
    return {status: 405, data: {code: 'method_not_allowed'}};
  } catch (error) {
    if (error instanceof CatalogError) return {status: error.status, data: {code: error.code}};
    if (error instanceof SecretStoreError || error instanceof ChatError) return {status: error.status, data: {code: error.message}};
    return {status: 503, data: {code: 'workspace_unavailable'}};
  }
}
