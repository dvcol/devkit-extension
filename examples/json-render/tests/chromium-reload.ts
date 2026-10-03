import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { styleText } from 'node:util';
import { chromium, expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { createReloadFixture, reloadChecks } from './reload-fixture.ts';

await using cleanup = new AsyncDisposableStack();
const browser = await chromium.launch({ headless: true });
cleanup.defer(() => browser.close());
const observations = [];
for (const mode of ['devframe', 'devtools'] as const)
  observations.push(await checkHost(browser, mode));
const receipt = {
  browser: browser.version(),
  observations,
  checks: observations.flatMap(({ mode }) => reloadChecks.map((check) => `${mode}: ${check}`)),
  pageErrors: observations.flatMap(({ pageErrors }) => pageErrors),
};
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/chromium-reload.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(styleText('green', '✅ [json-render/reload]'), receipt);

async function counter(page: Page, value: number): Promise<void> {
  await expect(page.locator('#view').getByText(`Counter: ${value}`, { exact: true })).toBeVisible();
  await expect(page.locator('#view > div')).toHaveCount(1);
}

async function checkHost(browserInstance: Browser, mode: 'devframe' | 'devtools') {
  await using lifetime = new AsyncDisposableStack();
  const fixture = await createReloadFixture(mode);
  lifetime.defer(fixture.close);
  const provider = { ...fixture.example.host.provider.provider };
  const context = await browserInstance.newContext();
  lifetime.defer(() => context.close());
  const pageErrors: string[] = [];
  context.on('weberror', (error) => pageErrors.push(error.error().message));
  const page = await context.newPage();
  await page.goto(fixture.origin);
  await counter(page, 0);
  await page.locator('#renderer').selectOption('custom');
  const custom = page.locator('[data-renderer="custom"]');
  await expect(custom).toBeVisible();
  await expect(page.locator('h1')).toHaveCSS('color', 'rgb(1, 2, 3)');
  await page.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counter(page, 1);
  const documentBefore = await page.evaluate(() => performance.timeOrigin);
  await checkStyle(page, fixture, documentBefore);
  await fixture.updateRenderer();
  await expect.poll(() => page.evaluate(() => performance.timeOrigin)).not.toBe(documentBefore);
  await counter(page, 2);
  await expect(page.locator('#renderer')).toHaveValue('reference');
  await page.locator('#renderer').selectOption('custom');
  await expect(custom).toHaveAttribute('data-source-version', 'updated');
  await counter(page, 2);
  await expect(page.getByRole('button', { name: 'Increase counter', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counter(page, 3);
  assert.deepEqual(fixture.example.view.value().state, { value: 3 });
  assert.deepEqual(fixture.example.host.provider.provider, provider);
  assert.deepEqual(pageErrors, []);
  return {
    mode,
    documentBefore,
    documentAfter: await page.evaluate(() => performance.timeOrigin),
    cssMountRetained: true,
    providerRetained: true,
    rendererAfterReload: 'reference',
    finalValue: 3,
    pageErrors,
  };
}

async function checkStyle(
  page: Page,
  fixture: Awaited<ReturnType<typeof createReloadFixture>>,
  documentBefore: number,
): Promise<void> {
  const custom = page.locator('[data-renderer="custom"]');
  const mount = await custom.elementHandle();
  assert.ok(mount !== null);
  try {
    await fixture.updateStyle();
    await expect(page.locator('h1')).toHaveCSS('color', 'rgb(4, 5, 6)');
    assert.equal(await page.evaluate(() => performance.timeOrigin), documentBefore);
    assert.equal(await mount.evaluate((element) => element.isConnected), true);
    await counter(page, 1);
    await page.getByRole('button', { name: 'Increase counter', exact: true }).click();
    await counter(page, 2);
  } finally {
    await mount.dispose();
  }
}
