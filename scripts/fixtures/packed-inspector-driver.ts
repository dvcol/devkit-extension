/** Real browser assertions run from the isolated consumer, after both strict declaration modes pass. */
export const packedInspectorDriver = `
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { buildBrowser, createHost } from './packed-hosts.js';

type InspectorHost = Awaited<ReturnType<typeof createHost>>;

async function connect(page: Page, host: InspectorHost, renderer: string): Promise<void> {
  await page.goto(host.origin + '/?host=' + host.mode + '&renderer=' + renderer);
  await page.locator('#token').fill(host.token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('#connection')).toHaveText('Connected');
  await expect(page.locator('#inspector button')).toHaveCount(5);
  await expect(page.locator('#inspector [data-renderer="custom"]')).toHaveCount(renderer === 'custom' ? 1 : 0);
  const provider: unknown = JSON.parse(await page.locator('#provider').innerText());
  assert.partialDeepStrictEqual(provider, { id: 'example.' + host.mode + '-inspector', realm: { id: 'devserver' } });
}

async function action(page: Page, name: string, outcome: string): Promise<void> {
  await page.locator('#inspector').getByRole('button', { name, exact: true }).click();
  await expect(page.locator('#inspector').getByText(outcome, { exact: true })).toBeVisible();
}

async function snapshot(page: Page) {
  return {
    target: await page.getByText(/^Target:/u).innerText(),
    body: await page.getByText(/^Response body:/u).innerText(),
    configuration: await page.getByText(/^Modification enabled:/u).innerText(),
    marker: await page.getByText(/^Marker installed:/u).innerText(),
    firstScript: await page.locator('html').getAttribute('data-first-script'),
  };
}

async function checkRenderer(page: Page, peer: Page, host: InspectorHost, renderer: string) {
  await action(page, 'Inspect response', 'Inspection dispatch complete');
  await expect(page.locator('#inspector')).toContainText('Response body: fixture:original');
  await expect(peer.locator('#inspector')).toContainText('Response body: fixture:original');
  await expect(page.locator('#inspector')).toContainText('Target: ' + host.origin + '/inspector-response');
  await expect(page.locator('#inspector')).toContainText('Response status: 200');
  const original = await snapshot(page);
  assert.deepEqual(JSON.parse(original.firstScript!), { marker: null, readyState: 'loading' });
  await action(page, 'Enable response modification', 'Configuration dispatch complete');
  await expect(peer.locator('#inspector')).toContainText('Modification enabled: true');
  await action(page, 'Inspect response', 'Inspection dispatch complete');
  await expect(peer.locator('#inspector')).toContainText('Response body: native:fixture:original');
  await expect(page.locator('#inspector')).toContainText('Response body: native:fixture:original');
  assert.equal(await fetch(host.origin + '/inspector-response').then((response) => response.text()), 'native:fixture:original');
  const modified = await snapshot(page);
  await action(page, 'Disable response modification', 'Configuration dispatch complete');
  await expect(peer.locator('#inspector')).toContainText('Modification enabled: false');
  await action(page, 'Enable response modification', 'Configuration dispatch complete');
  await expect(peer.locator('#inspector')).toContainText('Modification enabled: true');
  await action(page, 'Install page marker', 'Marker dispatch complete');
  await expect(peer.locator('#inspector')).toContainText('Marker installed: true');
  assert.equal((await snapshot(page)).firstScript, original.firstScript);
  await page.goto('about:blank');
  await connect(page, host, renderer);
  const marked = await snapshot(page);
  assert.deepEqual(JSON.parse(marked.firstScript!), { marker: 'loading', readyState: 'loading' });
  await action(page, 'Reset inspector', 'Reset dispatch complete');
  await expect(peer.locator('#inspector')).toContainText('Response body: No response inspected');
  await expect(peer.locator('#inspector')).toContainText('Modification enabled: false');
  await expect(peer.locator('#inspector')).toContainText('Marker installed: false');
  assert.equal((await snapshot(page)).firstScript, marked.firstScript);
  await page.goto('about:blank');
  await connect(page, host, renderer);
  const reset = await snapshot(page);
  assert.deepEqual(JSON.parse(reset.firstScript!), { marker: null, readyState: 'loading' });
  assert.equal(reset.body, 'Response body: No response inspected');
  assert.equal(await fetch(host.origin + '/inspector-response').then((response) => response.text()), 'fixture:original');
  return { renderer, original, modified, marked, reset };
}

async function checkDisposal(page: Page, peer: Page): Promise<void> {
  const button = await page.getByRole('button', { name: 'Enable response modification', exact: true }).elementHandle();
  assert.ok(button !== null);
  try {
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.locator('#connection')).toHaveText('Disconnected');
    await expect(page.locator('#inspector button')).toHaveCount(0);
    assert.equal(await button.evaluate((element) => element.isConnected), false);
    await button.evaluate((element) => {
      if (!(element instanceof HTMLButtonElement)) throw new Error('Expected an inspector button');
      element.click();
    });
    await action(peer, 'Inspect response', 'Inspection dispatch complete');
    await expect(peer.locator('#inspector')).toContainText('Modification enabled: false');
    await expect(peer.locator('#inspector')).toContainText('Response body: fixture:original');
  } finally {
    await button.dispose();
  }
}

export async function runPackedBrowser(directory: string) {
  await using cleanup = new AsyncDisposableStack();
  await buildBrowser(directory);
  const hosts = [];
  for (const mode of ['devframe', 'devtools'] as const) {
    const host = await createHost(mode, directory);
    hosts.push(host);
    cleanup.defer(host.close);
  }
  const browser = await chromium.launch({ headless: true });
  cleanup.defer(() => browser.close());
  const version = browser.version();
  const context = await browser.newContext();
  const pageErrors: string[] = [];
  const sockets = new Set<string>();
  context.on('weberror', (error) => pageErrors.push(error.error().message));
  const observations = [];
  for (const host of hosts) {
    const reference = await context.newPage();
    const custom = await context.newPage();
    for (const page of [reference, custom]) page.on('websocket', (socket) => {
      const url = new URL(socket.url());
      sockets.add(url.origin + url.pathname);
    });
    await connect(reference, host, 'reference');
    await connect(custom, host, 'custom');
    observations.push({ host: host.mode, origin: host.origin, renderers: [
      await checkRenderer(custom, reference, host, 'custom'),
      await checkRenderer(reference, custom, host, 'reference'),
    ] });
    await checkDisposal(custom, reference);
    await reference.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(reference.locator('#inspector button')).toHaveCount(0);
    await reference.close();
    await custom.close();
  }
  for (const host of hosts)
    assert.ok(sockets.has(host.origin.replace('http:', 'ws:') + '/__packed/__ws'));
  await cleanup.disposeAsync();
  assert.deepEqual(pageErrors, []);
  const checks = [
    'both packed renderers consume the unchanged inspector publication through native authenticated WebSockets',
    'both renderers invoke all four actions and share actual HTTP response, configuration and marker projections',
    'owned HTTP response bytes change on enable and return to the original value on reset',
    'the native HTML marker precedes the first parser script only in new documents while enabled',
    'reset clears the result and future marker without rolling back an existing document',
    'renderer disposal removes controls and a retained detached custom control cannot alter the provider',
  ];
  return {
    browser: version, observations, sockets: [...sockets], pageErrors,
    checks: hosts.flatMap(({ mode }) => checks.map((check) => mode + ': ' + check)),
    cleanup: { browserClosed: true, providersDisposed: true, hubsClosed: true, serversClosed: true },
    limitations: [
      'Chromium and native development hosts only; packed extension installation and Firefox are not exercised',
      'The private native contexts use public initHub on owned Vite servers rather than the Vite integration plugins',
      'The owned endpoint generates fixture responses; it does not intercept arbitrary third-party HTTP output',
    ],
  };
}
`;
