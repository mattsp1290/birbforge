import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('canonical repository metadata and GitHub proof use renamed repositories', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.name, 'forge');
  assert.equal(pkg.repository.url, 'https://github.com/mattsp1290/forge.git');
  assert.equal(JSON.parse(read('package-lock.json')).packages[''].name, 'forge');
  assert.equal(JSON.parse(read('packaging/kubernetes-producer.json')).repository, 'https://github.com/mattsp1290/verify');
  const proof = read('scripts/project-github-proof.ts');
  assert.ok(proof.includes("['mattsp1290/forge', 'mattsp1290/crew']"));
  assert.ok(read('scripts/project-journey.py').includes('project["name"] == "forge"'));
});

test('product rename preserves installed app identity and versioned contracts', () => {
  const app = JSON.parse(read('app.json')).expo;
  assert.equal(app.name, 'Forge');
  assert.equal(app.slug, 'birbforge');
  assert.equal(app.ios.bundleIdentifier, 'dev.birbforge.proof');
  assert.equal(app.android.package, 'dev.birbforge.proof');
  assert.ok(read('app/src/settings.ts').includes("'birbforge.machine.'"));
  assert.ok(read('app/src/contract.ts').includes("'birbcrew.project-context.v1'"));
  assert.ok(read('server/projects.ts').includes("'X-Birbforge-Project-Token'"));
});
