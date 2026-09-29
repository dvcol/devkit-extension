import { nativeDebugger } from '../../src/chrome.js';

export interface NativeTrace {
  readonly method: string;
  status: 'pending' | 'fulfilled' | 'rejected';
}

/** Observes the real native boundary; every operation still reaches Chrome. */
export function observeNativeDebugger() {
  const original = { ...nativeDebugger };
  const trace: NativeTrace[] = [];
  async function observe<Value>(
    method: string,
    operation: () => Value | Promise<Value>,
  ): Promise<Value> {
    const entry: NativeTrace = { method, status: 'pending' };
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
    observe(method, () => original.sendCommand(target, method, parameters));
  return { trace, restore: () => Object.assign(nativeDebugger, original) };
}
