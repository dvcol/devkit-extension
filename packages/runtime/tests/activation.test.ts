import type { ActivationScope } from '@devkit/core';
import { describe, expect, it, vi } from 'vitest';

import { createActivation } from '../src/activation';

function createGate(): { readonly promise: Promise<void>; release(): void } {
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

describe('activation generation', () => {
  it('starts once, accepts work only while active, and preserves an undefined setup value', async () => {
    expect.assertions(11);
    const activation = createActivation<undefined>();
    const setup = vi.fn<() => undefined>();
    const work = vi.fn<(value: undefined, signal: AbortSignal) => string>(() => 'result');

    expect(activation.snapshot()).toEqual({ status: 'idle' });
    await expect(activation.run(work)).rejects.toThrow('not accepting work');
    const started = activation.start(setup);
    expect(activation.snapshot()).toEqual({ status: 'starting' });
    await expect(activation.start(setup)).rejects.toThrow('only start once');
    await expect(started).resolves.toBeUndefined();
    expect(activation.snapshot()).toEqual({ status: 'active' });
    await expect(activation.run(work)).resolves.toBe('result');
    expect(work).toHaveBeenCalledExactlyOnceWith(undefined, expect.any(AbortSignal));
    expect(setup).toHaveBeenCalledTimes(1);

    const stopped = activation.stop();
    await stopped;
    expect(activation.stop()).toBe(stopped);
    expect(activation.snapshot()).toEqual({ status: 'stopped' });
  });

  it('waits for cancelled setup and cleans resources acquired before and after cancellation', async () => {
    expect.assertions(10);
    const activation = createActivation<string>();
    const setupStarted = createGate();
    const setupCanFinish = createGate();
    const cleanups: string[] = [];
    const setup = vi.fn<(scope: ActivationScope) => Promise<string>>(async (scope) => {
      scope.onDispose(() => {
        cleanups.push('early');
      });
      setupStarted.release();
      await setupCanFinish.promise;
      scope.onDispose(() => {
        cleanups.push('late');
      });
      return 'late setup value';
    });
    const started = activation.start(setup);
    const observedStart = started.catch((error: unknown) => error);
    await setupStarted.promise;

    const stopped = activation.stop();
    expect(setup.mock.calls[0]?.[0].signal.aborted).toBe(true);
    expect(activation.stop()).toBe(stopped);
    expect(activation.snapshot()).toEqual({ status: 'stopping' });
    expect(cleanups).toEqual([]);
    await expect(activation.run(vi.fn<() => string>())).rejects.toThrow('not accepting work');

    setupCanFinish.release();
    await expect(observedStart).resolves.toMatchObject({ name: 'AbortError' });
    await stopped;

    expect(cleanups).toEqual(['late', 'early']);
    expect(activation.snapshot()).toEqual({ status: 'stopped' });
    expect(setup).toHaveBeenCalledTimes(1);
    await expect(activation.start(setup)).rejects.toThrow('only start once');
  });

  it('waits for all dispatched work before cleanup and discards results after cancellation', async () => {
    expect.assertions(12);
    const activation = createActivation<string>();
    const firstStarted = createGate();
    const secondStarted = createGate();
    const firstCanFinish = createGate();
    const secondCanFinish = createGate();
    const cleanup = vi.fn<() => void>();
    let reentrantStop: Promise<void> | undefined;
    await activation.start((scope) => {
      scope.onDispose(cleanup);
      scope.signal.addEventListener('abort', () => {
        reentrantStop = activation.stop();
      });
      return 'value';
    });
    const firstWork = vi.fn<() => Promise<string>>(async () => {
      firstStarted.release();
      await firstCanFinish.promise;
      return 'first result';
    });
    const secondWork = vi.fn<() => Promise<string>>(async () => {
      secondStarted.release();
      await secondCanFinish.promise;
      throw new Error('Second work failed while cancelling');
    });
    const first = activation.run(firstWork);
    const second = activation.run(secondWork);
    const observedFirst = first.catch((error: unknown) => error);
    const observedSecond = second.catch((error: unknown) => error);
    await Promise.all([firstStarted.promise, secondStarted.promise]);

    const stopped = activation.stop();
    expect(reentrantStop).toBe(stopped);
    expect(activation.snapshot()).toEqual({ status: 'stopping' });
    expect(cleanup).not.toHaveBeenCalled();
    await expect(activation.run(firstWork)).rejects.toThrow('not accepting work');
    firstCanFinish.release();
    await expect(observedFirst).resolves.toMatchObject({ name: 'AbortError' });
    expect(cleanup).not.toHaveBeenCalled();
    expect(activation.snapshot()).toEqual({ status: 'stopping' });

    secondCanFinish.release();
    await expect(observedSecond).resolves.toMatchObject({ name: 'AbortError' });
    await stopped;
    expect(cleanup).toHaveBeenCalledExactlyOnceWith();
    expect(activation.snapshot()).toEqual({ status: 'stopped' });
    expect(firstWork).toHaveBeenCalledTimes(1);
    expect(secondWork).toHaveBeenCalledTimes(1);
  });

  it('preserves an ordinary work failure without replay or deactivating the generation', async () => {
    expect.assertions(5);
    const activation = createActivation<string>();
    const failure = new Error('Work failed');
    const work = vi.fn<() => string>(() => {
      throw failure;
    });
    await activation.start(() => 'value');

    await expect(activation.run(work)).rejects.toBe(failure);
    expect(work).toHaveBeenCalledTimes(1);
    expect(activation.snapshot()).toEqual({ status: 'active' });
    await expect(activation.run((value) => value)).resolves.toBe('value');
    await activation.stop();
    expect(activation.snapshot()).toEqual({ status: 'stopped' });
  });

  it('retains setup failure and waits for its cleanup before settling start', async () => {
    expect.assertions(9);
    const activation = createActivation<string>();
    const cleanupStarted = createGate();
    const cleanupCanFinish = createGate();
    const failure = new Error('Setup failed');
    const cleanup = vi.fn<() => Promise<void>>(async () => {
      cleanupStarted.release();
      await cleanupCanFinish.promise;
    });
    const started = activation.start((scope) => {
      scope.onDispose(cleanup);
      throw failure;
    });
    const observedStart = started.catch((error: unknown) => error);
    let startSettled = false;
    const settled = started.then(
      () => {
        startSettled = true;
        return true;
      },
      () => {
        startSettled = true;
        return true;
      },
    );
    await cleanupStarted.promise;

    expect(activation.snapshot()).toEqual({ status: 'stopping', setupFailure: failure });
    expect(startSettled).toBe(false);
    const stopped = activation.stop();
    expect(activation.stop()).toBe(stopped);
    let stopSettled = false;
    const observedStop = stopped.then(() => {
      stopSettled = true;
      return true;
    });
    await Promise.resolve();
    expect(stopSettled).toBe(false);
    cleanupCanFinish.release();
    await expect(observedStart).resolves.toBe(failure);
    await Promise.all([stopped, settled, observedStop]);

    expect(activation.snapshot()).toEqual({ status: 'failed', setupFailure: failure });
    expect(cleanup).toHaveBeenCalledExactlyOnceWith();
    await expect(activation.start(() => 'retry')).rejects.toThrow('only start once');
    await expect(activation.run(() => 'work')).rejects.toThrow('not accepting work');
  });

  it('aggregates setup and cleanup failures and keeps the same blocked cleanup attempt', async () => {
    expect.assertions(8);
    const activation = createActivation<string>();
    const setupFailure = new Error('Setup failed');
    const cleanupFailure = new Error('Cleanup failed');
    const cleanup = vi.fn<() => void>(() => {
      throw cleanupFailure;
    });
    const started = activation.start((scope) => {
      scope.onDispose(cleanup);
      throw setupFailure;
    });

    await expect(started).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [setupFailure, expect.objectContaining({ errors: [cleanupFailure] })],
    });
    const stopped = activation.stop();
    await expect(stopped).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [cleanupFailure],
    });
    expect(activation.stop()).toBe(stopped);
    expect(activation.snapshot()).toMatchObject({
      status: 'cleanup-blocked',
      setupFailure,
      cleanupFailure: { name: 'AggregateError', errors: [cleanupFailure] },
    });
    expect(cleanup).toHaveBeenCalledExactlyOnceWith();
    await expect(activation.start(() => 'retry')).rejects.toThrow('only start once');
    await expect(activation.run(() => 'work')).rejects.toThrow('not accepting work');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('reports cleanup blockage independently of successful setup', async () => {
    expect.assertions(5);
    const activation = createActivation<string>();
    const failure = new Error('Resource remains owned');
    const cleanup = vi.fn<() => void>(() => {
      throw failure;
    });
    await activation.start((scope) => {
      scope.onDispose(cleanup);
      return 'value';
    });

    const stopped = activation.stop();
    await expect(stopped).rejects.toMatchObject({ errors: [failure] });
    expect(activation.snapshot()).toMatchObject({ status: 'cleanup-blocked' });
    expect(activation.snapshot()).not.toHaveProperty('setupFailure');
    expect(activation.stop()).toBe(stopped);
    expect(cleanup).toHaveBeenCalledExactlyOnceWith();
  });

  it('fences setup and work queued before their callbacks begin', async () => {
    expect.assertions(7);
    const startingActivation = createActivation<string>();
    const setup = vi.fn<() => string>(() => 'value');
    const started = startingActivation.start(setup);
    const stoppedSetup = startingActivation.stop();
    await expect(started).rejects.toMatchObject({ name: 'AbortError' });
    await stoppedSetup;
    expect(setup).not.toHaveBeenCalled();
    expect(startingActivation.snapshot()).toMatchObject({ status: 'stopped' });

    const activeActivation = createActivation<string>();
    await activeActivation.start(() => 'value');
    const work = vi.fn<() => string>(() => 'result');
    const running = activeActivation.run(work);
    const stoppedWork = activeActivation.stop();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await stoppedWork;
    expect(work).not.toHaveBeenCalled();
    expect(activeActivation.snapshot()).toEqual({ status: 'stopped' });
    expect(activeActivation.stop()).toBe(stoppedWork);
  });

  it('can stop before setup and keeps that unused generation terminal', async () => {
    expect.assertions(5);
    const activation = createActivation<string>();
    const setup = vi.fn<() => string>(() => 'value');
    const stopped = activation.stop();

    expect(activation.snapshot()).toEqual({ status: 'stopping' });
    await expect(stopped).resolves.toBeUndefined();
    expect(activation.snapshot()).toEqual({ status: 'stopped' });
    await expect(activation.start(setup)).rejects.toThrow('only start once');
    expect(setup).not.toHaveBeenCalled();
  });
});
