import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { counterCapability } from '@devkit/example-contribution';
import { createRemoteHost } from '@devkit/example-server-contexts';
import { chromium, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

type ServerHost = Awaited<ReturnType<typeof createRemoteHost>>;
const profile = await mkdtemp(join(tmpdir(), 'devkit-json-actions-'));
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
  await page.locator('#json-selection').selectOption('servers');
  await page.getByRole('button', { name: 'Increase matching domain', exact: true }).click();
  await expect(page.locator('#json-result')).toContainText('Broadcast was not dispatched');
  await expect(page.getByRole('alert')).toContainText('Broadcast was not dispatched');
  await expect(
    page.getByText('Dispatch failed. See action results.', { exact: true }),
  ).toBeVisible();
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
  await connect(page, devframe);
  await connect(page, devtools);
  await checkSelection(page, devframe, devtools);
  await checkFailures(page, devframe, devtools);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/json-actions.png', fullPage: true });
  const retained = await page
    .getByRole('button', { name: 'Increase matching domain', exact: true })
    .elementHandle();
  await page.locator('#disconnect').click();
  await expect(page.locator('#status')).toHaveText('Disconnected');
  await expect(
    page.getByRole('button', { name: 'Increase matching domain', exact: true }),
  ).toHaveCount(0);
  await retained.evaluate((element) =>
    element.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  await expect.poll(() => readCounter(devtools)).toBe(4);
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Connected');
  await expect(page.getByText('Counter: 3', { exact: true })).toBeVisible();
  await expect(page.locator('#json-result')).toHaveText('');
  assert.equal(await readCounter(devtools), 4);
  assert.deepEqual(errors, []);
  await mkdir('artifacts', { recursive: true });
  const receipt = {
    browser: browser.browser()?.version(),
    checks: [
      'unchanged native JSON renderer dispatches the shared action',
      'outgoing realm and explicit provider selection',
      'two server providers both apply to one domain',
      'provider-owned domain applicability across all three native hosts',
      'ordinary not-applicable result remains fulfilled',
      'unknown domain has no effects',
      'unavailable provider preserves successful siblings',
      'disconnected native server reports failure without rerouting',
      'detached rendered button cannot dispatch after unmount',
      'reconnect retains background state without replay',
      'native input state binding and onSuccess callback',
      'native onError handles unmatched recipients; onSuccess clears the application status',
      'native renderer clears its failed-action alert when the same action is retried successfully',
    ],
    finalCounters: { devframe: 3, devtools: 4, extension: 3 },
    pageErrors: errors,
    limitations: ['Domain applicability matrix currently runs in Chromium'],
  };
  await writeFile('artifacts/json-actions.json', JSON.stringify(receipt, null, 2));
  console.info(styleText('green', '✅ [json-actions]'), receipt);
} finally {
  await browser.close();
  await rm(profile, { recursive: true, force: true });
}

async function checkSelection(
  page: Page,
  devframe: ServerHost,
  devtools: ServerHost,
): Promise<void> {
  await dispatch(page, 'servers', 'shared.example.test');
  await expect(page.locator('#json-result')).toContainText('"value":1');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Dispatch failed. See action results.', { exact: true })).toHaveCount(
    0,
  );
  assert.equal(await readCounter(devframe), 1);
  assert.equal(await readCounter(devtools), 1);
  await expect(page.getByText('Counter: 0', { exact: true })).toBeVisible();
  await dispatch(page, 'all', 'dev.example.test');
  await expect(page.locator('#json-result')).toContainText('not-applicable');
  assert.equal(await readCounter(devframe), 2);
  assert.equal(await readCounter(devtools), 2);
  await expect(page.getByText('Counter: 0', { exact: true })).toBeVisible();
  await dispatch(page, 'extension', 'deployed.example.test');
  await expect(page.getByText('Counter: 1', { exact: true })).toBeVisible();
  await dispatch(page, 'devframe', 'shared.example.test');
  await expect(page.locator('#json-result')).toContainText('"value":3');
  await expect(page.locator('#json-result')).not.toContainText('example.devtools');
  assert.equal(await readCounter(devframe), 3);
  assert.equal(await readCounter(devtools), 2);
  await dispatch(page, 'all', 'unknown.example.test');
  const outcomes: unknown = JSON.parse(await page.locator('#json-result').innerText());
  expect(outcomes).toEqual([
    expect.objectContaining({ status: 'fulfilled', value: { status: 'not-applicable' } }),
    expect.objectContaining({ status: 'fulfilled', value: { status: 'not-applicable' } }),
    expect.objectContaining({ status: 'fulfilled', value: { status: 'not-applicable' } }),
  ]);
  assert.equal(await readCounter(devframe), 3);
  assert.equal(await readCounter(devtools), 2);
  await expect(page.getByText('Counter: 1', { exact: true })).toBeVisible();
}

async function checkFailures(
  page: Page,
  devframe: ServerHost,
  devtools: ServerHost,
): Promise<void> {
  const service = devframe.provider.startup.services[0];
  assert.ok(service);
  await service.disable();
  await dispatch(page, 'all', 'unknown.example.test');
  await expect(page.locator('#json-result')).toContainText('rejected');
  await expect(page.locator('#json-result')).toContainText('not-applicable');
  assert.equal(await readCounter(devtools), 2);
  await expect(page.getByText('Counter: 1', { exact: true })).toBeVisible();
  await service.enable();
  assert.equal(await readCounter(devframe), 3);
  await devframe.close();
  await expect(page.locator('#providers')).toContainText('"status":"unknown"');
  await dispatch(page, 'all', 'shared.example.test');
  await expect(page.locator('#json-result')).toContainText('rejected');
  await expect(page.locator('#json-result')).toContainText('"value":3');
  await expect(page.getByText('Counter: 2', { exact: true })).toBeVisible();
  assert.equal(await readCounter(devtools), 3);
  await dispatch(page, 'all', 'shared.example.test');
  await expect(page.getByText('Counter: 3', { exact: true })).toBeVisible();
  assert.equal(await readCounter(devtools), 4);
}

async function dispatch(page: Page, selection: string, domain: string): Promise<void> {
  await page.locator('#json-selection').selectOption(selection);
  await page.getByRole('textbox', { name: 'Domain', exact: true }).fill(domain);
  await page.getByRole('button', { name: 'Increase matching domain', exact: true }).click();
  await expect(page.locator('#json-result')).toContainText('fulfilled');
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

async function readCounter(host: ServerHost): Promise<number> {
  const resolution = await host.provider.resolve({ capability: counterCapability });
  if (resolution.status !== 'available') throw new Error('Counter unavailable');
  return resolution.binding.api.read({});
}
