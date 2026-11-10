import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {randomUUID} from 'node:crypto';

const server = createServer(async (request, response) => {
  try {
    const path = resolve('dist', '.' + (request.url === '/' ? '/index.html' : request.url));
    response.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript' : extname(path) === '.html' ? 'text/html' : 'application/octet-stream');
    response.end(await readFile(path));
  } catch {response.writeHead(404); response.end();}
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({...(process.env.BIRBFORGE_CHROMIUM ? {executablePath: process.env.BIRBFORGE_CHROMIUM} : {channel: 'chrome'}), headless: true});
  for (const width of [430, 1280]) {
    const page = await browser.newPage({viewport: {width, height: 932}});
    const requests = [];
    let project = null;
    let frozen = null;
    let membership = [];
    const chats = [];
    let firstCreate = true;
    let firstChat = true;
    let creationIdentity = null;
    const repositories = [
      {id: 22, name: 'zebra', full_name: 'owner/zebra', html_url: 'https://github.com/owner/zebra', default_branch: 'main'},
      {id: 11, name: 'alpha', full_name: 'owner/alpha', html_url: 'https://github.com/owner/alpha', default_branch: 'main'},
    ];
    await page.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const body = request.method() === 'POST' ? request.postDataJSON() : null;
      requests.push({path: url.pathname, body});
      let payload;
      if (url.pathname === '/api/access') payload = {kind: 'private-single-owner'};
      else if (url.pathname === '/api/session') payload = {authenticated: true, managedProjects: true};
      else if (url.pathname === '/api/conversations') payload = [];
      else if (url.pathname === '/api/github/repositories') payload = {repositories: repositories.filter(repo => repo.full_name.includes(url.searchParams.get('q') || '')), page: 1, has_more: false};
      else if (url.pathname === '/api/projects' && body) {
        if (body.change.type === 'create') {
          if (creationIdentity) assert.deepEqual({id: body.project_id, operation: body.operation_id}, creationIdentity);
          else creationIdentity = {id: body.project_id, operation: body.operation_id};
          assert.deepEqual(body.change.repository_ids, ['22', '11']);
          assert.equal(body.change.name, null);
          membership = repositories.map(repo => ({id: String(repo.id), full_name: repo.full_name, html_url: repo.html_url}));
          project = {id: body.project_id, name: 'zebra', revision: '1', archived: false, repositories: membership};
        } else if (body.change.type === 'rename') project = {...project, name: body.change.name, revision: '2'};
        else if (body.change.type === 'archive') project = {...project, archived: true, revision: '3'};
        if (body.change.type === 'create' && firstCreate) {firstCreate = false; await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({code: 'acknowledgement_unknown'})}); return;}
        payload = {schema_version: 1, operation_id: body.operation_id, replayed: false, project, commit: 'a'.repeat(40), sha: 'a'.repeat(40), pushed: true, message: 'saved'};
      } else if (url.pathname === '/api/projects') payload = project && !project.archived ? [project] : [];
      else if (url.pathname.endsWith('/conversations') && body) {
        frozen = {id: body.id, mode: 'project', kind: 'project', context_sha256: 'c'.repeat(64), revision: 1, phase: 'idle', cursor: 1, inputs: [], human: null, decisions: [], messages: [], failure: null,
          context: {project: project.id, commit: 'a'.repeat(40), notes: []}, project_context: {schema_version: 'birbcrew.project-context.v1', project_id: project.id, project_revision: project.revision, project_name: project.name,
            repositories: membership.map(repo => ({repository_id: repo.id, full_name: repo.full_name, url: repo.html_url, commit: 'b'.repeat(40)})), sources: []}};
        if (!chats.some(chat => chat.id === body.id)) chats.push({id: body.id, revision: 1, project_id: project.id, project_revision: project.revision});
        if (firstChat) {firstChat = false; await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({code: 'acknowledgement_unknown'})}); return;}
        assert.equal(chats.length, 1); payload = frozen;
      } else if (url.pathname.endsWith('/conversations')) payload = chats;
      else if (url.pathname.endsWith('/events')) {
        const stream = [{type: 'RUN_STARTED', threadId: frozen.id, runId: 'ui-fixture'}, {type: 'MESSAGES_SNAPSHOT', messages: frozen.messages}, {type: 'STATE_SNAPSHOT', snapshot: frozen}, {type: 'RUN_FINISHED', threadId: frozen.id, runId: 'ui-fixture'}];
        await route.fulfill({contentType: 'text/event-stream', body: stream.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')}); return;
      } else if (url.pathname.startsWith('/api/conversations/')) payload = frozen;
      else payload = project;
      await route.fulfill({contentType: 'application/json', body: JSON.stringify(payload)});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('tab', {name: 'Projects', exact: true}).click();
    await page.getByRole('button', {name: 'Import repositories into a new project', exact: true}).click();
    await page.getByRole('button', {name: 'Select owner/zebra', exact: true}).click();
    await page.getByRole('button', {name: 'Select owner/alpha', exact: true}).click();
    assert.equal(await page.getByLabel('New project name', {exact: true}).getAttribute('placeholder'), 'zebra');
    await page.getByRole('button', {name: 'Create project', exact: true}).click();
    await page.getByRole('button', {name: 'Retry same project edit', exact: true}).waitFor();
    await page.reload();
    await page.getByRole('tab', {name: 'Projects', exact: true}).click();
    await page.getByRole('button', {name: 'Retry same project edit', exact: true}).click();
    await page.getByLabel('Project name', {exact: true}).fill('My project');
    await page.getByRole('button', {name: 'Save project name', exact: true}).click();
    await page.getByRole('heading', {name: 'My project', exact: true}).waitFor();
    await page.getByRole('button', {name: 'New project chat', exact: true}).click();
    await page.getByRole('button', {name: 'Retry same new chat', exact: true}).waitFor();
    await page.reload();
    await page.getByRole('tab', {name: 'Projects', exact: true}).click();
    await page.getByRole('button', {name: 'Retry same new chat', exact: true}).click();
    await page.getByLabel('Project message', {exact: true}).waitFor();
    assert.equal(await page.getByRole('button', {name: 'Send message', exact: true}).isEnabled(), false);
    await page.getByLabel('Project message', {exact: true}).fill('Compare both repositories.');
    assert.equal(await page.getByRole('button', {name: 'Send message', exact: true}).isEnabled(), true);
    assert.equal(await page.getByRole('button', {name: 'Approve goal and start', exact: true}).count(), 0);
    assert.equal(requests.filter(item => item.path.endsWith('/command')).length, 0);
    assert.equal(requests.filter(item => item.path.endsWith('/inputs')).length, 0);
    const directory = process.env.PROJECT_CHATS_EVIDENCE;
    if (directory) {await mkdir(directory, {recursive: true}); await page.screenshot({path: resolve(directory, `project-chat-ui-${width}.png`), fullPage: true});}
    await page.getByRole('button', {name: 'Back to project', exact: true}).click();
    await page.getByRole('button', {name: 'Remove project from active use', exact: true}).click();
    await page.getByRole('button', {name: 'Confirm remove project from active use', exact: true}).click();
    await page.getByText('Removed from active use', {exact: false}).waitFor();
    assert.equal(await page.getByRole('button', {name: 'New project chat', exact: true}).isEnabled(), false);
    assert.equal(await page.getByRole('button', {name: new RegExp(`^Open chat ${frozen.id.slice(0, 8)}`)}).count(), 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    if (directory) await writeFile(resolve(directory, `project-ui-${width}.json`), JSON.stringify({kind: 'simulated-api-ui', browser: await browser.version(), width, checks: ['ordered selection and default', 'lost create and chat acknowledgements restored unchanged after full reload', 'rename', 'project chat composer', 'no execution dispatch', 'archive preserves chat'], requests: requests.length}, null, 2));
    await page.close();
  }
  process.stdout.write(`Built project UI passed in Chromium on ${process.platform} at 430px and 1280px using a simulated API.\n`);
} finally {await browser?.close(); await new Promise(done => server.close(done));}
