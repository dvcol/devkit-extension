import assert from 'node:assert/strict';
import { By } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import { connectInspector, snapshot, waitText } from './inspector-firefox-actions.ts';
import type { InspectorPage } from './inspector-firefox-actions.ts';
import type { inspectorRaceServer } from './inspector-race-fixture.ts';

type InspectorServer = Awaited<ReturnType<typeof inspectorRaceServer>>;

async function inspectorSnapshot(page: InspectorPage) {
  const current = await snapshot(page);
  return {
    provider: current.provider,
    target: current.target,
    configuration: current.configuration,
    body: current.body,
    marker: current.marker,
  };
}

async function connectedPage(driver: Driver, server: InspectorServer) {
  await driver.switchTo().newWindow('tab');
  const page = { driver, ...server, window: await driver.getWindowHandle() };
  try {
    await connectInspector(page);
    return page;
  } catch (error) {
    await closePage(page);
    throw error;
  }
}

async function closePage({ driver, window }: InspectorPage): Promise<void> {
  await driver.switchTo().window(window);
  await driver.close();
  const [remainingWindow] = await driver.getAllWindowHandles();
  assert.ok(remainingWindow !== undefined);
  await driver.switchTo().window(remainingWindow);
}

async function abandonPendingInspection(
  sender: InspectorPage,
  selected: InspectorServer,
  senderPeers: InspectorServer['peers'],
) {
  const { driver, window } = sender;
  await driver.switchTo().window(window);
  const mount = await driver.findElement(By.css('#inspector > div'));
  const root = await mount.getShadowRoot();
  const buttons = await root.findElements(By.css('button'));
  const labels = await Promise.all(buttons.map((button) => button.getText()));
  const button = buttons[labels.indexOf('Inspect response')];
  assert.ok(button, 'Missing native inspection button');
  await driver.wait(() => button.isEnabled(), 10_000);
  await button.click();
  await driver.wait(() => selected.gate.snapshot()[0]?.status === 'pending', 10_000);
  assert.deepEqual(selected.gate.snapshot(), [{ status: 'pending' }]);
  await driver.get('about:blank');
  assert.equal(await driver.getCurrentUrl(), 'about:blank');
  await driver.wait(() => senderPeers().every((peer) => peer.closed), 10_000);
  assert.deepEqual(selected.gate.snapshot(), [{ status: 'pending' }]);
}

export async function checkDisconnectedSender(
  driver: Driver,
  selected: InspectorServer,
  alternate: InspectorServer,
) {
  await using cleanup = new AsyncDisposableStack();
  const senderPeerIndex = selected.peers().length;
  const sender = await connectedPage(driver, selected);
  cleanup.defer(() => closePage(sender));
  const senderPeerEnd = selected.peers().length;
  const senderPeers = () => selected.peers().slice(senderPeerIndex, senderPeerEnd);
  assert.ok(senderPeers().some((peer) => !peer.closed));
  const observer = await connectedPage(driver, selected);
  cleanup.defer(() => closePage(observer));
  const otherHost = await connectedPage(driver, alternate);
  cleanup.defer(() => closePage(otherHost));
  const initial = await inspectorSnapshot(observer);
  const alternateInitial = await inspectorSnapshot(otherHost);
  const alternateRequests = alternate.gate.snapshot();
  selected.gate.hold();
  cleanup.defer(selected.gate.release);
  await abandonPendingInspection(sender, selected, senderPeers);
  assert.deepEqual(await inspectorSnapshot(observer), initial);
  assert.deepEqual(await inspectorSnapshot(otherHost), alternateInitial);
  selected.gate.release();
  await driver.wait(() => selected.gate.snapshot()[0]?.status === 'completed', 10_000);
  assert.deepEqual(selected.gate.snapshot(), [{ status: 'completed' }]);
  await waitText(observer, 'Response body: fixture:original');
  const completed = await inspectorSnapshot(observer);
  assert.deepEqual(completed.provider, initial.provider);
  assert.equal(completed.target, `Target: ${selected.origin}/inspector-response`);
  assert.deepEqual(await inspectorSnapshot(otherHost), alternateInitial);
  assert.deepEqual(alternate.gate.snapshot(), alternateRequests);
  await connectInspector(sender);
  await waitText(sender, 'Response body: fixture:original');
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
