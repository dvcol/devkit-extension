import assert from 'node:assert/strict';
import { createRemoteHost } from '@devkit/example-server-contexts';
import { counterCapability } from '@devkit/example-contribution';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

type ServerHost = Awaited<ReturnType<typeof createRemoteHost>>;

export async function checkConfiguredServers(page: Page, peer: Page): Promise<void> {
  await using cleanup = new AsyncDisposableStack();
  const allowedOrigins = [await page.evaluate(() => location.origin)];
  await checkDeniedOrigin(page);
  const devframe = await createRemoteHost('devframe', {
    providerId: 'example.devframe',
    allowedOrigins,
  });
  cleanup.defer(devframe.close);
  const devtools = await createRemoteHost('devtools', {
    providerId: 'example.devtools',
    allowedOrigins,
  });
  cleanup.defer(devtools.close);
  await fillConnection(page, devframe, 'invalid-token');
  await expect(page.locator('#server-result')).toContainText(/authoriz|trust|credentials/iu);
  await expect(page.locator('#providers')).not.toContainText('example.devframe');
  assert.equal(await readCounter(devframe), 0);
  await fillConnection(page, devframe, devframe.token);
  await expect(page.locator('#server-result')).toHaveText('"Connected example.devframe"');
  await fillConnection(page, devtools, devtools.token);
  await expect(page.locator('#server-result')).toHaveText('"Connected example.devtools"');
  await checkBroadcast(page, peer, devframe, devtools);
  await page.locator('#preferred-server').fill('example.devframe');
  await page.getByRole('button', { name: 'Increase with extension fallback' }).click();
  await expect(page.locator('#server-result')).toHaveText('3');
  assert.equal(await readCounter(devframe), 3);
  assert.equal(await readCounter(devtools), 2);
  await devframe.close();
  await expect(page.locator('#providers')).toContainText('"status":"unknown"');
  await page.getByRole('button', { name: 'Increase with extension fallback' }).click();
  await expect(page.locator('#server-result')).toHaveText('16');
  await expect(peer.getByText('Counter: 16', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Increase dev servers', exact: true }).click();
  await expect(page.locator('#server-result')).toContainText('rejected');
  await expect(page.locator('#server-result')).toContainText('fulfilled');
  assert.equal(await readCounter(devtools), 3);
}

async function checkDeniedOrigin(page: Page): Promise<void> {
  await using cleanup = new AsyncDisposableStack();
  const denied = await createRemoteHost('devframe');
  cleanup.defer(denied.close);
  await fillConnection(page, denied, denied.token);
  /** Browsers expose a rejected native WebSocket handshake as an opaque error. */
  await expect(page.locator('#server-result')).toHaveText('error');
  await expect(page.locator('#providers')).not.toContainText('example.remote');
  assert.equal(await readCounter(denied), 0);
}

async function checkBroadcast(
  page: Page,
  peer: Page,
  devframe: ServerHost,
  devtools: ServerHost,
): Promise<void> {
  await page.getByRole('button', { name: 'Increase dev servers', exact: true }).click();
  await expect(page.locator('#server-result')).toContainText('fulfilled');
  assert.equal(await readCounter(devframe), 1);
  assert.equal(await readCounter(devtools), 1);
  await expect(peer.getByText('Counter: 14', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Increase all realms', exact: true }).click();
  await expect(page.locator('#server-result')).toContainText('fulfilled');
  await expect(peer.getByText('Counter: 15', { exact: true })).toBeVisible();
  assert.equal(await readCounter(devframe), 2);
  assert.equal(await readCounter(devtools), 2);
}

async function fillConnection(page: Page, host: ServerHost, token: string): Promise<void> {
  await page.locator('#server-url').fill(`${host.origin}/__devkit-remote/`);
  await page.locator('#server-id').fill(host.provider.provider.id);
  await page.locator('#server-token').fill(token);
  await page.getByRole('button', { name: 'Connect server', exact: true }).click();
  await expect(page.locator('#server-token')).toHaveValue('');
}

async function readCounter(host: ServerHost): Promise<number> {
  const resolution = await host.provider.resolve({ capability: counterCapability });
  if (resolution.status !== 'available') throw new Error('Server counter is unavailable');
  return resolution.binding.api.read({});
}
