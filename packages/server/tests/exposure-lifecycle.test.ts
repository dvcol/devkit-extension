import { defineAction, definePlugin } from '@devkit/core';
import { describe, expect, it, vi } from 'vitest';

import { createDevframeProvider, serverExecution } from '../src/index.js';
import { invokeExposed } from './exposure-fixtures.js';
import { counterPlugin, counterService, deferred, incrementAction } from './fixtures.js';
import { createDevframeHost } from './host-fixtures.js';

const method = 'devkit:["example.remote","action","example.increment",1]';
const composition = { providerId: 'example.remote', expose: { actions: [incrementAction] } };

describe('exposed invocation ownership', () => {
  it('fences disposal immediately and prevents an in-flight call from adopting a successor', async () => {
    expect.assertions(6);
    const host = await createDevframeHost();
    const started = deferred();
    const finish = deferred();
    const handler = vi.fn<() => Promise<number>>(async () => {
      started.resolve();
      await finish.promise;
      return 42;
    });
    const plugin = definePlugin({
      id: 'pending',
      actions: [
        defineAction({
          id: 'pending',
          contract: incrementAction,
          execution: serverExecution,
          handler,
        }),
      ],
    });
    const provider = await createDevframeProvider({
      context: host.context,
      ...composition,
      plugins: [plugin],
    });
    const call = invokeExposed(host.context, method, provider.provider.incarnation, 1);
    const outcome = call.catch((cause: unknown) => cause);
    await started.promise;
    const disposed = provider.dispose();
    await expect(
      invokeExposed(host.context, method, provider.provider.incarnation, 1),
    ).rejects.toThrow(/unavailable/u);
    await expect(createDevframeProvider({ context: host.context, ...composition })).rejects.toThrow(
      /already owns/u,
    );
    finish.resolve();
    await expect(outcome).resolves.toMatchObject({ code: 'cancelled' });
    await disposed;
    const successor = await createDevframeProvider({
      context: host.context,
      ...composition,
      services: [counterService],
      plugins: [counterPlugin],
    });
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(
      invokeExposed(host.context, method, provider.provider.incarnation, 1),
    ).rejects.toThrow(/incarnation changed/u);
    await expect(
      invokeExposed(host.context, method, successor.provider.incarnation, 2),
    ).resolves.toBe(2);
    await successor.dispose();
  });

  it('keeps failed startup unavailable and allows corrected composition with the same host contracts', async () => {
    expect.assertions(4);
    const host = await createDevframeHost();
    await expect(
      createDevframeProvider({
        context: host.context,
        ...composition,
        services: [counterService, counterService],
      }),
    ).rejects.toMatchObject({ code: 'duplicate-registration' });
    expect(host.context.rpc.has(method)).toBe(true);
    await expect(invokeExposed(host.context, method, 'failed-startup', 1)).rejects.toThrow(
      /unavailable/u,
    );
    const provider = await createDevframeProvider({
      context: host.context,
      ...composition,
      services: [counterService],
      plugins: [counterPlugin],
    });
    await expect(
      invokeExposed(host.context, method, provider.provider.incarnation, 1),
    ).resolves.toBe(1);
    await provider.dispose();
  });
});
