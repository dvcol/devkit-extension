import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { styleText } from 'node:util';

import { chromium, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

import { connectInspector } from './inspector-browser-actions.ts';
import { inspectorRaceServer } from './inspector-race-fixture.ts';

type InspectorServer = Awaited<ReturnType<typeof inspectorRaceServer>>;

async function inspectorSnapshot(page: Page) {
  return {
    provider: JSON.parse(await page.locator('#provider').innerText()) as unknown,
    target: await page.getByText(/^Target:/u).innerText(),
    configuration: await page.getByText(/^Modification enabled:/u).innerText(),
    body: await page.getByText(/^Response body:/u).innerText(),
    marker: await page.getByText(/^Marker installed:/u).innerText(),
  };
}

async function connectedPage(context: BrowserContext, server: InspectorServer) {
  const page = await context.newPage();
  try {
    await connectInspector({ ...server, page });
    return page;
  } catch (error) {
    await page.close();
    throw error;
  }
}

async function abandonPendingInspection(
  sender: Page,
  selected: InspectorServer,
  senderPeers: InspectorServer['peers'],
) {
  await sender.getByRole('button', { name: 'Inspect response', exact: true }).click();
  await expect.poll(() => selected.gate.snapshot()).toEqual([{ status: 'pending' }]);
  await sender.goto('about:blank');
  assert.equal(sender.url(), 'about:blank');
  await expect.poll(() => senderPeers().every((peer) => peer.closed)).toBe(true);
  assert.deepEqual(selected.gate.snapshot(), [{ status: 'pending' }]);
}

async function checkDisconnectedSender(
  context: BrowserContext,
  selected: InspectorServer,
  alternate: InspectorServer,
) {
  await using cleanup = new AsyncDisposableStack();
  const senderPeerIndex = selected.peers().length;
  const sender = await connectedPage(context, selected);
  cleanup.defer(() => sender.close());
  const senderPeerEnd = selected.peers().length;
  const senderPeers = () => selected.peers().slice(senderPeerIndex, senderPeerEnd);
  assert.ok(senderPeers().some((peer) => !peer.closed));
  const observer = await connectedPage(context, selected);
  cleanup.defer(() => observer.close());
  const otherHost = await connectedPage(context, alternate);
  cleanup.defer(() => otherHost.close());
  const initial = await inspectorSnapshot(observer);
  const alternateInitial = await inspectorSnapshot(otherHost);
  const alternateRequests = alternate.gate.snapshot();
  selected.gate.hold();
  cleanup.defer(selected.gate.release);
  await abandonPendingInspection(sender, selected, senderPeers);
  assert.deepEqual(await inspectorSnapshot(observer), initial);
  assert.deepEqual(await inspectorSnapshot(otherHost), alternateInitial);
  selected.gate.release();
  await expect.poll(() => selected.gate.snapshot()).toEqual([{ status: 'completed' }]);
  await expect(observer.locator('#inspector')).toContainText('Response body: fixture:original');
  const completed = await inspectorSnapshot(observer);
  assert.deepEqual(completed.provider, initial.provider);
  assert.equal(completed.target, `Target: ${selected.origin}/inspector-response`);
  assert.deepEqual(await inspectorSnapshot(otherHost), alternateInitial);
  assert.deepEqual(alternate.gate.snapshot(), alternateRequests);
  await connectInspector({ ...selected, page: sender });
  await expect(sender.locator('#inspector')).toContainText('Response body: fixture:original');
  assert.deepEqual(await inspectorSnapshot(sender), completed);
  assert.deepEqual(selected.gate.snapshot(), [{ status: 'completed' }]);
  return {
    host: selected.host,
    initial,
    completed,
    requests: selected.gate.snapshot(),
    disconnectedPeers: senderPeers(),
    alternate: alternateInitial,
    alternateRequestsBefore: alternateRequests,
    alternateRequestsAfter: alternate.gate.snapshot(),
  };
}

await using cleanup = new AsyncDisposableStack();
const devframe = await inspectorRaceServer('devframe');
cleanup.defer(devframe.close);
const devtools = await inspectorRaceServer('devtools');
cleanup.defer(devtools.close);
const browser = await chromium.launch({ headless: true });
cleanup.defer(() => browser.close());
const context = await browser.newContext();
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
context.on('weberror', (event) => pageErrors.push(event.error().message));
context.on('page', (page) => {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
});
const observations = [
  await checkDisconnectedSender(context, devframe, devtools),
  await checkDisconnectedSender(context, devtools, devframe),
];
const version = browser.version();
await cleanup.disposeAsync();
assert.deepEqual(pageErrors, []);
assert.deepEqual(consoleErrors, []);
const receipt = {
  browser: version,
  observations,
  checks: [
    'the unchanged inspector action starts one real HTTP request on its pinned backend',
    'sender pagehide disconnects its native peer while a second peer and held backend fetch survive',
    'releasing the real response updates retained native state without changing provider incarnation',
    'the alternate host receives no new HTTP request or state change',
    'a fresh sender mount observes retained native state without replaying the inspection',
  ],
  pageErrors,
  consoleErrors,
  limitations: [
    'The abandoned document promise is not inspected; only its actual pagehide and native disconnection are exercised',
    'No available fallback selector is configured; no replay or reroute is claimed beyond this pinned route',
    'Renderer replacement alone is not cancellation in the Vite inspector',
    'Remote caller loss does not cancel already-dispatched backend work or roll back state',
    'Chromium native development only; Firefox, extension contexts and preview are not exercised',
  ],
};
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/inspector-races-chromium.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(styleText('green', '✅ [vite-hosts/inspector-races]'), receipt);
