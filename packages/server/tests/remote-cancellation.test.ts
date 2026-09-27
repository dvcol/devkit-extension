import { createClient } from '@devkit/client';
import { defineAction, definePlugin } from '@devkit/core';
import { describe, expect, it } from 'vitest';
import { createDevframeProviderConnection } from '../src/client/index.js';
import { serverExecution } from '../src/index.js';
import { deferred, incrementAction } from './fixtures.js';
import { ownCleanup, remoteHost } from './remote-fixtures.js';

describe('native cancellation boundary', () => {
  it.each(['caller abort', 'client disposal', 'connection disposal', 'native disconnect'] as const)(
    '%s stops waiting while dispatched backend work can finish once',
    async (mode) => {
      expect.assertions(5);
      const started = deferred();
      const finish = deferred();
      const completed = deferred();
      let calls = 0;
      let mutations = 0;
      let backendCancelled = false;
      const host = await remoteHost({
        providerId: 'example.remote',
        expose: { actions: [incrementAction] },
        plugins: [
          definePlugin({
            id: 'pending',
            actions: [
              defineAction({
                id: 'pending',
                contract: incrementAction,
                execution: serverExecution,
                async handler({ signal }) {
                  calls += 1;
                  started.resolve();
                  await finish.promise;
                  backendCancelled = signal.aborted;
                  mutations += 1;
                  completed.resolve();
                  return mutations;
                },
              }),
            ],
          }),
        ],
      });
      const rpc = await host.connect();
      const connection = await createDevframeProviderConnection({
        rpc,
        providerId: 'example.remote',
      });
      const client = createClient({ connections: [connection] });
      ownCleanup(() => {
        connection.dispose();
        client.dispose();
      });
      ownCleanup(finish.resolve);
      const cancellation = new AbortController();
      const pending = client.actions
        .invoke({ action: incrementAction, input: 1, signal: cancellation.signal })
        .catch((cause: unknown) => cause);
      await started.promise;
      const cancel = {
        'caller abort': () => {
          cancellation.abort();
        },
        'client disposal': () => {
          client.dispose();
        },
        'connection disposal': () => {
          connection.dispose();
        },
        'native disconnect': () => {
          rpc.close?.();
        },
      };
      cancel[mode]();
      expect(await pending).toBeInstanceOf(Error);
      expect(mutations).toBe(0);
      finish.resolve();
      await completed.promise;
      expect(mutations).toBe(1);
      expect(calls).toBe(1);
      expect(backendCancelled).toBe(false);
    },
  );

  it('does not dispatch a call whose caller is already aborted', async () => {
    expect.assertions(2);
    const host = await remoteHost();
    const rpc = await host.connect();
    const connection = await createDevframeProviderConnection({
      rpc,
      providerId: 'example.remote',
    });
    ownCleanup(() => {
      connection.dispose();
    });
    await expect(
      connection.invoke({ action: incrementAction, input: 10, signal: AbortSignal.abort() }),
    ).rejects.toThrow(/abort/iu);
    await expect(host.provider.invoke({ action: incrementAction, input: 1 })).resolves.toBe(1);
  });
});
