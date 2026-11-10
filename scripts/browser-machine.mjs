export async function connectMachine(page, endpoint, token) {
  await page.goto(endpoint);
  await page.getByRole('tab', {name: 'Settings', exact: true}).click();
  await page.getByRole('heading', {name: 'Machines', exact: true}).waitFor();
  const manage = page.getByRole('button', {name: 'Manage machine', exact: true});
  if (await manage.count()) await manage.first().click();
  await page.getByRole('textbox', {name: 'Server URL', exact: true}).fill(endpoint);
  await page.getByRole('textbox', {name: 'Owner credential', exact: true}).fill(token);
  await page.getByRole('button', {name: 'Connect machine', exact: true}).click();
  await page.getByRole('button', {name: 'Edit connection', exact: true}).waitFor();
}
