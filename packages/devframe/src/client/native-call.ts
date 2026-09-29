import type { ProviderRpcClient } from './types.js';

/** Dynamic native names are derived from imported contracts; no second RPC dispatcher is used. */
export async function nativeCall(
  rpc: Pick<ProviderRpcClient, 'call' | 'cacheManager'>,
  method: string,
  parameters: readonly unknown[],
): Promise<unknown> {
  if (rpc.cacheManager?.validate(method) === true)
    throw new Error(`Native caching must be disabled for provider method ${method}`);
  const value: unknown = await Reflect.apply(rpc.call, rpc, [method, ...parameters]);
  return value;
}

/** Cancels only the local wait. The native call remains owned by its transport and backend. */
export function waitForNative<Value>(work: Promise<Value>, signal: AbortSignal): Promise<Value> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      const reason: unknown = signal.reason;
      reject(
        reason instanceof Error ? reason : new Error('Native call wait aborted', { cause: reason }),
      );
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    void work.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}
