import {connectMachine} from './browser-machine.mjs';
import {chromium} from '@playwright/test';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';

const session = JSON.parse(readFileSync('.local/verification-session.json', 'utf8'));
assert.equal(session.profile, 'legacy-v1', 'This historical browser proof requires scripts/verification-dev --legacy-v1');
assert.ok(session.running_source_sha256, 'Launcher must bind its running source and web build');
const sourcePaths = Object.keys(session.running_source_sha256);
const sourceHashes = () => Object.fromEntries(sourcePaths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const testedSource = sourceHashes();
assert.deepEqual(testedSource, session.running_source_sha256, 'Running fixture must match the source under test');
const executablePath = process.env.BIRBFORGE_CHROMIUM;
if (!executablePath) throw new Error('Select an existing Mac Chromium binary with BIRBFORGE_CHROMIUM');
const browser = await chromium.launch({executablePath, headless: true});
const context = await browser.newContext({viewport: {width: 1280, height: 1100}});
context.setDefaultTimeout(30_000);
context.setDefaultNavigationTimeout(30_000);
const errors = [];
const checks = [];
let lastObservation = null;
let cancellationStatus = null;
const headers = {Authorization: `Bearer ${session.tokens.owner}`, 'Content-Type': 'application/json'};
async function snapshot(id) {
  const response = await fetch(`${session.url}/api/conversations/${id}/verification`, {headers});
  assert.equal(response.status, 200);
  lastObservation = await response.json();
  return lastObservation;
}
async function until(read, predicate, label) {
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
function candidate(kind) {
  return execFileSync('scripts/guest', ['--', session.producer_python, '-c',
    'import json,sys; from pathlib import Path; p=Path(sys.argv[1])/"installation.json"; d=json.loads(p.read_text()); d["current_candidate"]=d[sys.argv[2]]; t=p.with_suffix(".browser.tmp"); t.write_text(json.dumps(d)); t.chmod(0o600); t.replace(p); print(d["current_candidate"])',
    session.installation_root, kind], {stdio: 'pipe', encoding: 'utf8'}).trim();
}
try {
  for (const [path, expected] of Object.entries(testedSource).filter(([path]) => path.startsWith('dist/'))) {
    const response = await fetch(session.url + '/' + path.slice('dist/'.length));
    assert.equal(response.status, 200, path);
    assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), expected, path);
  }
  const a = await context.newPage();
  const b = await context.newPage();
  for (const page of [a,b]) page.on('pageerror', error => errors.push(error.message));
  async function connect(page) {
    await connectMachine(page, session.url, session.tokens.owner);
    await page.getByRole('tab', {name: 'Factory', exact: true}).click();
  }
  await connect(a);
  await a.getByRole('button', {name: 'New conversation', exact: true}).click();
  const identity = await a.getByTestId('conversation-id').textContent();
  assert.match(identity, /^[0-9a-f-]{36}$/);
  await a.getByRole('button', {name: 'Request verification', exact: true}).waitFor();
  await connect(b);
  await b.getByRole('textbox', {name: 'Conversation identity', exact: true}).fill(identity);
  await b.getByRole('button', {name: 'Continue conversation', exact: true}).click();
  await b.getByRole('button', {name: /^Inbox/}).click();
  let submissions = 0;
  let acceptedBody;
  await a.route('**/verification', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    submissions++;
    acceptedBody = route.request().postDataJSON();
    const response = await route.fetch();
    assert.ok(response.ok());
    await route.abort('failed');
  });
  await a.getByRole('button', {name: 'Request verification', exact: true}).click();
  await until(() => snapshot(identity), value => value.requests.length === 1 && value.requests[0].outcome === 'passed', 'real passed result');
  const retry = a.getByRole('button', {name: 'Refresh and retry same verification action', exact: true});
  if (await retry.isVisible()) await retry.click();
  for (const page of [a,b]) {
    await page.getByTestId('verification-outcome').filter({hasText: 'passed'}).waitFor({timeout: 30_000});
    await page.getByTestId('verification-eligibility').filter({hasText: 'Evidence complete'}).waitFor();
    assert.match(await page.getByTestId('verification-request').textContent(), new RegExp(acceptedBody.request_id));
  }
  assert.equal(submissions, 1, 'Reconciliation must not submit another verification');
  const before = (await snapshot(identity)).requests[0];
  console.log('Browser observed shared passed request');
  await a.unroute('**/verification');
  checks.push('Lost admission acknowledgement reconciled without another POST; both conversation and inbox display the same real passed request and attempt.');
  await b.getByRole('button', {name: 'Show verification identities', exact: true}).click();
  assert.ok((await b.getByTestId('verification-request').textContent()).includes(before.request_sha256));
  await b.screenshot({path: '.local/verification-inbox.png', fullPage: true});
  const slow = candidate('slow');
  await a.getByRole('button', {name: 'Refresh verification', exact: true}).click();
  await a.getByText(new RegExp(`Candidate ${slow.slice(0, 12)} · plan`)).waitFor();
  await a.getByRole('button', {name: 'Request verification', exact: true}).click();
  const active = await until(() => snapshot(identity), value => value.requests.length === 2 && value.requests[1].attempt_id, 'running request');
  await a.getByRole('button', {name: 'Disconnect', exact: true}).click();
  await until(() => a.getByTestId('verification-eligibility').filter({hasText: 'Historical evidence'}).count(), count => count === 2, 'historical evidence after disconnect');
  const disconnected = await snapshot(identity);
  assert.equal(disconnected.requests[1].cancellation, 'none');
  assert.equal(disconnected.requests[1].attempt_id, active.requests[1].attempt_id);
  const activeCard = b.getByTestId('verification-request').filter({hasText: active.requests[1].request_id});
  await activeCard.getByText('VERIFICATION REQUEST · running', {exact: true}).waitFor();
  const cancellationReply = b.waitForResponse(response => response.url().endsWith('/verification/cancel'));
  await activeCard.getByRole('button', {name: 'Cancel verification request', exact: true}).click();
  cancellationStatus = (await cancellationReply).status();
  assert.equal(cancellationStatus, 200);
  const cancelled = await until(() => snapshot(identity), value => value.requests[1].cancellation === 'acknowledged', 'target acknowledged cancellation');
  assert.equal(cancelled.requests[1].outcome, 'cancelled');
  await a.getByRole('button', {name: 'Reconnect', exact: true}).click();
  for (const page of [a,b]) await page.getByTestId('verification-outcome').filter({hasText: 'cancelled'}).waitFor({timeout: 30_000});
  assert.deepEqual(cancelled.requests[0].manifest, before.manifest);
  assert.equal(cancelled.requests[0].eligibility.reason, 'candidate_changed');
  checks.push('Disconnect did not cancel. Inbox cancellation reached target-confirmed acknowledgement, then reconnect showed the same cancellation in conversation.');
  checks.push('Changing the installed candidate left the old passed manifest unchanged and made its gate ineligible.');
  await b.getByRole('button', {name: 'Conversation', exact: true}).click();
  await b.getByTestId('verification-outcome').filter({hasText: 'cancelled'}).waitFor();
  await b.screenshot({path: '.local/verification-cancellation.png', fullPage: true});
  assert.deepEqual(errors, []);
  assert.deepEqual(sourceHashes(), testedSource, 'Source must remain unchanged during browser proof');
  writeFileSync('docs/evidence/verification-browser.json', JSON.stringify({
    checked_at: new Date().toISOString(), target: `${process.platform}/${process.arch} headless Chromium`,
    browser_version: browser.version(), node_version: process.version, checks, page_errors: errors,
    admission_posts_for_lost_reply: submissions, native_phone: 'PENDING',
    screenshots: 'Private .local/verification-inbox.png and verification-cancellation.png',
    source_sha256: testedSource,
  }, null, 2) + '\n');
} catch (error) {
  writeFileSync('.local/verification-browser-failure.json', JSON.stringify({error: String(error), cancellationStatus, lastObservation, source_sha256: testedSource}, null, 2), {mode: 0o600});
  for (const [index, page] of context.pages().entries()) await page.screenshot({path: `.local/verification-browser-failure-${index}.png`, fullPage: true});
  throw error;
} finally {
  candidate('passing');
  await browser.close();
}
