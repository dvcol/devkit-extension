import { afterEach, expect, it, vi } from 'vitest';
import { chromiumHost, nativeBoundary } from './native-boundary.js';

afterEach(() => vi.unstubAllGlobals());

async function publishedHost() {
  const host = chromiumHost();
  await host.publisher.publish({ tabId: 7, incognito: false, url: 'https://example.test/' });
  return host;
}

it.each(['Runtime.consoleAPICalled', 'Runtime.'])(
  'releases detached child demand %s without changing missing-child activation',
  async (method) => {
    expect.assertions(4);
    const boundary = nativeBoundary();
    const host = await publishedHost();
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(host.dispose);
    const child = host.publisher.attachChildSession('native-child');
    await host.publisher.setSubscriptionDemand(method, true, child.id);
    boundary.sendCommand.mockClear();
    host.publisher.debuggerEvent({ tabId: 7 }, 'Target.detachedFromTarget', {
      sessionId: 'native-child',
    });
    await expect(
      host.publisher.setSubscriptionDemand(method, false, child.id),
    ).resolves.toBeUndefined();
    expect(boundary.sendCommand).not.toHaveBeenCalled();
    await expect(host.publisher.setSubscriptionDemand(method, true, child.id)).rejects.toThrow(
      'The requested session is not available.',
    );
    expect(boundary.sendCommand).not.toHaveBeenCalled();
  },
);

it('disables a live child domain once and preserves method validation', async () => {
  expect.assertions(3);
  const boundary = nativeBoundary();
  const host = await publishedHost();
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(host.dispose);
  const child = host.publisher.attachChildSession('native-child');
  await host.publisher.setSubscriptionDemand('Runtime.consoleAPICalled', true, child.id);
  boundary.sendCommand.mockClear();
  await host.publisher.setSubscriptionDemand('Runtime.consoleAPICalled', false, child.id);
  await host.publisher.setSubscriptionDemand('Runtime.consoleAPICalled', false, child.id);
  expect(boundary.sendCommand.mock.calls.map(([target, method]) => ({ target, method }))).toEqual([
    { target: { tabId: 7, sessionId: 'native-child' }, method: 'Runtime.disable' },
  ]);
  await expect(
    host.publisher.setSubscriptionDemand('invalid-method', false, child.id),
  ).rejects.toThrow('The subscription method is invalid.');
  expect(boundary.sendCommand).toHaveBeenCalledTimes(1);
});

it('preserves native disable failures for a live child', async () => {
  expect.assertions(2);
  const boundary = nativeBoundary();
  const host = await publishedHost();
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(host.dispose);
  const child = host.publisher.attachChildSession('native-child');
  await host.publisher.setSubscriptionDemand('Runtime.consoleAPICalled', true, child.id);
  boundary.sendCommand.mockRejectedValueOnce(new Error('Native child disable failed'));
  await expect(
    host.publisher.setSubscriptionDemand('Runtime.consoleAPICalled', false, child.id),
  ).rejects.toThrow('Native child disable failed');
  await expect(
    host.publisher.setSubscriptionDemand('Runtime.consoleAPICalled', false, child.id),
  ).resolves.toBeUndefined();
});
