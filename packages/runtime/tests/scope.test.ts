import { describe, expect, it, vi } from 'vitest';

import { createActivationScope } from '../src/scope';

function createCleanupGate(): { readonly promise: Promise<void>; release(): void } {
  let release: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    promise,
    release: () => {
      release();
    },
  };
}

describe('activation scope', () => {
  it('allows settling setup to register cleanup after cancellation and aborts only once', async () => {
    expect.assertions(6);
    const activation = createActivationScope();
    const setupCanFinish = createCleanupGate();
    const ownedCleanup = vi.fn<() => void>();
    const onAbort = vi.fn<() => void>();
    activation.scope.signal.addEventListener('abort', onAbort);
    const setup = setupCanFinish.promise.then(() => {
      activation.scope.onDispose(ownedCleanup);
      return true;
    });

    activation.cancel();
    activation.cancel();

    expect(activation.scope.signal.aborted).toBe(true);
    expect(ownedCleanup).not.toHaveBeenCalled();
    setupCanFinish.release();
    await setup;
    expect(ownedCleanup).not.toHaveBeenCalled();

    const disposalPromise = activation.dispose();
    expect(onAbort).toHaveBeenCalledTimes(1);
    await disposalPromise;
    expect(ownedCleanup).toHaveBeenCalledExactlyOnceWith();
    expect(activation.dispose()).toBe(disposalPromise);
  });

  it('aborts immediately and retains the completed disposal promise with no cleanups', async () => {
    expect.assertions(4);
    const activation = createActivationScope();
    expect(activation.scope.signal.aborted).toBe(false);

    const disposalPromise = activation.dispose();

    expect(activation.scope.signal.aborted).toBe(true);
    await expect(disposalPromise).resolves.toBeUndefined();
    expect(activation.dispose()).toBe(disposalPromise);
  });

  it('awaits cleanup in reverse acquisition order and keeps the pending attempt', async () => {
    expect.assertions(7);
    const activation = createActivationScope();
    const cleanupStarted = createCleanupGate();
    const cleanupCanFinish = createCleanupGate();
    const events: string[] = [];

    activation.scope.onDispose(() => {
      events.push('first');
    });
    activation.scope.onDispose(async () => {
      events.push('second started');
      cleanupStarted.release();
      await cleanupCanFinish.promise;
      events.push('second finished');
    });
    activation.scope.onDispose(() => {
      events.push('third');
    });

    const disposalPromise = activation.dispose();
    let disposalSettled = false;
    void disposalPromise.then(() => {
      disposalSettled = true;
      return true;
    });
    await cleanupStarted.promise;
    await Promise.resolve();

    expect(events).toEqual(['third', 'second started']);
    expect(disposalSettled).toBe(false);
    expect(activation.scope.signal.aborted).toBe(true);
    expect(activation.dispose()).toBe(disposalPromise);
    expect(() => {
      activation.scope.onDispose(vi.fn<() => void>());
    }).toThrow('Cannot register cleanup');

    cleanupCanFinish.release();
    await disposalPromise;

    expect(events).toEqual(['third', 'second started', 'second finished', 'first']);
    expect(activation.dispose()).toBe(disposalPromise);
  });

  it('attempts every cleanup and retains all failures without retrying', async () => {
    expect.assertions(7);
    const activation = createActivationScope();
    const synchronousFailure = new Error('First resource could not close');
    const asynchronousFailure = new Error('Second resource could not close');
    const events: string[] = [];

    activation.scope.onDispose(() => {
      events.push('first');
      throw synchronousFailure;
    });
    activation.scope.onDispose(async () => {
      events.push('second');
      await Promise.resolve();
      throw asynchronousFailure;
    });
    activation.scope.onDispose(() => {
      events.push('third');
    });

    const disposalPromise = activation.dispose();
    const failure: unknown = await disposalPromise.catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({ errors: [asynchronousFailure, synchronousFailure] });
    expect(events).toEqual(['third', 'second', 'first']);
    expect(activation.dispose()).toBe(disposalPromise);
    await expect(activation.dispose()).rejects.toBe(failure);
    expect(events).toEqual(['third', 'second', 'first']);
    expect(() => {
      activation.scope.onDispose(vi.fn<() => void>());
    }).toThrow('Cannot register cleanup');
  });

  it('fences registration before synchronous abort listeners can reenter disposal', async () => {
    expect.assertions(6);
    const activation = createActivationScope();
    const ownedCleanup = vi.fn<() => void>();
    const lateCleanup = vi.fn<() => void>();
    let reentrantDisposalPromise: Promise<void> | undefined;
    let registrationFailure: unknown;
    let abortCount = 0;

    activation.scope.onDispose(ownedCleanup);
    activation.scope.signal.addEventListener('abort', () => {
      abortCount += 1;
      reentrantDisposalPromise = activation.dispose();
      try {
        activation.scope.onDispose(lateCleanup);
      } catch (error) {
        registrationFailure = error;
      }
    });

    const disposalPromise = activation.dispose();

    expect(reentrantDisposalPromise).toBe(disposalPromise);
    expect(registrationFailure).toBeInstanceOf(Error);
    expect(abortCount).toBe(1);
    await disposalPromise;
    expect(ownedCleanup).toHaveBeenCalledExactlyOnceWith();
    expect(lateCleanup).not.toHaveBeenCalled();
    expect(activation.dispose()).toBe(disposalPromise);
  });
});
