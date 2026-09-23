import type { ActivationScope } from '@devkit/core';

type ActivationCleanup = Parameters<ActivationScope['onDispose']>[0];

async function disposeCleanups(cleanups: ActivationCleanup[]): Promise<void> {
  const failures: unknown[] = [];
  let cleanup = cleanups.pop();

  while (cleanup !== undefined) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
    cleanup = cleanups.pop();
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, 'Activation scope cleanup failed');
  }
}

/** Owns one activation's cancellation and terminal cleanup attempt. */
export function createActivationScope(): {
  readonly scope: ActivationScope;
  cancel(): void;
  dispose(): Promise<void>;
} {
  const abortController = new AbortController();
  const cleanups: ActivationCleanup[] = [];
  let disposalPromise: Promise<void> | undefined;

  function cancel(): void {
    abortController.abort();
  }

  return {
    cancel,
    scope: {
      signal: abortController.signal,
      onDispose(cleanup): void {
        if (disposalPromise !== undefined) {
          throw new Error('Cannot register cleanup after activation scope disposal starts');
        }
        cleanups.push(cleanup);
      },
    },
    dispose(): Promise<void> {
      if (disposalPromise !== undefined) {
        return disposalPromise;
      }

      /** Fence registration and reentrant disposal before abort listeners run. */
      disposalPromise = Promise.resolve().then(() => disposeCleanups(cleanups));
      cancel();
      return disposalPromise;
    },
  };
}
