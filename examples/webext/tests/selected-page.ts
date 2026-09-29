import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRemoteHost } from '@devkit/example-server-contexts';
import { counterCapability } from '@devkit/example-contribution';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createServer } from 'vite';

export async function checkSelectedPage(extension: Page): Promise<void> {
  await using cleanup = new AsyncDisposableStack();
  const host = await createRemoteHost('devframe', {
    providerId: 'example.page',
    allowedOrigins: [await extension.evaluate(() => location.origin)],
  });
  cleanup.defer(host.close);
  const publisher = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('./publisher/', import.meta.url)),
    define: { PUBLISHER_AUTH_TOKEN: JSON.stringify(host.token) },
    server: {
      host: '127.0.0.1',
      port: 0,
      proxy: { '/__devkit-remote/': { target: host.origin, ws: true } },
    },
  });
  cleanup.defer(() => publisher.close());
  await publisher.listen();
  const url = publisher.resolvedUrls?.local[0];
  assert.notEqual(url, undefined);
  if (url === undefined) throw new Error('Missing publisher URL');
  const source = await extension.context().newPage();
  cleanup.defer(() => source.close());
  await checkMissingConnection(extension, source, url);
  await source.goto(url);
  await expect(source.locator('#status')).toHaveText('Ready');
  await selectPage(extension, url);
  await extension.locator('#server-id').fill('example.page');
  await extension.getByRole('button', { name: 'Connect selected page', exact: true }).click();
  await expect(extension.locator('#server-result')).toHaveText('"Connected example.page"');
  await extension.locator('#preferred-server').fill('example.page');
  await extension.getByRole('button', { name: 'Increase with extension fallback' }).click();
  await expect(extension.locator('#server-result')).toHaveText('1');
  await source.close();
  await extension.getByRole('button', { name: 'Connect selected page', exact: true }).click();
  await expect(extension.locator('#page-result')).toContainText(/No tab with id/iu);
  await extension.getByRole('button', { name: 'Increase with extension fallback' }).click();
  await expect(extension.locator('#server-result')).toHaveText('2');
  const resolution = await host.provider.resolve({ capability: counterCapability });
  if (resolution.status !== 'available') throw new Error('Page provider counter is unavailable');
  assert.equal(await resolution.binding.api.read({}), 2);
  await checkDeniedPage(extension);
}

async function selectPage(extension: Page, url: string): Promise<void> {
  await extension.getByRole('button', { name: 'Refresh local pages', exact: true }).click();
  await expect(extension.locator('#local-pages option', { hasText: url })).toHaveCount(1);
  await extension.locator('#local-pages').selectOption({ label: url });
}

async function checkMissingConnection(extension: Page, source: Page, url: string): Promise<void> {
  for (const mode of ['absent', 'malformed']) {
    const selectedUrl = `${url}?mode=${mode}`;
    await source.goto(selectedUrl);
    await expect(source.locator('#status')).toHaveText('Ready');
    await selectPage(extension, selectedUrl);
    await extension.getByRole('button', { name: 'Connect selected page', exact: true }).click();
    await expect(extension.locator('#page-result')).toContainText(/no published|malformed/iu);
    await expect(extension.locator('#providers')).not.toContainText('example.page');
  }
}

async function checkDeniedPage(extension: Page): Promise<void> {
  const tabId = await extension.evaluate(async () => {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    if (tab.id === undefined) throw new Error('Missing denied tab ID');
    document
      .querySelector<HTMLSelectElement>('#local-pages')!
      .add(new Option('Denied page', String(tab.id)));
    return tab.id;
  });
  try {
    await extension.locator('#local-pages').selectOption(String(tabId));
    await extension.getByRole('button', { name: 'Connect selected page', exact: true }).click();
    await expect(extension.locator('#page-result')).toContainText(/Cannot access|permission/iu);
  } finally {
    await extension.evaluate((id) => chrome.tabs.remove(id), tabId);
  }
}
