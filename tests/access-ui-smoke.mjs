import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {randomUUID} from 'node:crypto';

const server = createServer(async (request, response) => {
  try {
    const path = resolve('dist', '.' + (request.url === '/' ? '/index.html' : request.url));
    response.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript' : extname(path) === '.html' ? 'text/html' : 'application/octet-stream');
    response.end(await readFile(path));
  } catch {response.writeHead(404); response.end();}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, ...(process.env.BIRBFORGE_CHROMIUM ? {executablePath: process.env.BIRBFORGE_CHROMIUM} : {channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome'})});
  const page = await browser.newPage({viewport: {width: 430, height: 932}});
  const ids = Array.from({length: 7}, () => randomUUID());
  const requests = [];
  let releaseOld;
  const stale = new Promise(resolve => {releaseOld = resolve;});
  let oldStarted = false;
  let holdDiscovery = false;
  let rejectDiscovery = false;
  const offer = {offer_id: 'pilot', title: 'Write docs', goal_text: 'Write docs', repository_id: 'owner/repo', base_commit: 'a'.repeat(40),
    policy_revision: 'b'.repeat(64), allowed_paths: ['docs/operator.md'], acceptance_id: 'docs-check',
    goal_ref: {project: 'forge', record_id: 'one', revision: '1', content_sha256: 'c'.repeat(64)}};
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({path: url.pathname, method: request.method(), authorization: request.headers().authorization});
    if (url.pathname === '/api/access' && holdDiscovery) {oldStarted = true; await stale;}
    if (url.pathname === '/api/access' && rejectDiscovery) {await route.fulfill({status: 403, body: '{}'}); return;}
    let payload;
    const id = ids[0];
    const conversation = {id, mode: 'approved-goal', revision: 0, phase: 'idle', cursor: 0, inputs: [], human: null, decisions: [], messages: [],
      context: {project: 'forge', commit: 'a'.repeat(40), notes: []}, failure: null};
    if (url.pathname === '/api/access') payload = {kind: 'private-single-owner'};
    else if (url.pathname === '/api/session') payload = {authenticated: true, managedProjects: false};
    else if (url.pathname === '/api/conversations') payload = ids.map((id, revision) => ({id, revision}));
    else if (url.pathname.endsWith('/events')) {
      const snapshot = url.pathname.includes('/delivery/') ? {delivery: {revision: 0, offer, offer_sha256: 'd'.repeat(64), conversation_id: null,
        delivery_id: null, cancellation: 'none', command_ids: [], stage: {kind: 'awaiting_approval'}}} : conversation;
      await route.fulfill({contentType: 'text/event-stream', body: [{type: 'RUN_STARTED', threadId: id, runId: 'smoke'},
        {type: 'STATE_SNAPSHOT', snapshot}, {type: 'RUN_FINISHED', threadId: id, runId: 'smoke'}].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')});
      return;
    } else payload = conversation;
    await route.fulfill({contentType: 'application/json', body: JSON.stringify(payload)});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const first = page.getByRole('button', {name: `Open conversation ${ids[0].slice(0, 8)}`, exact: true});
  await first.waitFor();
  assert.equal(await page.getByLabel('Owner credential', {exact: true}).count(), 0);
  assert.equal(await page.getByRole('button', {name: /^Open conversation /}).count(), 5);
  await first.click();
  await page.getByRole('button', {name: 'Approve goal and start', exact: true}).waitFor();
  assert.equal(await page.getByTestId('conversation-id').innerText(), ids[0]);
  await page.getByRole('button', {name: 'Back to conversations', exact: true}).click();
  await first.waitFor();
  await page.getByRole('tab', {name: 'Settings', exact: true}).click();
  holdDiscovery = true;
  await page.getByRole('button', {name: 'Edit connection', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Connect machine"]')?.getAttribute('aria-disabled') === 'true');
  const deadline = Date.now() + 5000;
  while (!oldStarted && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(oldStarted);
  await page.getByLabel('Server URL', {exact: true}).fill('https://other.example.invalid');
  await page.getByRole('button', {name: 'Open machine in browser', exact: true}).waitFor();
  holdDiscovery = false;
  rejectDiscovery = true;
  releaseOld();
  await page.getByLabel('Server URL', {exact: true}).fill(`http://127.0.0.1:${server.address().port}`);
  await page.getByText('Could not check access. Check your endpoint and private network connection.', {exact: true}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Connect machine', exact: true}).isEnabled(), false);
  assert.equal(await page.getByLabel('Owner credential', {exact: true}).count(), 0);
  assert.ok(requests.every(request => request.authorization === undefined));
  assert.equal(requests.filter(request => request.path.endsWith('/command')).length, 0);
  assert.equal(requests.filter(request => request.path === '/api/conversations' && request.method === 'POST').length, 0);
  process.stdout.write('Built web access smoke passed with simulated API: credential-free recent five, direct open, leave/reload, stale endpoint rejection, no approvals or conversation creation.\n');
} finally {await browser?.close(); await new Promise(resolve => server.close(resolve));}
