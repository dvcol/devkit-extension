import type { PublishedTarget, TargetChange } from '@dvcol/cdb';
import { z } from 'zod';
import { createDebuggerHost } from '../../src/host.js';
import { installDebuggerContributions } from '../../src/provider.js';
import { readPageTitleAction } from '../../src/contracts.js';
import { observeNativeDebugger } from './trace.js';

type Scenario = 'revoke' | 'close' | 'unsupported';

export async function checkChromiumLifecycle(targetUrl: string) {
  const results = [];
  for (const scenario of ['revoke', 'close', 'unsupported'] as const)
    results.push(await checkScenario(scenario, targetUrl));
  return results;
}

async function checkScenario(scenario: Scenario, targetUrl: string) {
  const tab = await chrome.tabs.create({ url: targetUrl, active: false });
  if (tab.id === undefined) throw new Error('Chrome did not create the owned lifecycle tab');
  const tabId = tab.id;
  const observation = observeNativeDebugger();
  const errors: string[] = [];
  const diagnostics: string[] = [];
  const host = createDebuggerHost('chromium', (error) => {
    errors.push(String(error));
  });
  if (host.status !== 'available') throw new Error('Expected Chromium host');
  const { provider } = await installDebuggerContributions(host.bridge, (diagnostic) => {
    diagnostics.push(diagnostic.code);
  });
  try {
    const result = await exerciseLifecycle({ host, provider, scenario, targetUrl, tabId });
    await provider.dispose();
    await host.dispose();
    return {
      scenario,
      ...result,
      trace: observation.trace,
      errors,
      diagnostics,
      listenersAfterDisposal: {
        event: chrome.debugger.onEvent.hasListeners(),
        detach: chrome.debugger.onDetach.hasListeners(),
        updated: chrome.tabs.onUpdated.hasListeners(),
        removed: chrome.tabs.onRemoved.hasListeners(),
      },
    };
  } finally {
    await provider.dispose();
    await host.dispose().finally(() => {
      observation.restore();
    });
    if ((await chrome.tabs.query({})).some((candidate) => candidate.id === tabId))
      await chrome.tabs.remove(tabId);
  }
}

type AvailableHost = Extract<ReturnType<typeof createDebuggerHost>, { status: 'available' }>;

async function exerciseLifecycle({
  host,
  provider,
  scenario,
  targetUrl,
  tabId,
}: {
  host: AvailableHost;
  provider: Awaited<ReturnType<typeof installDebuggerContributions>>['provider'];
  scenario: Scenario;
  targetUrl: string;
  tabId: number;
}) {
  const changes = host.bridge.client.watchTargets()[Symbol.asyncIterator]();
  try {
    await navigate(tabId, targetUrl);
    const target = await host.publisher.publish({ tabId, incognito: false, url: targetUrl });
    const input = { id: target.id, generation: target.generation };
    const initialTitle = await provider.invoke({ action: readPageTitleAction, input });
    await navigate(tabId, new URL('/navigated', targetUrl).href);
    const navigatedTitle = await provider.invoke({ action: readPageTitleAction, input });
    const targetsAfterNavigation = await host.bridge.client.listTargets();
    const revocation = await observeRevocation({ host, target, changes, scenario, tabId });
    const staleAction = await rejectedAction(() =>
      provider.invoke({ action: readPageTitleAction, input }),
    );
    return {
      target,
      initialTitle,
      navigatedTitle,
      targetsAfterNavigation,
      ...revocation,
      staleAction,
    };
  } finally {
    await changes.return?.();
  }
}

async function navigate(tabId: number, url: string): Promise<void> {
  let complete: (() => void) | undefined;
  const loaded = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const listener: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (
    updatedTabId,
    change,
    tab,
  ) => {
    if (updatedTabId === tabId && change.status === 'complete' && tab.url === url) complete?.();
  };
  chrome.tabs.onUpdated.addListener(listener);
  try {
    await chrome.tabs.update(tabId, { url });
    await loaded;
  } finally {
    chrome.tabs.onUpdated.removeListener(listener);
  }
}

async function invalidate(scenario: Scenario, tabId: number, host: AvailableHost): Promise<void> {
  if (scenario === 'revoke') {
    await host.publisher.revoke();
    return;
  }
  if (scenario === 'close') {
    await chrome.tabs.remove(tabId);
    return;
  }
  await navigate(tabId, 'about:blank');
}

async function nextRevocation(changes: AsyncIterator<TargetChange>) {
  for (;;) {
    const change = await changes.next();
    if (change.done === true) throw new Error('Target watcher closed before revocation');
    if (change.value.kind === 'revoked') return change.value;
  }
}

async function rejectedAction(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    const failure = z
      .object({ code: z.string(), cause: z.object({ code: z.string(), message: z.string() }) })
      .parse(error);
    return { rejected: true, message: String(error), ...failure };
  }
  throw new Error('A revoked target accepted the page-title action');
}

async function observeRevocation({
  host,
  target,
  changes,
  scenario,
  tabId,
}: {
  host: AvailableHost;
  target: PublishedTarget;
  changes: AsyncIterator<TargetChange>;
  scenario: Scenario;
  tabId: number;
}) {
  const { bridge } = host;
  const lease = await bridge.client.acquireLease({
    targetId: target.id,
    targetGeneration: target.generation,
    durationMilliseconds: 10_000,
    mode: 'exclusive-control',
    requestedMethods: ['Runtime.consoleAPICalled'],
  });
  const subscription = await bridge.client.subscribe({
    targetId: target.id,
    targetGeneration: target.generation,
    leaseId: lease.id,
    match: { method: 'Runtime.consoleAPICalled' },
    buffer: { capacity: 2, overflowStrategy: 'disconnect' },
  });
  const pendingEvent = subscription[Symbol.asyncIterator]().next();
  await invalidate(scenario, tabId, host);
  return {
    revocation: await nextRevocation(changes),
    subscriptionResult: await pendingEvent,
    targetsAfterRevocation: await bridge.client.listTargets(),
    leasesAfterRevocation: bridge.broker.listLeases(),
  };
}
