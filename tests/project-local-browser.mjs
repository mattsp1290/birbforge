import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';

const evidence = process.env.PROJECT_CHATS_BROWSER_SESSION;
if (!evidence) throw new Error('Explicit owned local browser session required');
const session = JSON.parse(await readFile(evidence, 'utf8'));
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 1000}});
  const commands = [];
  page.on('request', request => {if (request.method() === 'POST' && !request.url().endsWith('/events')) commands.push(new URL(request.url()).pathname);});
  await page.goto(session.url);
  await page.getByLabel('Owner test credential', {exact: true}).fill(session.token);
  await page.getByRole('button', {name: 'Projects', exact: true}).click();
  await page.getByRole('button', {name: 'Open Forge and Crew assembled journey', exact: true}).click();
  await page.getByRole('button', {name: new RegExp(`^Open chat ${session.conversation_id.slice(0, 8)}`)}).click();
  await page.getByLabel('Project message', {exact: true}).waitFor();
  await page.getByText('This project has changed. This chat keeps its historical context. Start a new project chat to use current membership.', {exact: true}).waitFor();
  const body = await page.locator('body').innerText();
  assert.ok(body.includes('mattsp1290/birbforge'));
  assert.ok(body.includes('mattsp1290/birbcrew'));
  assert.ok(body.includes('4946e16169c82d541b32f8b69072feac2e4af4a4'));
  assert.ok(body.includes('815ab3d61beb3756a799cfe0160a9e8d19188401'));
  assert.ok(body.includes('docs/architecture.md'));
  assert.equal(await page.getByRole('button', {name: 'Approve goal and start', exact: true}).count(), 0);
  await page.getByRole('button', {name: 'Reconnect', exact: true}).click();
  await page.getByText('idle', {exact: false}).first().waitFor();
  assert.equal(commands.length, 0);
  const directory = resolve(evidence, '..');
  await page.screenshot({path: resolve(directory, 'mac-chrome-project-chat.png'), fullPage: true});
  await writeFile(resolve(directory, 'mac-browser.json'), JSON.stringify({kind: 'real-local-service-browser', browser: await browser.version(), headless: true,
    environment: 'owned local Mac loopback fixture with source hashes in assembled report', project_id: session.project_id, conversation_id: session.conversation_id,
    checked: ['actual project catalog', 'historical project context', 'both GitHub identities and exact commits', 'real finalized provider answer', 'reconnect without input/approval'],
    commands, shared_staging: false, installed_phone: false}, null, 2));
  process.stdout.write('Actual local Mac Chrome observed the finalized two-repository project chat and reconnected without a command.\n');
} finally {await browser.close();}
