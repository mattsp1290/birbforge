import {connectMachine} from '../scripts/browser-machine.mjs';
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';

const file = process.env.PROJECT_CHATS_BROWSER_SESSION;
if (!file) throw new Error('Explicit owned local fixture session required');
const session = JSON.parse(await readFile(file, 'utf8'));
const browser = await chromium.launch({channel: 'chrome', headless: true});
const name = `Browser proof ${Date.now()}`;
const commands = [];
try {
  const first = await browser.newPage({viewport: {width: 1280, height: 1000}});
  const second = await browser.newPage({viewport: {width: 430, height: 932}});
  const enter = async page => {
    await connectMachine(page, session.url, session.token);
    await page.getByRole('tab', {name: 'Projects', exact: true}).click();
  };
  first.on('request', request => {if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/projects') commands.push(request.postDataJSON());});
  await enter(first);
  await first.getByRole('button', {name: 'Import repositories into a new project', exact: true}).click();
  for (const repository of ['mattsp1290/birbforge', 'mattsp1290/birbcrew']) {
    await first.getByLabel('Search accessible repositories', {exact: true}).fill(repository);
    await first.getByRole('button', {name: `Select ${repository}`, exact: true}).click();
  }
  assert.equal(await first.getByLabel('New project name', {exact: true}).getAttribute('placeholder'), 'birbforge');
  await first.getByLabel('New project name', {exact: true}).fill(name);
  await first.getByRole('button', {name: 'Create project', exact: true}).click();
  await first.getByRole('heading', {name, exact: true}).waitFor();
  const creation = commands.find(command => command.change.type === 'create');
  assert.deepEqual(creation.change.repository_ids, ['1447665555', '1447699708']);
  await enter(second);
  await second.getByRole('button', {name: `Open ${name}`, exact: true}).click();
  await second.getByLabel('Project name', {exact: true}).waitFor();
  await first.getByLabel('Project name', {exact: true}).fill(`${name} renamed`);
  await first.getByRole('button', {name: 'Save project name', exact: true}).click();
  await first.getByRole('heading', {name: `${name} renamed`, exact: true}).waitFor();
  await second.getByLabel('Project name', {exact: true}).fill(`${name} stale`);
  await second.getByRole('button', {name: 'Save project name', exact: true}).click();
  await second.getByText('project revision conflict', {exact: true}).waitFor();
  await second.getByRole('button', {name: 'Discard rejected edit and refresh', exact: true}).click();
  let lost = false;
  await first.route('**/api/projects', async route => {
    if (route.request().method() !== 'POST' || lost) return route.continue();
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    lost = true;
    await route.fulfill({status: 503, contentType: 'application/json', body: '{"code":"acknowledgement_unknown"}'});
  });
  await first.getByLabel('Project name', {exact: true}).fill(`${name} recovered`);
  await first.getByRole('button', {name: 'Save project name', exact: true}).click();
  await first.getByRole('button', {name: 'Retry same project edit', exact: true}).waitFor();
  const lostCommand = commands.at(-1);
  await enter(first);
  await first.getByRole('button', {name: 'Retry same project edit', exact: true}).click();
  await first.getByRole('heading', {name: `${name} recovered`, exact: true}).waitFor();
  assert.deepEqual(commands.at(-1), lostCommand);
  await first.getByRole('button', {name: 'New project chat', exact: true}).click();
  await first.getByLabel('Project message', {exact: true}).waitFor();
  const chat = await first.getByTestId('conversation-id').innerText();
  await first.getByRole('button', {name: 'Cancel conversation', exact: true}).click();
  await first.getByRole('button', {name: 'Confirm cancel conversation', exact: true}).click();
  await first.getByText('cancelled', {exact: false}).first().waitFor();
  await first.getByRole('button', {name: 'Back to project', exact: true}).click();
  await first.getByRole('button', {name: 'Remove mattsp1290/birbcrew', exact: true}).click();
  await first.getByRole('button', {name: 'Remove mattsp1290/birbcrew', exact: true}).waitFor({state: 'detached'});
  await first.getByRole('button', {name: 'Remove mattsp1290/birbforge', exact: true}).click();
  await first.getByText('last repository', {exact: true}).waitFor();
  await first.getByRole('button', {name: 'Discard rejected edit and refresh', exact: true}).click();
  await first.getByRole('button', {name: 'Remove project from active use', exact: true}).click();
  await first.getByRole('button', {name: 'Confirm remove project from active use', exact: true}).click();
  await first.getByText('Removed from active use', {exact: false}).waitFor();
  assert.equal(await first.getByRole('button', {name: new RegExp(`^Open chat ${chat.slice(0, 8)}`)}).count(), 1);
  assert.equal(await first.getByRole('button', {name: 'New project chat', exact: true}).isEnabled(), false);
  await writeFile(resolve(file, '..', 'mac-live-crud.json'), JSON.stringify({kind: 'actual-local-service-browser-mutations', browser: await browser.version(), headless: true,
    project_id: creation.project_id, preserved_chat_id: chat, commands, lost_edit_retried_unchanged: true, stale_second_browser_conflict: true,
    checks: ['real GitHub picker ordered selection and default', 'custom name', 'real Beans mutation', 'stale second-browser edit', 'lost real edit acknowledgement and full reload', 'chat created without provider turn', 'read-only chat cancellation', 'last membership rejection', 'archive preserves chat'],
    shared_staging: false, installed_phone: false, implementation_dispatched: false}, null, 2));
  process.stdout.write('Actual Mac Chrome project CRUD, stale second-browser edit, real lost acknowledgement/reload recovery, chat preservation and archive passed.\n');
} finally {await browser.close();}
