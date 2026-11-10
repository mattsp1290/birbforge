import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function checkCatalog(page) {
  const button = (name, scope = page) => scope.getByRole('button', {name, exact: true});
  const field = name => page.getByRole('textbox', {name, exact: true});
  const card = heading => page.getByRole('heading', {name: heading, exact: true}).locator('..');
  const navigate = name => page.getByRole('tab', {name, exact: true}).or(button(name)).click();
  const suffix = randomUUID().slice(0, 8);
  const agentName = 'Navigation engineer ' + suffix;
  const flight = 'flight-' + suffix;
  const ground = 'ground-' + suffix;

  async function createProject(id) {
    await button('New project').click();
    await field('Project name').fill(id);
    await button('Create project').click();
    await card(id).waitFor();
  }

  await navigate('Projects');
  await createProject(flight);
  await field('GitHub repository').fill('birbforge-fixture/engine');
  await button('Link repository').click();
  await card(flight).getByText('birbforge-fixture/engine', {exact: true}).waitFor();
  await button('Add repository', card(flight)).click();
  await field('GitHub repository').fill('https://github.com/birbforge-fixture/mobile.git');
  await button('Link repository').click();
  await card(flight).getByText('birbforge-fixture/mobile', {exact: true}).waitFor();
  await createProject(ground);
  await navigate('Crew');

  await button('New agent').click();
  const firstName = 'Navigator ' + suffix;
  await field('Agent name').fill(firstName);
  await field('Instructions').fill('Review navigation changes in the assigned projects.');
  await button(flight).click();
  await button(ground).click();
  await button('Save agent').click();
  await card(firstName).getByText('Projects · ' + flight + ', ' + ground, {exact: true}).waitFor();

  await button('Edit agent', card(firstName)).click();
  await field('Agent name').fill(agentName);
  await button(ground).click();
  await button('Save agent').click();
  await card(agentName).getByText('Projects · ' + flight, {exact: true}).waitFor();
  await navigate('Projects');
  await card(flight).getByText('birbforge-fixture/mobile', {exact: true}).waitFor();
  await navigate('Crew');
  await card(agentName).getByText('Projects · ' + flight, {exact: true}).waitFor();

  await button('New agent').click();
  const temporary = 'Temporary agent ' + suffix;
  await field('Agent name').fill(temporary);
  await button('Save agent').click();
  await button('Delete agent', card(temporary)).click();
  await button('Confirm deletion', card(temporary)).click();
  await card(temporary).waitFor({state: 'detached'});
  assert.equal(await card(agentName).count(), 1);
  return {agentName, project: flight};
}
