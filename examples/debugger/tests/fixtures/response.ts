import type {
  EmbeddedChromeDebuggerBridge,
  PublishedTarget,
  ChromeDebuggerBridgeClient,
  ReleaseLeaseRequest,
} from '@dvcol/cdb';
import { createDebuggerHost } from '../../src/host.js';
import { nativeDebugger } from '../../src/chrome.js';
import { responseDebugger, transformNextResponse } from '../../src/response.js';
import { observeNativeDebugger, waitForNative } from './trace.js';

export async function checkResponseTransform(targetUrl: string) {
  const observation = observeNativeDebugger();
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => {
    observation.restore();
  });
  const errors: string[] = [];
  const host = createDebuggerHost(
    'chromium',
    (error) => {
      errors.push(String(error));
    },
    responseDebugger(`${new URL(targetUrl).origin}/selected*`),
  );
  if (host.status !== 'available') throw new Error('Expected Chromium host');
  cleanup.defer(() => host.dispose());
  const { tabId, target } = await publishFixtureTarget(host, targetUrl);
  const transformed = await checkActiveTransform({
    bridge: host.bridge,
    target,
    trace: observation.trace,
  });
  const afterRelease = await readAfterRelease(host.bridge, target);
  await waitForNative(observation.trace, 'Runtime.disable', 2);
  const remainingLeases = host.bridge.broker.listLeases().length;
  await host.dispose();
  const afterDetach = await nativeDebugger
    .sendCommand({ tabId }, 'Runtime.evaluate', { expression: '1' })
    .then(() => 'unexpected success', String);
  return {
    transformed,
    afterRelease,
    remainingLeases,
    afterDetach,
    trace: observation.trace,
    errors,
  };
}

type AvailableHost = Extract<ReturnType<typeof createDebuggerHost>, { status: 'available' }>;

async function publishFixtureTarget(host: AvailableHost, targetUrl: string) {
  const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === targetUrl);
  if (tab?.id === undefined) throw new Error('Owned response fixture was not found');
  const target = await host.publisher.publish({
    tabId: tab.id,
    incognito: tab.incognito,
    url: targetUrl,
  });
  return { tabId: tab.id, target };
}

interface ResponseFixture {
  readonly bridge: EmbeddedChromeDebuggerBridge;
  readonly target: PublishedTarget;
  readonly trace: ReturnType<typeof observeNativeDebugger>['trace'];
}

async function checkActiveTransform({ bridge, target, trace }: ResponseFixture) {
  await using cleanup = new AsyncDisposableStack();
  const lease = await bridge.client.acquireLease({
    targetId: target.id,
    targetGeneration: target.generation,
    durationMilliseconds: 30_000,
    mode: 'exclusive-control',
    requestedMethods: [
      'Fetch.requestPaused',
      'Fetch.getResponseBody',
      'Fetch.fulfillRequest',
      'Runtime.evaluate',
    ],
  });
  const reference = { targetId: target.id, targetGeneration: target.generation, leaseId: lease.id };
  cleanup.defer(() => bridge.client.releaseLease(reference));
  const subscription = await bridge.client.subscribe({
    ...reference,
    match: { method: 'Fetch.requestPaused' },
    buffer: { capacity: 16, overflowStrategy: 'disconnect' },
  });
  cleanup.defer(() => {
    subscription.close();
  });
  const [response, requests] = await Promise.all([
    transformNextResponse({ client: bridge.client, subscription, reference }),
    readActiveRequests(bridge.client, reference),
  ]);
  subscription.close();
  const disableCountAfterSubscriptionClose = trace.filter(
    (entry) => entry.method === 'Fetch.disable',
  ).length;
  await cleanup.disposeAsync();
  await Promise.all([
    waitForNative(trace, 'Fetch.disable', 1),
    waitForNative(trace, 'Runtime.disable', 1),
  ]);
  return {
    response,
    requests: requests.value,
    disableCountAfterSubscriptionClose,
    overflowed: subscription.overflowed,
    droppedCount: subscription.droppedCount,
  };
}

async function readAfterRelease(bridge: EmbeddedChromeDebuggerBridge, target: PublishedTarget) {
  const lease = await bridge.client.acquireLease({
    targetId: target.id,
    targetGeneration: target.generation,
    durationMilliseconds: 10_000,
    mode: 'exclusive-control',
    requestedMethods: ['Runtime.evaluate'],
  });
  const reference = { targetId: target.id, targetGeneration: target.generation, leaseId: lease.id };
  try {
    const result = await bridge.client.executeCommand({
      ...reference,
      operationId: crypto.randomUUID(),
      method: 'Runtime.evaluate',
      parameters: {
        expression: `fetch('/selected?phase=after-release').then(async (response) => ({ status: response.status, body: await response.text(), probe: response.headers.get('X-Probe') }))`,
        returnByValue: true,
        awaitPromise: true,
      },
    });
    return result.value;
  } finally {
    await bridge.client.releaseLease(reference);
  }
}

function readActiveRequests(client: ChromeDebuggerBridgeClient, reference: ReleaseLeaseRequest) {
  return client.executeCommand({
    ...reference,
    operationId: crypto.randomUUID(),
    method: 'Runtime.evaluate',
    parameters: {
      expression: `Promise.all(['/selected?phase=active', '/unmatched?phase=active'].map(async (path) => {
          const response = await fetch(path);
          return { path, status: response.status, body: await response.text(), probe: response.headers.get('X-Probe') };
        }))`,
      returnByValue: true,
      awaitPromise: true,
    },
  });
}
