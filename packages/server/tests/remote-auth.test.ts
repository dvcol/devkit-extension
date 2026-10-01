import { createClient } from '@devkit/client';
import { defineAction, definePlugin } from '@devkit/core';
import { DevframeConnectionError } from 'devframe/client';
import { revokeActiveConnectionsForToken } from 'devframe/node/auth';
import { expect, it } from 'vitest';
import { createDevframeProviderConnection } from '../src/client/index.js';
import { serverExecution } from '../src/index.js';
import { counterCapability, deferred, incrementAction } from './fixtures.js';
import { ownCleanup, remoteComposition, remoteHost } from './remote-fixtures.js';

it('preserves native trust revocation during a call and requires a fresh adapter after reauthentication', async () => {
  expect.assertions(17);
  const started = deferred();
  const finish = deferred();
  const completed = deferred();
  let calls = 0;
  let mutations = 0;
  let backendCancelled = false;
  const host = await remoteHost({
    ...remoteComposition,
    plugins: [
      definePlugin({
        id: 'pending',
        actions: [
          defineAction({
            id: 'pending',
            contract: incrementAction,
            execution: serverExecution,
            requires: { counter: counterCapability },
            async handler({ input, services, signal }) {
              calls += 1;
              started.resolve();
              await finish.promise;
              backendCancelled = signal.aborted;
              const value = await services.counter.api.increment(input);
              mutations += 1;
              completed.resolve();
              return value;
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
  ownCleanup(() => {
    connection.dispose();
  });
  const client = createClient({ connections: [connection] });
  ownCleanup(() => {
    client.dispose();
  });
  ownCleanup(finish.resolve);
  const pending = client.actions
    .invoke({ action: incrementAction, input: 3 })
    .catch((cause: unknown) => cause);
  await started.promise;

  await revokeActiveConnectionsForToken(host.context, host.authToken);
  const failure = await pending;
  expect(failure).toBeInstanceOf(DevframeConnectionError);
  expect(failure).toBe(rpc.connectionError);
  expect(failure).toMatchObject({ kind: 'auth' });
  expect(rpc.status).toBe('unauthorized');
  expect(rpc.isTrusted).toBe(false);
  expect(connection.catalog.snapshot()).toBeUndefined();
  expect(calls).toBe(1);
  expect(mutations).toBe(0);
  await expect(connection.invoke({ action: incrementAction, input: 10 })).rejects.toBe(failure);

  finish.resolve();
  await completed.promise;
  expect(mutations).toBe(1);
  expect(backendCancelled).toBe(false);

  await expect(rpc.requestTrustWithToken(host.authToken)).resolves.toBe(true);
  expect(rpc.connectionError).toBeNull();
  await expect(connection.invoke({ action: incrementAction, input: 10 })).rejects.toBe(failure);
  const replacement = await createDevframeProviderConnection({
    rpc,
    providerId: 'example.remote',
  });
  ownCleanup(() => {
    replacement.dispose();
  });
  expect(replacement.provider).toEqual(connection.provider);
  await expect(replacement.invoke({ action: incrementAction, input: 2 })).resolves.toBe(5);
  expect(calls).toBe(2);
});
