import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {compileFromFile} from 'json-schema-to-typescript';

const configPath = (await readFile('.local/guest-setup-path', 'utf8')).trim();
const setup = JSON.parse(await readFile(configPath, 'utf8'));
const revision = 'e785dd8882222b18eaf59ce2b1ceecbd092dcd9e';
if (setup.revisions.birbverify !== revision) throw new Error('Birbverify pin mismatch');
const root = setup.exports.birbverify;
const hashes = JSON.parse(await readFile(join(root, 'docs/evidence/contextless-closure-acceptance.json'), 'utf8')).source_hashes;
for (const [name, expected] of Object.entries(hashes)) {
  const actual = createHash('sha256').update(await readFile(join(root, name))).digest('hex');
  if (actual !== expected) throw new Error(`Producer hash mismatch: ${name}`);
}
const target = 'server/contracts/birbverify.v1';
await mkdir(target, {recursive: true});
for (const file of Object.keys(hashes).filter(name => name.startsWith('contracts/v1/'))) {
  await copyFile(join(root, file), join(target, file.slice('contracts/v1/'.length)));
}
await writeFile(join(target, 'source.json'), JSON.stringify({revision, source_hashes: hashes}, null, 2) + '\n');
for (const name of ['request', 'manifest']) {
  const output = await compileFromFile(join(target, `${name}.schema.json`), {
    bannerComment: '',
    style: {singleQuote: true, tabWidth: 2},
  });
  await writeFile(join(target, `${name}.d.ts`), output);
}

for (const [source, destination] of [['contracts/closure/v1', 'server/contracts/birbverify.closure.v1'], ['contracts/target/v2', 'server/contracts/birbverify.target.v2']]) {
  await mkdir(destination, {recursive: true});
  for (const file of Object.keys(hashes).filter(name => name.startsWith(source + '/'))) {
    await copyFile(join(root, file), join(destination, file.slice(source.length + 1)));
  }
  await writeFile(join(destination, 'source.json'), JSON.stringify({revision}, null, 2) + '\n');
}
