import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { increaseCounterAction } from '@devkit/example-contribution';
import { createRemoteHost } from '@devkit/example-server-contexts';
import { chromium, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { publishCounterView } from './json-view-fixture.ts';

type ServerHost = Awaited<ReturnType<typeof createRemoteHost>>;
const profile = await mkdtemp(join(tmpdir(), 'devkit-json-views-'));
const extensionPath = resolve('dist/chromium');
const browser = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
const errors: string[] = [];
browser.on('weberror', (error) => errors.push(error.error().message));
try {
  await using cleanup = new AsyncDisposableStack();
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  const page = await browser.newPage();
  await page.goto(`${origin}/panel.html`);
  await expect(page.locator('#status')).toHaveText('Connected');
  const devframe = await createRemoteHost('devframe', {
    providerId: 'example.devframe',
    allowedOrigins: [origin],
  });
  cleanup.defer(devframe.close);
  const devtools = await createRemoteHost('devtools', {
    providerId: 'example.devtools',
    allowedOrigins: [origin],
  });
  cleanup.defer(devtools.close);
  const first = await publishCounterView(devframe);
  cleanup.defer(first.dispose);
  await connect(page, devframe);
  const firstGroup = page.locator('[data-provider="example.devframe"]');
  const secondGroup = page.locator('[data-provider="example.devtools"]');
  await expect(firstGroup.getByText('Remote: 0', { exact: true })).toBeVisible();
  await connect(page, devtools);
  await expect(secondGroup.locator('[data-view]')).toHaveCount(0);
  const second = await publishCounterView(devtools);
  cleanup.defer(second.dispose);
  assert.equal(first.view.ref.stateKey, second.view.ref.stateKey);
  await expect(secondGroup.getByText('Remote: 0', { exact: true })).toBeVisible();
  await firstGroup.getByRole('button', { name: 'Increase published counter' }).click();
  await expect(firstGroup.getByText('Remote: 1', { exact: true })).toBeVisible();
  await expect(secondGroup.getByText('Remote: 0', { exact: true })).toBeVisible();
  await expect(page.locator('#renderer').getByText('Counter: 0', { exact: true })).toBeVisible();
  await devtools.provider.invoke({ action: increaseCounterAction, input: { amount: 5 } });
  await expect(secondGroup.getByText('Remote: 5', { exact: true })).toBeVisible();
  await expect(firstGroup.getByText('Remote: 1', { exact: true })).toBeVisible();
  const removedButton = await firstGroup
    .getByRole('button', { name: 'Increase published counter' })
    .elementHandle();
  first.dispose();
  await expect(firstGroup.locator('[data-view]')).toHaveCount(0);
  await removedButton.evaluate((element) =>
    element.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  const replacement = await publishCounterView(devframe);
  cleanup.defer(replacement.dispose);
  await expect(firstGroup.getByText('Remote: 1', { exact: true })).toBeVisible();
  await expect(firstGroup.locator('[data-view]')).toHaveCount(1);
  await firstGroup.getByRole('button', { name: 'Increase published counter' }).click();
  await expect(firstGroup.getByText('Remote: 2', { exact: true })).toBeVisible();
  await devframe.close();
  await expect(firstGroup).toHaveCount(0);
  await secondGroup.getByRole('button', { name: 'Increase published counter' }).click();
  await expect(secondGroup.getByText('Remote: 6', { exact: true })).toBeVisible();
  await page
    .locator('#renderer')
    .getByRole('button', { name: 'Increase counter', exact: true })
    .click();
  await expect(page.locator('#renderer').getByText('Counter: 1', { exact: true })).toBeVisible();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/json-views.png', fullPage: true });
  const disconnectedButton = await secondGroup
    .getByRole('button', { name: 'Increase published counter' })
    .elementHandle();
  await page.locator('#disconnect').click();
  await expect(page.locator('#server-views')).toBeEmpty();
  await disconnectedButton.evaluate((element) =>
    element.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Connected');
  await connect(page, devtools);
  await expect(secondGroup.getByText('Remote: 6', { exact: true })).toBeVisible();
  await expect(secondGroup.locator('[data-view]')).toHaveCount(1);
  await secondGroup.getByRole('button', { name: 'Increase published counter' }).click();
  await expect(secondGroup.getByText('Remote: 7', { exact: true })).toBeVisible();
  await expect(page.locator('#renderer').getByText('Counter: 1', { exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  const receipt = {
    browser: browser.browser()?.version(),
    checks: [
      'native view index discovers an existing view on connection',
      'empty native view index keeps its provider connected',
      'late publication mounts without reconnecting',
      'identical view IDs and state keys stay separate across native hosts',
      'rendered portable actions route to the publishing provider',
      'backend state updates affect only that provider view',
      'removed view unmounts; retained button cannot dispatch',
      'republishing the same view key creates one working mount',
      'server disconnect removes only its views; other server and extension stay usable',
      'page disconnect removes all server views and their handlers',
      'fresh connection reads current native state without replay or duplicate actions',
    ],
    finalCounters: { devframe: 2, devtools: 7, extension: 1 },
    pageErrors: errors,
    limitations: [
      'This receipt covers Chromium; Firefox has separate native view lifecycle checks',
    ],
  };
  await writeFile('artifacts/json-views.json', JSON.stringify(receipt, null, 2));
  console.info(styleText('green', '✅ [json-views]'), receipt);
} finally {
  await browser.close();
  await rm(profile, { recursive: true, force: true });
}

async function connect(page: Page, host: ServerHost): Promise<void> {
  await page.locator('#server-url').fill(`${host.origin}/__devkit-remote/`);
  await page.locator('#server-id').fill(host.provider.provider.id);
  await page.locator('#server-token').fill(host.token);
  await page.getByRole('button', { name: 'Connect server', exact: true }).click();
  await expect(page.locator('#server-result')).toHaveText(
    `"Connected ${host.provider.provider.id}"`,
  );
}
