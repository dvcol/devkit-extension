import type { InstallationResult } from '@devkit/core';
import { vi } from 'vitest';
import { createDebuggerHost } from '../src/host.js';

export function titleReply(value: unknown) {
  return (_target: object, method: string): Promise<object> =>
    Promise.resolve(method === 'Runtime.evaluate' ? { result: { value } } : {});
}

export function failedReply(_target: object, method: string): Promise<object> {
  if (method === 'Runtime.evaluate') return Promise.reject(new Error('Native command failed'));
  return Promise.resolve({});
}

export function deferred<Value>() {
  let complete: ((value: Value | PromiseLike<Value>) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    complete = resolve;
  });
  if (complete === undefined) throw new Error('Missing promise resolver');
  return { promise, resolve: complete };
}

export function delayedReply(
  started: ReturnType<typeof deferred<void>>,
  nativeResult: ReturnType<typeof deferred<object>>,
) {
  return (_target: object, method: string): Promise<object> => {
    if (method !== 'Runtime.evaluate') return Promise.resolve({});
    started.resolve();
    return nativeResult.promise;
  };
}

export function installationHandle(result: InstallationResult | undefined) {
  if (result === undefined) throw new Error('Expected installed service');
  return result;
}

function nativeEvent<Listener>() {
  const listeners = new Set<Listener>();
  return {
    listeners,
    addListener: (listener: Listener) => listeners.add(listener),
    removeListener: (listener: Listener) => listeners.delete(listener),
  };
}

export function nativeBoundary() {
  const onEvent = nativeEvent<(...parameters: unknown[]) => void>();
  const onDetach = nativeEvent<(...parameters: unknown[]) => void>();
  const onUpdated = nativeEvent<(...parameters: unknown[]) => void>();
  const onRemoved = nativeEvent<(...parameters: unknown[]) => void>();
  const attach = vi.fn<() => Promise<void>>().mockResolvedValue();
  const detach = vi.fn<() => Promise<void>>().mockResolvedValue();
  const sendCommand = vi.fn<(target: object, method: string) => Promise<object>>(
    titleReply('Example title'),
  );
  vi.stubGlobal('chrome', {
    debugger: { attach, detach, sendCommand, onEvent, onDetach },
    tabs: { onRemoved, onUpdated },
  });
  return { attach, detach, sendCommand, onEvent, onDetach, onRemoved, onUpdated };
}

export function chromiumHost(onError: (error: unknown) => void = vi.fn<() => void>()) {
  const host = createDebuggerHost('chromium', onError);
  if (host.status !== 'available') throw new Error('Expected Chromium host');
  return host;
}
