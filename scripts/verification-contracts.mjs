import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {compileFromFile} from 'json-schema-to-typescript';

const configPath = (await readFile('.local/guest-setup-path', 'utf8')).trim();
const setup = JSON.parse(await readFile(configPath, 'utf8'));
const revision = 'a70315a276837ffdde32049fdb77670a3468e151';
if (setup.revisions.birbverify !== revision) throw new Error('Birbverify pin mismatch');
const root = setup.exports.birbverify;
const hashes = JSON.parse(await readFile(join(root, 'docs/evidence/source-manifest.json'), 'utf8'));
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
    bannerComment: `/* Generated from Birbverify ${revision}. Run scripts/verification-contracts.mjs. */`,
    style: {singleQuote: true, tabWidth: 2},
  });
  await writeFile(join(target, `${name}.d.ts`), output);
}
