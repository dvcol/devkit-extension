import assert from 'node:assert/strict';
import { Context } from 'selenium-webdriver/firefox.js';
import type { Driver } from 'selenium-webdriver/firefox.js';

const observerScript = `
const extensionId = arguments[0];
const { ExtensionParent } = ChromeUtils.importESModule(
  'resource://gre/modules/ExtensionParent.sys.mjs', { global: 'shared' }
);
const observation = {
  events: [], suspends: [], idleStartedAt: null, complete: null,
  snapshot() {
    const policy = ExtensionParent.WebExtensionPolicy.getByID(extensionId);
    const extension = policy?.extension;
    return {
      addonId: extensionId,
      state: extension?.backgroundState ?? 'ABSENT',
      contextId: extension?.backgroundContext?.contextId ?? null,
      toolboxAttached: ExtensionParent.DebugUtils.hasDevToolsAttached(extensionId),
      persistentBackground: extension?.persistentBackground ?? null,
      policyActive: policy?.active ?? false,
      hasShutdown: extension?.hasShutdown ?? false,
      origin: policy?.getURL('') ?? null
    };
  }
};
observation.statusObserver = {
  observe(subject) {
    const value = subject.wrappedJSObject ?? subject;
    if (value.addonId !== extensionId) return;
    observation.events.push({ isRunning: value.isRunning, observedAt: Date.now() });
    if (!value.isRunning && observation.complete !== null)
      Services.tm.dispatchToMainThread(() => observation.complete?.());
  }
};
observation.suspendObserver = () => {
  observation.suspends.push({ observedAt: Date.now(), ...observation.snapshot() });
};
Services.obs.addObserver(observation.statusObserver, 'extension:background-script-status');
window.devkitNativeIdleObservation = observation;
return {
  idleTimeoutMilliseconds: Services.prefs.getIntPref('extensions.background.idle.timeout', 30000),
  idleTimeoutHasUserValue: Services.prefs.prefHasUserValue('extensions.background.idle.timeout')
};
`;

const waitScript = `
const complete = arguments[arguments.length - 1];
const observation = window.devkitNativeIdleObservation;
const initial = observation.snapshot();
if (initial.state !== 'running' || initial.toolboxAttached || initial.persistentBackground) {
  complete({ error: 'Native event page is not running without a toolbox', initial });
  return;
}
const { ExtensionParent } = ChromeUtils.importESModule(
  'resource://gre/modules/ExtensionParent.sys.mjs', { global: 'shared' }
);
const extension = ExtensionParent.WebExtensionPolicy.getByID(initial.addonId).extension;
extension.on('background-script-suspend', observation.suspendObserver);
observation.extension = extension;
observation.idleStartedAt = Date.now();
const deadline = setTimeout(() => {
  observation.complete = null;
  complete({ error: 'Native event page did not suspend within 120 seconds', initial,
    current: observation.snapshot(), events: observation.events, suspends: observation.suspends });
}, 120000);
observation.complete = () => {
  clearTimeout(deadline);
  observation.complete = null;
  complete({ initial, stopped: observation.snapshot(), idleStartedAt: observation.idleStartedAt,
    events: observation.events, suspends: observation.suspends });
};
`;

export async function observeLifecycle(driver: Driver, extensionId: string) {
  await driver.setContext(Context.CHROME);
  const result: unknown = await driver.executeScript(observerScript, extensionId);
  const observation = readObject(result);
  assert.equal(observation.idleTimeoutMilliseconds, 30_000);
  assert.equal(observation.idleTimeoutHasUserValue, false);
  await driver.setContext(Context.CONTENT);
  return observation;
}

/** A native parent-process callback observes suspension without polling extension APIs. */
export async function waitForNativeIdle(driver: Driver) {
  await driver.setContext(Context.CHROME);
  const observation = readObject(await driver.executeAsyncScript<unknown>(waitScript));
  assert.equal(observation.error, undefined, JSON.stringify(observation));
  const initial = readObject(observation.initial);
  const stopped = readObject(observation.stopped);
  assert.equal(initial.state, 'running');
  assert.notEqual(initial.contextId, null);
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.contextId, null);
  assert.equal(stopped.toolboxAttached, false);
  assert.equal(stopped.policyActive, true);
  assert.equal(stopped.hasShutdown, false);
  const idleStartedAt = readNumber(observation.idleStartedAt);
  const events = readArray(observation.events);
  const stoppedEvent = events
    .map((event) => readObject(event))
    .find((event) => event.isRunning === false && readNumber(event.observedAt) >= idleStartedAt);
  assert.ok(stoppedEvent !== undefined);
  assert.ok(readArray(observation.suspends).length > 0);
  await driver.setContext(Context.CONTENT);
  return {
    initial,
    stopped,
    idleStartedAt,
    events,
    suspends: readArray(observation.suspends),
    elapsedMilliseconds: readNumber(stoppedEvent.observedAt) - idleStartedAt,
  };
}

export async function readLifecycle(driver: Driver) {
  await driver.setContext(Context.CHROME);
  const result = readObject(
    await driver.executeScript<unknown>(`
    const observation = window.devkitNativeIdleObservation;
    return { current: observation.snapshot(), events: observation.events, suspends: observation.suspends };
  `),
  );
  await driver.setContext(Context.CONTENT);
  return result;
}

export async function removeObserver(driver: Driver): Promise<void> {
  await driver.setContext(Context.CHROME);
  await driver.executeScript(`
    const observation = window.devkitNativeIdleObservation;
    if (observation !== undefined) {
      Services.obs.removeObserver(observation.statusObserver, 'extension:background-script-status');
      observation.extension?.off('background-script-suspend', observation.suspendObserver);
      delete window.devkitNativeIdleObservation;
    }
  `);
}

export function readObject(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return { ...value };
}

function readArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

function readNumber(value: unknown): number {
  assert.ok(typeof value === 'number' && Number.isFinite(value));
  return value;
}
