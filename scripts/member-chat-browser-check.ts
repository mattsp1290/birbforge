import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute, join, relative, resolve} from 'node:path';
import {chromium, type Page} from '@playwright/test';
import {GatewayConfig, gateway} from '../server/gateway';
import {workspace} from '../server/workspace';
import {startFakeCrew} from '../tests/crew-members-fake';
import {connectMachine} from './browser-machine.mjs';

const screenshots = process.env.BIRBFORGE_SCREENSHOTS ?? '';
if (!isAbsolute(screenshots) || !relative(process.cwd(), screenshots).startsWith('..')) throw new Error('Set BIRBFORGE_SCREENSHOTS to an absolute directory outside the repository');
await mkdir(screenshots, {recursive: true});
const token = randomBytes(32).toString('hex');
const membersToken = randomBytes(32).toString('hex');
const directory = await mkdtemp(join(tmpdir(), 'birbforge-member-chat-'));
const tokenFile = join(directory, 'members-token');
await writeFile(tokenFile, membersToken, {mode: 0o600});
const crew = await startFakeCrew(membersToken, ['pi/fixture.v1', 'codex/fixture.v1']);
crew.steps = ['running', 'running', 'running', 'completed'];
const config = GatewayConfig.parse({url: 'http://127.0.0.1:1', tokens: {owner: token},
  members: {url: crew.url, token_file: tokenFile, profiles: {pi: 'fixture.v1', codex: 'fixture.v1'}}});
const services = workspace(config, {directory: join(directory, 'workspace'), chatMode: 'local'});
const server = gateway(config, resolve(process.argv[2] ?? 'dist'), services);
await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
const address = server.address();
assert.ok(address && typeof address === 'object');
const endpoint = 'http://127.0.0.1:' + address.port;

async function journey(page: Page, label: string) {
  const button = (name: string) => page.getByRole('button', {name, exact: true});
  const navigate = (name: string) => page.getByRole('tab', {name, exact: true}).or(button(name)).click();
  const agentName = 'Wren ' + label;
  await connectMachine(page, endpoint, token);
  await navigate('Crew');
  await button('New agent').click();
  await page.getByRole('textbox', {name: 'Agent name', exact: true}).fill(agentName);
  await page.getByRole('textbox', {name: 'Instructions', exact: true}).fill('Answer questions about the mobile release.');
  await button('Codex').waitFor();
  await button('Pi').click();
  await page.screenshot({path: join(screenshots, `${label}-agent-engine.png`), fullPage: true});
  await button('Save agent').click();
  await page.getByRole('heading', {name: agentName, exact: true}).locator('..').getByText('Engine · Pi', {exact: true}).waitFor();

  await navigate('Chat');
  await button('New chat').click();
  await button(agentName + ' · Pi').click();
  await page.getByRole('heading', {name: agentName, exact: true}).waitFor();
  await page.getByText('Crew member · Pi', {exact: true}).waitFor();
  const text = `What changed in the ${label} build?`;
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill(text);
  await button('Send message').click();
  await page.getByText('Waiting for a reply…', {exact: true}).waitFor();
  await button('Waiting for reply').waitFor();
  await page.screenshot({path: join(screenshots, `${label}-pending.png`), fullPage: true});
  await page.getByText('Member reply: ' + text, {exact: true}).waitFor({timeout: 60_000});
  await button('Send message').waitFor();
  await page.screenshot({path: join(screenshots, `${label}-answer.png`), fullPage: true});
  if (page.viewportSize()!.width < 840) await button('Chats').click();
  await page.getByText(agentName + ' · Pi', {exact: true}).first().waitFor();
  assert.equal(await page.evaluate(value => document.body.innerText.includes(value) || JSON.stringify(localStorage).includes(value), membersToken), false);
  return text;
}

try {
  const browser = await chromium.launch({executablePath: process.env.BIRBFORGE_CHROMIUM});
  try {
    const errors: string[] = [];
    const sent: string[] = [];
    for (const [label, viewport] of [['desktop', {width: 1280, height: 900}], ['phone', {width: 390, height: 844}]] as const) {
      const page = await browser.newPage({viewport});
      page.setDefaultTimeout(30_000);
      page.on('pageerror', error => errors.push(error.message));
      sent.push(await journey(page, label));
      await page.close();
    }
    assert.deepEqual(errors, []);
    assert.equal(crew.members.size, 2);
    assert.deepEqual(crew.submissions.map(item => item.text.split('\n').at(-1)), sent);
    assert.ok(crew.submissions.every(item => item.text.startsWith('<forge-agent-context>\n')));
    console.log(`Member chat passed at 1280px and 390px against the fake Crew API. Screenshots: ${screenshots}`);
  } finally {await browser.close();}
} finally {
  await services.chat.stop();
  server.closeAllConnections();
  await new Promise<void>(done => server.close(() => done()));
  await crew.close();
  await rm(directory, {recursive: true, force: true});
}
