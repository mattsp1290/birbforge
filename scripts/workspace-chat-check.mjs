import assert from 'node:assert/strict';

export async function checkChat(page, {agentName, project}) {
  const button = name => page.getByRole('button', {name, exact: true});
  await page.getByRole('tab', {name: 'Chat', exact: true}).or(button('Chat')).click();
  const chief = page.getByRole('button', {name: /Chief of Staff.*Pinned/});
  await chief.click();
  const inspect = button('Inspect factory');
  await page.getByRole('textbox', {name:'Message', exact:true}).waitFor();
  if (await inspect.isVisible()) await inspect.click();
  else {
    await page.getByRole('textbox', {name:'Message', exact:true}).fill('Inspect factory status');
    await button('Send message').click();
  }
  await page.getByText(/Gateway: online\. Birbcrew runtime:/).last().waitFor();
  const mobile = page.viewportSize().width < 840;
  if (mobile) await button('Chats').click();
  await button('New chat').click();
  await button(agentName).click();
  await page.getByRole('heading', {name: agentName, exact: true}).waitFor();

  const requests = [];
  const messages = /\/api\/chats\/[0-9a-f-]+\/messages$/;
  await page.route(messages, async route => {
    requests.push(route.request().postDataJSON().id);
    if (requests.length > 1) return route.continue();
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.abort('failed');
  });
  const text = 'Which projects am I assigned?';
  try {
    await page.getByRole('textbox', {name: 'Message', exact: true}).fill(text);
    await button('Send message').click();
    const acknowledgement = page.waitForResponse(response => messages.test(response.url()) && response.status() === 200);
    await button('Retry message').click();
    const chat = await (await acknowledgement).json();
    assert.equal(chat.turns.filter(turn => turn.id === requests[0] && turn.text === text).length, 1);
    await page.getByText(new RegExp(project)).filter({hasText: 'birbforge-fixture/mobile'}).last().waitFor();
    assert.equal(requests.length, 2);
    assert.equal(requests[0], requests[1]);
    await page.getByText(text, {exact: true}).last().waitFor();
  } finally {await page.unroute(messages);}
  if (mobile) await button('Chats').click();
  await chief.click();
  await page.getByText(/Gateway: online\. Birbcrew runtime:/).last().waitFor();
}
