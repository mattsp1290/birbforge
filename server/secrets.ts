import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, mkdir, open, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SecretCommand, SecretName} from '../app/src/secrets';

export {SecretCommand};

export class SecretStoreError extends Error {
  constructor(readonly status: number) {super(status === 400 ? 'invalid_secret_command' : 'secrets_unavailable');}
}

const missing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';

export class SecretStore {
  private directory: string;
  constructor(workspaceDirectory: string) {this.directory = join(workspaceDirectory, 'secrets');}

  private async prepare() {
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    const directory = await lstat(this.directory);
    if (!directory.isDirectory() || (directory.mode & 0o077) !== 0 || directory.uid !== process.getuid?.()) {
      throw new SecretStoreError(503);
    }
  }

  async list(): Promise<string[]> {
    try {
      await this.prepare();
      const entries = await readdir(this.directory, {withFileTypes: true});
      return entries.filter(entry => entry.isFile() && SecretName.safeParse(entry.name).success).map(entry => entry.name).sort();
    } catch {throw new SecretStoreError(503);}
  }

  async set(name: string, value: string): Promise<void> {
    if (!SecretCommand.safeParse({kind: 'set', name, value}).success) throw new SecretStoreError(400);
    try {
      await this.prepare();
      const staging = join(this.directory, '.' + randomUUID());
      try {
        await writeFile(staging, value, {mode: 0o600, flag: 'wx'});
        await rename(staging, join(this.directory, name));
      } finally {await rm(staging, {force: true});}
    } catch {throw new SecretStoreError(503);}
  }

  async remove(name: string): Promise<void> {
    if (!SecretName.safeParse(name).success) throw new SecretStoreError(400);
    try {
      await this.prepare();
      await rm(join(this.directory, name), {force: true});
    } catch {throw new SecretStoreError(503);}
  }

  async get(name: string): Promise<string | null> {
    if (!SecretName.safeParse(name).success) throw new SecretStoreError(400);
    try {
      await this.prepare();
      const file = await open(join(this.directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new SecretStoreError(503);
        return await file.readFile('utf8');
      } finally {await file.close();}
    } catch (error) {if (missing(error)) return null; throw new SecretStoreError(503);}
  }
}
