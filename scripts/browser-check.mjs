import {chromium} from '@playwright/test';
import {readFileSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const session = JSON.parse(readFileSync('.local/session.json', 'utf8'));
const executablePath = process.env.BIRBFORGE_CHROMIUM;
if (!executablePath) throw new Error('Set BIRBFORGE_CHROMIUM to an existing authorized Chromium binary');
const browser = await chromium.launch({executablePath, headless: true});
const context = await browser.newContext({viewport: {width: 1280, height: 1000}});
const errors = [];
const transitions = [];
try {
  const a = await context.newPage();
  const b = await context.newPage();
  let observations = 0;
  let inputRequests = 0;
  a.on('request', request => {
    if (request.url().endsWith('/events')) observations++;
    if (request.method() === 'POST' && request.url().endsWith('/inputs')) inputRequests++;
  });
  for (const page of [a,b]) page.on('pageerror', error => errors.push(error.message));
  await a.goto(session.url);
  await a.getByRole('textbox', {name:'Owner test credential', exact:true}).fill(session.tokens.owner);
  const createIds = [];
  await a.route('**/api/conversations', async route => {
    createIds.push(route.request().postDataJSON().id);
    if (createIds.length === 1) { const response = await route.fetch(); assert.ok(response.ok(), 'Producer accepted the create before acknowledgement loss'); await route.abort('failed'); }
    else await route.continue();
  });
  await a.getByRole('button', {name:'New conversation', exact:true}).click();
  await a.getByRole('button', {name:'Retry new conversation', exact:true}).click();
  await a.getByText('Conversation identity', {exact:true}).waitFor();
  const identity = await a.getByTestId('conversation-id').textContent();
  assert.match(identity, /^[0-9a-f-]{36}$/);
  assert.deepEqual(createIds, [identity, identity]);
  transitions.push('lost create acknowledgement retried with the same conversation identity');
  await a.getByRole('textbox', {name:'Goal', exact:true}).fill('Add a regression test for reconnect in the disposable fixture.');
  await a.getByRole('button', {name:'Send goal', exact:true}).click();
  await a.getByRole('button', {name:'Inspect fixture', exact:true}).waitFor({timeout:60000});
  transitions.push('browser A submitted goal and received durable input');
  await b.goto(session.url);
  await b.getByRole('textbox', {name:'Owner test credential', exact:true}).fill(session.tokens.owner);
  await b.getByRole('textbox', {name:'Conversation identity', exact:true}).fill(identity);
  await b.getByRole('button', {name:'Continue conversation', exact:true}).click();
  await b.getByRole('button', {name:'Inspect fixture', exact:true}).waitFor();
  await b.getByRole('button', {name:'Inbox (1)', exact:true}).click();
  await b.getByRole('button', {name:'Large text', exact:true}).click();
  let tabs = 0;
  const decisionButton = b.getByRole('button', {name:'Test fixture', exact:true});
  while (!(await decisionButton.evaluate(element => element === document.activeElement)) && tabs < 30) {
    await b.keyboard.press('Tab'); tabs++;
  }
  assert.ok(tabs > 0 && tabs < 30, 'Decision must be reachable through real Tab traversal');
  assert.equal(await decisionButton.evaluate(element => getComputedStyle(element).outlineWidth), '3px');
  await b.screenshot({path:'.local/browser-keyboard-focus.png', fullPage:true});
  await b.keyboard.press('Enter');
  await b.getByText('Decision recorded · test', {exact:true}).waitFor({timeout:60000});
  await a.getByText('Decision recorded · test', {exact:true}).waitFor({timeout:60000});
  transitions.push('keyboard activation in browser B inbox resolved browser A conversation');
  await b.getByRole('button', {name:'Conversation', exact:true}).click();
  await b.getByText('Decision recorded · test', {exact:true}).waitFor();
  const beforeExplicitReconnect = observations;
  await a.getByRole('button', {name:'Disconnect', exact:true}).click();
  await a.getByRole('button', {name:'Reconnect', exact:true}).click();
  await a.getByText('Decision recorded · test', {exact:true}).waitFor();
  await a.waitForFunction(() => document.querySelector('[data-testid="connection"]')?.textContent?.startsWith('connected'));
  assert.ok(observations > beforeExplicitReconnect);
  transitions.push('explicit observation disconnect and reconnect retained resolution');
  const beforeNetworkLoss = observations;
  await context.setOffline(true);
  await a.getByTestId('connection').filter({hasText:/^(offline|connecting)/}).waitFor({timeout:15000});
  await context.setOffline(false);
  await a.getByTestId('connection').filter({hasText: /^connected/}).waitFor({timeout:30000});
  assert.ok(observations > beforeNetworkLoss, 'Automatic recovery must open a new AG-UI observation');
  const authoritative = await fetch(`${session.url}/api/conversations/${identity}`, {headers:{Authorization:`Bearer ${session.tokens.owner}`}}).then(response => response.json());
  assert.equal(inputRequests, 1, 'Reconnect must not send even a deduplicated prompt');
  assert.equal(authoritative.inputs.length, 1);
  assert.equal(authoritative.decisions.length, 1);
  transitions.push('network loss and automatic reconnect preserved one input without prompt resubmission');
  await b.screenshot({path: '.local/browser-large-text.png', fullPage:true});
  assert.deepEqual(errors, []);
  writeFileSync('docs/evidence/browser-checks.json', JSON.stringify({
    target:'Linux ARM64 headless Chromium, not a Mac browser or native phone',
    browserVersion: browser.version(), inputPostRequests: inputRequests, keyboardTabsToDecision: tabs, observationsBeforeNetworkLoss: beforeNetworkLoss, observationsAfterNetworkRecovery: observations, checkedAt: new Date().toISOString(), nodeVersion: process.version, viewport: {width:1280,height:1000},
    nativePhone:'NOT VERIFIED', macBrowser:'NOT VERIFIED',
    conversationId:identity, transitions, pageErrors:errors,
    screenshot:'Private .local/browser-large-text.png; transition assertions are the acceptance evidence',
  }, null, 2) + '\n');
} finally { await browser.close(); }
