import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';

const HttpsOrigin = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.origin === value &&
    !url.username && !url.password && !url.search && !url.hash;
});
export const ProxyConfig = z.object({
  port: z.number().int().min(1024).max(65535),
  origin: HttpsOrigin,
  authentication: z.discriminatedUnion('kind', [
    z.object({kind: z.literal('bearer')}).strict(),
    z.object({kind: z.literal('private-single-owner'), principal: z.string().min(1)}).strict(),
  ]).optional(),
}).strict();
export type ProxySettings = z.infer<typeof ProxyConfig>;
export type ListenerPolicy = {kind: 'loopback'} | {kind: 'privateProxy'; settings: ProxySettings};

export function loadProxyConfig(path: string): ProxySettings {
  if (!isAbsolute(path)) throw new Error('Private configuration requires an absolute path');
  const actual = realpathSync(path);
  const repo = realpathSync(fileURLToPath(new URL('..', import.meta.url).href));
  const withinRepo = relative(repo, actual);
  const outsideRepo = withinRepo.startsWith('..' + sep) || isAbsolute(withinRepo);
  if (!outsideRepo && !withinRepo.startsWith('.local' + sep)) {
    throw new Error('Private configuration must be outside source or under ignored .local');
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) {
      throw new Error('Private configuration requires owner-only file permissions');
    }
    return ProxyConfig.parse(JSON.parse(readFileSync(descriptor, 'utf8')));
  } finally { closeSync(descriptor); }
}
