import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { startStoredBackground } from './storage-fixture';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('registers synchronously and holds native calls until the stored counter is restored', async () => {
  expect.assertions(6);
  vi.stubEnv('VITE_COUNTER_STORAGE_KEY', 'counter');
  using background = startStoredBackground();
  let restore!: (value: Record<string, unknown>) => void;
  background.get.mockReturnValue(
    new Promise((resolve) => {
      restore = resolve;
    }),
  );
  background.start();
  const received = once(background.serving, 'message');
  const result = vi.fn<(value: unknown) => void>();
  const pending = background.rpc
    .$call('devframe:rpc:server-state:get', 'devframe:json-render:global:counter')
    .then(result);
  await received;
  expect(result).not.toHaveBeenCalled();
  expect(background.get).toHaveBeenCalledExactlyOnceWith('counter');
  restore({ counter: { value: 17 } });
  await pending;
  expect(result.mock.calls[0]?.[0]).toHaveProperty('state.value', 17);
  expect(await background.rpc.$call('probe:identity')).toEqual({
    id: 0,
    url: 'chrome-extension://fixture/panel.html',
  });
  await expect(background.rpc.$callRaw({ method: 'missing:method', args: [] })).rejects.toThrow(
    'not found',
  );
  expect(background.set).not.toHaveBeenCalled();
});

it('returns initialization rejection through native RPC instead of dispatching or timing out', async () => {
  expect.assertions(4);
  vi.stubEnv('VITE_COUNTER_STORAGE_KEY', 'counter');
  using background = startStoredBackground();
  const failure = new Error('Native storage read failed');
  background.get.mockRejectedValue(failure);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  background.start();
  await expect(background.rpc.$call('probe:disable-service')).rejects.toThrow(
    'Native storage read failed',
  );
  await expect(
    background.rpc.$call('devframe:rpc:server-state:get', 'devframe:json-render:global:counter'),
  ).rejects.toThrow('Native storage read failed');
  expect(background.set).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledExactlyOnceWith('Background startup failed', failure);
});

it('keeps the default background independent of extension storage permission', async () => {
  expect.assertions(3);
  vi.stubEnv('VITE_COUNTER_STORAGE_KEY', '');
  using background = startStoredBackground();
  background.start();
  await expect(background.rpc.$call('probe:echo', 'ready')).resolves.toBe('ready');
  expect(background.get).not.toHaveBeenCalled();
  expect(background.set).not.toHaveBeenCalled();
});
