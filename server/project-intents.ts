import {createHash, randomUUID} from 'node:crypto';
import {link, mkdir, readFile, unlink, open} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {z} from 'zod/v4';
import {ProjectError} from './beans-projects';

const Intent = z.object({fingerprint: z.string(), value: z.unknown()}).strict();
export class ProjectIntents {
  constructor(private readonly directory: string) {}
  async resolve(kind: 'mutation' | 'conversation', id: string, principal: string, request: unknown, prepare: () => Promise<unknown>) {
    const key = createHash('sha256').update(JSON.stringify({principal, request})).digest('hex');
    const path = join(this.directory, `${kind}-${id}.json`);
    const existing = async () => {
      try {
        const intent = Intent.parse(JSON.parse(await readFile(path, 'utf8')));
        if (intent.fingerprint !== key) throw new ProjectError(409, 'operation_identity_conflict');
        return {found: true, value: intent.value};
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {found: false, value: null};
        throw error;
      }
    };
    const prior = await existing();
    if (prior.found) return prior.value;
    const value = await prepare();
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    const temporary = join(this.directory, `.intent-${randomUUID()}`);
    const candidate = await open(temporary, 'wx', 0o600);
    try {await candidate.writeFile(JSON.stringify({fingerprint: key, value})); await candidate.sync();}
    finally {await candidate.close();}
    try {
      try {await link(temporary, path);}
      catch (error) {if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;}
    } finally {await unlink(temporary);}
    for (const directory of [this.directory, dirname(this.directory)]) {
      const handle = await open(directory, 'r');
      try {await handle.sync();} finally {await handle.close();}
    }
    const winner = await existing();
    if (!winner.found) throw new ProjectError(503, 'operation_intent_unavailable');
    return winner.value;
  }
}
