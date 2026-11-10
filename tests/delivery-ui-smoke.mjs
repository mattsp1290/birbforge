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
  browser = await chromium.launch({headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
  const page = await browser.newPage({viewport: {width: 430, height: 932}});
  let id = randomUUID();
  const commands = [];
  const offer = {offer_id: 'pilot', title: 'Document the factory restart procedure', goal_text: 'Write the operator restart procedure for the private factory pilot.',
    repository_id: 'owner/repo', base_commit: 'a'.repeat(40), policy_revision: 'b'.repeat(64), allowed_paths: ['docs/operator.md'], acceptance_id: 'docs-check',
    goal_ref: {project: 'forge', record_id: 'example', revision: '1', content_sha256: 'c'.repeat(64)}};
  const state = () => ({revision: commands.length, offer, offer_sha256: 'd'.repeat(64), conversation_id: commands.length ? id : null,
    delivery_id: commands.length ? '11111111-1111-4111-8111-111111111111' : null, cancellation: 'none', command_ids: commands,
    stage: {kind: commands.length ? 'authoring' : 'awaiting_approval'}});
  const conversation = () => ({id, mode: 'approved-goal', revision: 0, phase: 'idle', cursor: 0, inputs: [], human: null, decisions: [], messages: [],
    context: {project: 'forge', commit: 'a'.repeat(40), notes: []}, failure: null});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let payload;
    if (path === '/api/access') payload = {kind: 'bearer'};
    else if (path.endsWith('/delivery/command')) {commands.push(request.postDataJSON().command_id); payload = state();}
    else if (path.endsWith('/events')) {
      const snapshot = path.includes('/delivery/') ? {delivery: state()} : conversation();
      const events = [{type: 'RUN_STARTED', threadId: id, runId: 'smoke'}, {type: 'STATE_SNAPSHOT', snapshot}, {type: 'RUN_FINISHED', threadId: id, runId: 'smoke'}];
      await route.fulfill({contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')});
      return;
    } else {
      if (path.endsWith('/conversations') && request.method() === 'POST') id = request.postDataJSON().id;
      payload = conversation();
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify(payload)});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByLabel('Owner test credential', {exact: true}).fill('disposable-browser-smoke');
  await page.getByRole('button', {name: 'New conversation', exact: true}).click();
  await page.getByRole('button', {name: 'Approve goal and start', exact: true}).waitFor();
  await page.getByRole('button', {name: 'Inbox (1)', exact: true}).click();
  await page.getByRole('button', {name: 'Approve goal and start', exact: true}).click();
  await page.getByTestId('delivery-stage').filter({hasText: 'authoring'}).waitFor();
  if (commands.length !== 1) throw Error('Expected exactly one approval');
  if (await page.getByRole('button', {name: 'Send goal', exact: true}).count()) throw Error('Synthetic input visible in pilot');
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Horizontal overflow');
  if (process.env.SCREENSHOT_PATH) await page.screenshot({path: process.env.SCREENSHOT_PATH, fullPage: true});
  process.stdout.write('Built web smoke passed with simulated API. One approval, shared inbox card, hidden proof composer, no horizontal overflow.\n');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
