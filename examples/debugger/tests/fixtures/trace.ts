import type { JsonObject } from '@dvcol/cdb';
import { nativeDebugger } from '../../src/chrome.js';

export interface NativeTrace {
  readonly method: string;
  status: 'pending' | 'fulfilled' | 'rejected';
  readonly parameters?: JsonObject;
}

/** Observes the real native boundary; every operation still reaches Chrome. */
export function observeNativeDebugger() {
  const original = { ...nativeDebugger };
  const trace: NativeTrace[] = [];
  async function observe<Value>(
    method: string,
    operation: () => Value | Promise<Value>,
    parameters?: JsonObject,
  ): Promise<Value> {
    const entry: NativeTrace = {
      method,
      status: 'pending',
      ...(parameters === undefined ? {} : { parameters }),
    };
    trace.push(entry);
    try {
      const result = await operation();
      entry.status = 'fulfilled';
      return result;
    } catch (error) {
      entry.status = 'rejected';
      throw error;
    }
  }
  nativeDebugger.attach = (target, version) =>
    observe('attach', () => original.attach(target, version));
  nativeDebugger.detach = (target) => observe('detach', () => original.detach(target));
  nativeDebugger.sendCommand = (target, method, parameters) =>
    observe(method, () => original.sendCommand(target, method, parameters), parameters);
  return { trace, restore: () => Object.assign(nativeDebugger, original) };
}

/** Test observation only: native lease release does not acknowledge domain-disable completion. */
export async function waitForNative(
  trace: readonly NativeTrace[],
  method: string,
  occurrence: number,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const command = trace.filter((entry) => entry.method === method)[occurrence - 1];
    if (command?.status === 'fulfilled') return;
    if (command?.status === 'rejected') throw new Error(`Native ${method} rejected`);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }
  throw new Error(`Native ${method} did not complete`);
}
