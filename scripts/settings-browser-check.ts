import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {gateway} from '../server/gateway';
import {workspace} from '../server/workspace';
import {SecretStore} from '../server/secrets';
import {SecretNames} from '../app/src/secrets';

const token = randomBytes(32).toString('hex');
const directory = await mkdtemp(join(tmpdir(), 'birbforge-settings-'));
const config = {url: 'http://127.0.0.1:1', tokens: {owner: token, stranger: randomBytes(32).toString('hex')}};
const server = gateway(config, resolve(process.argv[2] ?? 'dist'), workspace(config, {directory}));
await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
const address = server.address();
assert.ok(address && typeof address === 'object');
const endpoint = 'http://127.0.0.1:' + address.port;
try {
  const browser = await chromium.launch({executablePath: process.env.BIRBFORGE_CHROMIUM});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}, colorScheme: 'light'});
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    const sessionResponses: number[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url() === endpoint + '/api/session') sessionResponses.push(response.status());
    });
    const button = (name: string) => page.getByRole('button', {name, exact: true});
    const openSettings = async () => {
      if (!(await page.getByRole('heading', {name: 'Appearance', exact: true}).isVisible())) {
        await page.getByLabel('Settings', {exact: true}).first().click();
      }
      await page.getByRole('heading', {name: 'Machines', exact: true}).waitFor();
    };
    await page.goto(endpoint);
    await openSettings();
    await page.getByLabel('Machine name', {exact: true}).fill('Test gateway');
    await page.getByLabel('Server URL', {exact: true}).fill(endpoint);
    const credential = page.getByLabel('Owner credential', {exact: true});
    await credential.fill('rejected');
    await button('Connect machine').click();
    await page.getByText('The gateway rejected this owner credential.').waitFor();
    await credential.fill(token);
    await button('Connect machine').click();
    await button('Edit connection').waitFor();
    assert.deepEqual(sessionResponses, [401, 200]);

    const secretName = 'MODEL_CREDENTIAL';
    const secretValue = randomBytes(32).toString('hex');
    const replacement = randomBytes(32).toString('hex');
    const secrets = new SecretStore(directory);
    const secretInput = page.getByLabel('Secret value', {exact: true});
    await button('Add secret').click();
    await page.getByLabel('Secret name', {exact: true}).fill(secretName);
    await secretInput.fill(secretValue);
    await button('Save secret').click();
    await button('Replace ' + secretName).click();
    assert.equal(await secretInput.inputValue(), '');
    assert.equal(await secrets.get(secretName) === secretValue, true);
    await secretInput.fill(replacement);
    await button('Replace value').click();
    await button('Remove ' + secretName).click();
    assert.equal(await secrets.get(secretName) === replacement, true);
    const read = await fetch(endpoint + '/api/secrets', {headers: {Authorization: 'Bearer ' + token}});
    const index = SecretNames.safeParse(await read.json());
    assert.ok(index.success && index.data.names.length === 1 && index.data.names[0] === secretName);
    const denied = await fetch(endpoint + '/api/secrets', {headers: {Authorization: 'Bearer ' + config.tokens.stranger}});
    assert.equal(denied.status, 403);
    assert.equal(await page.evaluate(values => {
      const stored = JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + document.body.innerText;
      return values.some(value => stored.includes(value));
    }, [secretValue, replacement]), false);
    await button('Confirm removal').click();
    await page.getByText('No secrets saved.').waitFor();
    assert.equal(await secrets.get(secretName), null);

    const machines = page.getByRole('heading', {name: 'Machines', exact: true});
    const before = await machines.evaluate(node => getComputedStyle(node).color);
    await button('Dark').click();
    await page.waitForFunction(previous => {
      const node = [...document.querySelectorAll('[role="heading"]')].find(item => item.textContent === 'Machines');
      return node && getComputedStyle(node).color !== previous;
    }, before);
    const font = await machines.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    await button('Large text').click();
    await page.waitForFunction(previous => {
      const node = [...document.querySelectorAll('[role="heading"]')].find(item => item.textContent === 'Machines');
      return node && parseFloat(getComputedStyle(node).fontSize) > previous;
    }, font);
    assert.equal(await page.evaluate(value => JSON.stringify(localStorage).includes(value) || JSON.stringify(sessionStorage).includes(value), token), false);
    await button('Edit connection').click();
    assert.equal(await credential.inputValue(), '');
    await button('Cancel').click();
    await button('Disconnect machine').click();
    await button('Manage machine').waitFor();

    await page.reload();
    await openSettings();
    await button('Manage machine').waitFor();
    assert.notEqual(await machines.evaluate(node => getComputedStyle(node).color), before);
    assert.ok(await machines.evaluate(node => parseFloat(getComputedStyle(node).fontSize)) > font);
    assert.equal(await button('Disconnect machine').count(), 0);
    await button('Manage machine').click();
    assert.equal(await credential.inputValue(), '');
    await page.getByLabel('Machine name', {exact: true}).fill('Renamed gateway');
    await button('Save machine').click();
    await page.getByText('Renamed gateway', {exact: true}).waitFor();

    await button('Add machine').click();
    await page.getByLabel('Machine name', {exact: true}).fill('Another gateway');
    await page.getByLabel('Server URL', {exact: true}).fill('https://second.example');
    await button('Open machine in browser').waitFor();
    assert.equal(await credential.count(), 0);
    await button('Save machine').click();
    await page.getByText('Another gateway', {exact: true}).waitFor();
    assert.equal(await button('Manage machine').count(), 2);
    await button('Manage machine').last().click();
    await button('Remove machine').click();
    await button('Remove from device').click();
    await page.getByText('Another gateway', {exact: true}).waitFor({state: 'hidden'});
    await page.reload();
    await openSettings();
    assert.equal(await button('Manage machine').count(), 1);
    await page.getByText('Renamed gateway', {exact: true}).waitFor();
    assert.deepEqual(errors, []);
    console.log('Settings passed on a 390px viewport: credential checks, profile lifecycle, theme, text size, secret isolation and reload.');
  } finally {await browser.close();}
} finally {
  server.closeAllConnections();
  await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
  await rm(directory, {recursive: true, force: true});
}
