import type { RecoveryFixtureOptions } from './definition.js';
import { approvedScope, recoveredTarget } from './definition.js';

function nativeEvent() {
  const listeners = new Set<unknown>();
  return {
    addListener: (listener: unknown) => listeners.add(listener),
    removeListener: (listener: unknown) => listeners.delete(listener),
  };
}

function debuggerBoundary(options: RecoveryFixtureOptions, calls: string[]) {
  const attachResponse = vi.fn<() => Promise<void>>().mockResolvedValue();
  if (options.attachError !== undefined) attachResponse.mockRejectedValueOnce(options.attachError);
  if (options.reattachError !== undefined) attachResponse.mockRejectedValue(options.reattachError);
  return {
    onEvent: nativeEvent(),
    onDetach: nativeEvent(),
    attach() {
      calls.push('attach');
      return attachResponse();
    },
    detach() {
      calls.push('detach');
      if (options.detachError !== undefined) return Promise.reject(options.detachError);
      return Promise.resolve();
    },
    sendCommand(_target: unknown, method: string) {
      calls.push(method);
      if (method !== 'Runtime.getIsolateId') return Promise.resolve({});
      if (options.probeError !== undefined) return Promise.reject(options.probeError);
      return Promise.resolve({ id: 'isolate' });
    },
  };
}

function sessionStorage(restored: boolean | undefined) {
  const recovery = {
    version: 1,
    brokerId: 'broker',
    scopes: [
      {
        requestId: approvedScope.id,
        selector: { kind: 'explicit-tabs', tabIds: [recoveredTarget.tabId] },
      },
    ],
    targets: restored === false ? [] : [recoveredTarget],
  };
  return {
    get: () => Promise.resolve({ recovery }),
    set: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  };
}

/** Replace Chrome I/O while the native provider, recovery loop and publisher run unchanged. */
export function chromeBoundary(options: RecoveryFixtureOptions, calls: string[]) {
  vi.stubGlobal('chrome', {
    debugger: debuggerBoundary(options, calls),
    tabs: {
      onCreated: nativeEvent(),
      onUpdated: nativeEvent(),
      onRemoved: nativeEvent(),
      query: () =>
        Promise.resolve([
          {
            id: recoveredTarget.tabId,
            incognito: false,
            active: true,
            windowId: 1,
            url: 'https://example.com/',
          },
        ]),
    },
    tabGroups: { onRemoved: nativeEvent(), onUpdated: nativeEvent() },
    windows: { onRemoved: nativeEvent() },
    webNavigation: { onCommitted: nativeEvent() },
    alarms: { onAlarm: nativeEvent() },
    storage: { session: sessionStorage(options.restored) },
  });
}
import { vi } from 'vitest';
