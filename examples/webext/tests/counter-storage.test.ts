import { afterEach, expect, it, vi } from 'vitest';
import { RpcFunctionsCollectorBase } from 'devframe/rpc';
import { createRpcSharedStateServerHost } from 'devframe/rpc/shared-state';
import type { DevframeRpcServerFunctions } from 'devframe/types';
import { connectCounterStorage } from '../src/counter-storage';
import { createCounterViews } from '../src/spec';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fixture() {
  const collector = new RpcFunctionsCollectorBase<DevframeRpcServerFunctions, undefined>(undefined);
  const sharedState = createRpcSharedStateServerHost({
    register: collector.register.bind(collector),
    broadcast: async () => {},
  });
  const views = createCounterViews(sharedState);
  const get = vi
    .fn<(key: string) => Promise<Record<string, unknown>>>()
    .mockResolvedValue({ counter: { value: 8 } });
  const set = vi.fn<(value: Record<string, unknown>) => Promise<void>>().mockResolvedValue();
  vi.stubGlobal('chrome', { storage: { local: { get, set } } });
  return {
    ...views,
    sharedState,
    key: 'counter',
    get,
    set,
    [Symbol.dispose]() {
      views.view.dispose();
      views.management.dispose();
    },
  };
}

it('restores only the counter and writes native value changes until its owner unsubscribes', async () => {
  expect.assertions(8);
  using counter = fixture();
  const unsubscribe = await connectCounterStorage(counter);
  expect(counter.view.value().state).toEqual({
    value: 8,
    domain: 'shared.example.test',
    actionError: '',
  });
  expect(counter.management.value().state?.storage).toBe('Ready');
  counter.view.patchState([{ op: 'replace', path: '/domain', value: 'another.example.test' }]);
  expect(counter.set).not.toHaveBeenCalled();
  counter.view.patchState([{ op: 'replace', path: '/value', value: 9 }]);
  expect(counter.management.value().state?.storage).toBe('Writing counter 9');
  await vi.waitUntil(() => counter.management.value().state?.storage === 'Wrote counter 9');
  expect(counter.set).toHaveBeenCalledExactlyOnceWith({ counter: { value: 9 } });
  unsubscribe?.();
  counter.view.patchState([{ op: 'replace', path: '/value', value: 10 }]);
  expect(counter.set).toHaveBeenCalledTimes(1);
  expect(counter.view.value().state?.value).toBe(10);
  expect(counter.get).toHaveBeenCalledExactlyOnceWith('counter');
});

it.each([{ value: '8' }, { value: 8, domain: 'saved.example.test' }, null])(
  'rejects invalid saved input without overwriting it: %j',
  async (record) => {
    expect.assertions(3);
    using counter = fixture();
    counter.get.mockResolvedValue({ counter: record });
    await expect(connectCounterStorage(counter)).rejects.toThrow(
      'Stored counter must contain only an integer value',
    );
    expect(counter.view.value().state?.value).toBe(0);
    expect(counter.set).not.toHaveBeenCalled();
  },
);

it('reports native write failure while preserving live state and allows a later native write', async () => {
  expect.assertions(6);
  using counter = fixture();
  const failure = new Error('Storage quota exceeded');
  counter.set.mockRejectedValueOnce(failure);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const unsubscribe = await connectCounterStorage(counter);
  counter.view.patchState([{ op: 'replace', path: '/value', value: 9 }]);
  await vi.waitUntil(() => log.mock.calls.length === 1);
  expect(log).toHaveBeenCalledExactlyOnceWith('Counter storage write failed', failure);
  expect(counter.management.value().state?.storage).toBe(
    'Write failed for counter 9: Storage quota exceeded',
  );
  expect(counter.view.value().state?.value).toBe(9);
  counter.view.patchState([{ op: 'replace', path: '/value', value: 10 }]);
  await vi.waitUntil(() => counter.management.value().state?.storage === 'Wrote counter 10');
  expect(counter.set).toHaveBeenCalledTimes(2);
  expect(counter.set).toHaveBeenLastCalledWith({ counter: { value: 10 } });
  expect(counter.view.value().state?.value).toBe(10);
  unsubscribe?.();
});
