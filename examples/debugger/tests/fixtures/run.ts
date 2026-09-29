import { createDebuggerHost } from '../../src/host.js';
import { pageTitleCapability, readPageTitleAction } from '../../src/contracts.js';
import { installDebuggerContributions } from '../../src/provider.js';
import { nativeDebugger } from '../../src/chrome.js';
import { checkEvent } from './events.js';
import { observeNativeDebugger } from './trace.js';

export async function checkUnavailable() {
  const host = createDebuggerHost('firefox', (error) => {
    throw error;
  });
  const { provider, startup } = await installDebuggerContributions(undefined, () => {});
  try {
    const resolution = await provider.resolve({ capability: pageTitleCapability });
    const actionError = await failureMessage(() =>
      provider.invoke({
        action: readPageTitleAction,
        input: { id: crypto.randomUUID(), generation: 1 },
      }),
    );
    return {
      host,
      capability: resolution.status,
      installedServices: startup.services.length,
      plugin: startup.plugins[0]?.snapshot(),
      actionError,
      nativeDebuggerAvailable: chrome.debugger !== undefined,
    };
  } finally {
    await provider.dispose();
  }
}

export async function checkChromium(targetUrl: string) {
  const observation = observeNativeDebugger();
  const errors: string[] = [];
  const host = createDebuggerHost('chromium', (error) => {
    errors.push(String(error));
  });
  if (host.status !== 'available') throw new Error('Expected Chromium host');
  try {
    return await checkPublishedHost(host, targetUrl, errors, observation.trace);
  } finally {
    await host.dispose().finally(() => {
      observation.restore();
    });
  }
}

async function checkPublishedHost(
  host: Extract<ReturnType<typeof createDebuggerHost>, { status: 'available' }>,
  targetUrl: string,
  errors: string[],
  trace: ReturnType<typeof observeNativeDebugger>['trace'],
) {
  const { provider } = await installDebuggerContributions(host.bridge, (diagnostic) => {
    errors.push(diagnostic.code);
  });
  try {
    const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === targetUrl);
    if (tab?.id === undefined) throw new Error('Owned target was not found');
    const tabId = tab.id;
    const target = await host.publisher.publish({
      tabId,
      incognito: tab.incognito,
      url: targetUrl,
    });
    const title = await provider.invoke({
      action: readPageTitleAction,
      input: { id: target.id, generation: target.generation },
    });
    await provider.dispose();
    const targetsAfterContributionDisposal = await host.bridge.client.listTargets();
    const events = await checkEvent(host.bridge, target);
    const outstandingLeases = host.bridge.broker.listLeases().length;
    host.bridge.client.dispose();
    const rawAfterClientDisposal = await nativeDebugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: '7 * 9',
      returnByValue: true,
    });
    await host.dispose();
    return {
      title,
      targetsAfterContributionDisposal,
      events,
      outstandingLeases,
      rawAfterClientDisposal,
      nativeAfterRevoke: await failureMessage(() =>
        nativeDebugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: '1' }),
      ),
      brokerAfterDisposal: await failureMessage(() => host.bridge.broker.listTargets()),
      trace,
      errors,
    };
  } finally {
    await provider.dispose();
  }
}

async function failureMessage(operation: () => unknown): Promise<string> {
  try {
    await operation();
  } catch (error) {
    return String(error);
  }
  throw new Error('Expected operation rejection');
}
