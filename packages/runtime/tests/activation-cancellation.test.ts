import { describe, expect, it, vi } from 'vitest';
import { createActivation } from '../src/activation.js';

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

describe('activation cancellation', () => {
  it('cancels work without releasing resources needed by dependent teardown', async () => {
    expect.assertions(7);
    const activation = createActivation<AbortSignal>();
    const workStarted = createGate();
    const aborted = createGate();
    const cleanup = vi.fn<() => void>();
    const signal = await activation.start((scope) => {
      scope.onDispose(cleanup);
      scope.signal.addEventListener(
        'abort',
        () => {
          aborted.release();
        },
        { once: true },
      );
      return scope.signal;
    });
    const work = activation.run(async () => {
      workStarted.release();
      await aborted.promise;
      return 'late value';
    });
    const observed = work.catch((error: unknown) => error);
    await workStarted.promise;
    activation.cancel();
    activation.cancel();
    expect(signal.aborted).toBe(true);
    expect(activation.snapshot().status).toBe('stopping');
    await expect(activation.run(() => 'new work')).rejects.toThrow('not accepting work');
    await expect(observed).resolves.toMatchObject({ name: 'AbortError' });
    expect(cleanup).not.toHaveBeenCalled();
    await activation.stop();
    expect(cleanup).toHaveBeenCalledExactlyOnceWith();
    expect(activation.snapshot().status).toBe('stopped');
  });
});
