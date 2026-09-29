import { afterEach, expect, it, vi } from 'vitest';
import { chromiumHost, nativeBoundary } from './native-boundary.js';

afterEach(() => vi.unstubAllGlobals());

function earlyEventReply(boundary: ReturnType<typeof nativeBoundary>) {
  return (_target: object, method: string): Promise<object> => {
    if (method === 'Runtime.enable') {
      for (const listener of boundary.onEvent.listeners) {
        listener({ tabId: 7 }, 'Runtime.consoleAPICalled', {
          type: 'log',
          args: [{ type: 'string', value: 'during-enable' }],
        });
      }
    }
    return Promise.resolve({});
  };
}

it('retains native events emitted before domain enable completes', async () => {
  expect.assertions(3);
  const boundary = nativeBoundary();
  boundary.sendCommand.mockImplementation(earlyEventReply(boundary));
  const host = chromiumHost();
  try {
    const target = await host.publisher.publish({
      tabId: 7,
      incognito: false,
      url: 'https://example.test/',
    });
    const lease = await host.bridge.client.acquireLease({
      targetId: target.id,
      targetGeneration: target.generation,
      durationMilliseconds: 10_000,
      mode: 'exclusive-control',
      requestedMethods: ['Runtime.consoleAPICalled'],
    });
    const reference = {
      targetId: target.id,
      targetGeneration: target.generation,
      leaseId: lease.id,
    };
    const subscription = await host.bridge.client.subscribe({
      ...reference,
      match: { method: 'Runtime.consoleAPICalled' },
      buffer: { capacity: 2, overflowStrategy: 'disconnect' },
    });
    const next = subscription[Symbol.asyncIterator]().next();
    subscription.close();
    const event = await next;
    await host.bridge.client.releaseLease(reference);
    expect(event).toMatchObject({
      done: false,
      value: {
        method: 'Runtime.consoleAPICalled',
        parameters: { args: [{ value: 'during-enable' }] },
      },
    });
    expect(host.bridge.broker.listLeases()).toEqual([]);
    expect(boundary.sendCommand.mock.calls.map(([, method]) => method)).toEqual([
      'Target.setAutoAttach',
      'Runtime.enable',
      'Runtime.disable',
    ]);
  } finally {
    await host.dispose();
  }
});
