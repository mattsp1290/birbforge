import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {GitHubConnection} from '../server/github';

const directory = process.env.PROJECT_CHATS_EVIDENCE;
if (!directory) throw new Error('Explicit private evidence directory required');
const privateDirectory = resolve(directory, 'private');
const connection = await GitHubConnection.configured({token_file: resolve(privateDirectory, 'github.token'), owner_login: (await readFile(resolve(privateDirectory, 'github-login.txt'), 'utf8')).trim()});
const contexts = [];
for (const name of ['mattsp1290/birbforge', 'mattsp1290/birbcrew']) {
  const page = await connection.repositories(name, 1, contexts.length === 0);
  const repository = page.repositories.find(repo => repo.full_name === name);
  if (!repository) throw new Error('Authorized source repository unavailable');
  contexts.push(await connection.context(repository.id));
}
await writeFile(resolve(privateDirectory, 'github-contexts.json'), JSON.stringify(contexts), {mode: 0o600});
await writeFile(resolve(directory, 'github-live-read.json'), JSON.stringify({
  kind: 'live-service-github-read', connection: 'owner authorized existing GitHub CLI credential in isolated server token file',
  identity_verified_by: 'Octokit GET /user', timestamp: new Date().toISOString(),
  repositories: contexts.map(context => ({id: context.repository.id, full_name: context.repository.full_name, commit: context.commit,
    files: context.files.map(({path, content_sha256}) => ({path, content_sha256}))})),
  limits: ['No GitHub repository mutation', 'No worker or merge authorization', 'Not an installed device journey'],
}, null, 2));
process.stdout.write('Authorized service identity read both repositories at exact commits. Sanitized receipt saved.\n');
