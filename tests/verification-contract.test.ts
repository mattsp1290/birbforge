import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {URL} from 'node:url';
import {validVerificationManifest, validVerificationRequest} from '../server/verification-contract';
import {VerificationRequest} from '../app/src/verification-contract';

const directory = new URL('../server/contracts/birbverify.v1/', import.meta.url);
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(name, directory), 'utf8'));
const setup = JSON.parse(readFileSync(readFileSync('.local/guest-setup-path', 'utf8').trim(), 'utf8'));
const python = join(setup.exports.birbverify, '.venv/bin/python');
const producer = `import json,sys
from birbverify.contract import Request,Manifest,digest
from pydantic import ValidationError
data=json.load(sys.stdin)
try:
 model=(Request if sys.argv[1]=='request' else Manifest).model_validate(data)
 print(json.dumps({'accepted':True,'normalized':model.model_dump(mode='json'),'digest':digest(model)}))
except ValidationError:
 print(json.dumps({'accepted':False}))
`;

function roundtrip(kind: 'request' | 'manifest', value: unknown) {
  const result = spawnSync(python, ['-c', producer, kind], {
    input: JSON.stringify(value), encoding: 'utf8', timeout: 10_000,
    env: {PATH: '/usr/bin:/bin', NODE_ENV: 'test', PYTHONNOUSERSITE: '1', DD_TRACE_ENABLED: 'false', DD_INJECTION_ENABLED: 'false'},
  });
  assert.equal(result.status, 0, 'Pinned Python contract process must execute');
  return JSON.parse(result.stdout);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => canonical(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}

const canonicalDigest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

test('pinned producer schema, semantic validators and canonical JSON survive the TypeScript boundary', () => {
  const request = fixture('request.example.json');
  const manifest = fixture('manifest.example.json');
  assert.ok(validVerificationRequest(request));
  assert.ok(validVerificationManifest(manifest));
  const accepted = roundtrip('request', request);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.digest, readFileSync(new URL('canonical.example.sha256', directory), 'utf8').trim());
  assert.equal(canonicalDigest(accepted.normalized), accepted.digest);
  assert.deepEqual(roundtrip('request', accepted.normalized), accepted);
  assert.equal(roundtrip('manifest', manifest).accepted, true);
  for (const name of ['reject-unknown-version.json', 'reject-credential.json', 'reject-plan-drift.json']) {
    assert.equal(roundtrip('request', fixture(name)).accepted, false, name);
  }
  assert.equal(validVerificationRequest({...request, unexpected: true}), false);
  assert.equal(validVerificationRequest({...request, contract_version: 'birbverify.v2'}), false);
  assert.equal(roundtrip('request', {...request, candidate: {...request.candidate, pr_head: 'f'.repeat(40)}}).accepted, false);
  assert.equal(validVerificationManifest({...manifest, credential: 'forbidden'}), false);

  const {artifact_sha256: omitted, ...withoutDefault} = request.candidate;
  assert.equal(omitted, null);
  const defaulted = roundtrip('request', {...request, candidate: withoutDefault});
  assert.deepEqual(defaulted, accepted);
  const fractional = roundtrip('request', {...request, resources: {...request.resources, deadline: '2030-01-01T00:00:00.123456+00:00'}});
  assert.equal(fractional.normalized.resources.deadline, '2030-01-01T00:00:00.123456Z');
  assert.deepEqual(roundtrip('request', fractional.normalized), fractional);
  const integral = roundtrip('request', {...request, resources: {...request.resources, deadline: '2030-01-01T00:00:00.000000+00:00'}});
  assert.deepEqual(integral, accepted);
  const unicodePlan = {...request.plan, checks: request.plan.checks.map(check => ({...check, assertion: 'value equals 42 · café 🐦'}))};
  const unicode = roundtrip('request', {...request, plan: unicodePlan, plan_sha256: canonicalDigest(unicodePlan)});
  assert.equal(unicode.accepted, true);
  assert.equal(unicode.digest, canonicalDigest(unicode.normalized));
  assert.notEqual(unicode.digest, createHash('sha256').update(JSON.stringify(unicode.normalized)).digest('hex'));
});

test('vendored producer contracts retain every published byte', () => {
  const manifestSchema = JSON.parse(readFileSync(new URL('manifest.schema.json', directory), 'utf8'));
  assert.deepEqual(VerificationRequest.shape.outcome.unwrap().options, manifestSchema.properties.outcome.enum);
  const source = JSON.parse(readFileSync(new URL('source.json', directory), 'utf8'));
  assert.equal(source.revision, 'a70315a276837ffdde32049fdb77670a3468e151');
  for (const [name, expected] of Object.entries(source.source_hashes)) {
    if (!name.startsWith('contracts/v1/')) continue;
    const content = readFileSync(new URL(name.slice('contracts/v1/'.length), directory));
    assert.equal(createHash('sha256').update(content).digest('hex'), expected, name);
  }
});
