import { getTempAuthCode } from 'devframe/node/auth';
import { createRpcClient } from 'devframe/rpc/client';
import { createWsRpcChannel } from 'devframe/rpc/transports/ws-client';
import type { DevframeRpcServerFunctions } from 'devframe/types';
import { expect, it } from 'vitest';
import { poll } from './remote/driver.ts';
import { createNativeDevToolsHost } from './remote/devtools-host.ts';

type BackendProbeFunctions = DevframeRpcServerFunctions & {
  'fixture:echo': (value: string) => { value: string; trusted: boolean };
};

it('retains native authentication and CDB peer cleanup through the actual DevTools hub', async () => {
  expect.assertions(9);
  await using cleanup = new AsyncDisposableStack();
  const host = await createNativeDevToolsHost();
  cleanup.defer(host.close);
  expect(await host.hub.context).toBe(host.context);
  const channel = createWsRpcChannel({ url: host.baseURL.replace('http:', 'ws:') + '__ws' });
  const client = createRpcClient<BackendProbeFunctions>({}, { channel });
  cleanup.defer(() => {
    client.$close();
    channel.close();
  });

  await expect(client.$call('fixture:echo', 'denied')).rejects.toThrow('not authorized');
  expect(host.sessions.size).toBe(1);
  const authenticated = await client.$call('anonymous:devframe:auth:exchange', {
    code: getTempAuthCode(),
    ua: 'native-devtools-backend-test',
    origin: new URL(host.baseURL).origin,
  });
  expect(authenticated.authToken).toBeTruthy();
  await expect(client.$call('fixture:echo', 'trusted-native-peer')).resolves.toEqual({
    value: 'trusted-native-peer',
    trusted: true,
  });
  client.$close();
  channel.close();
  await poll(
    () => host.sessions.size,
    (size) => size === 0,
    'actual DevTools peer disconnect',
  );
  await host.settled();
  expect(host.sessions.size).toBe(0);
  expect(host.errors).toEqual([]);
  expect(host.service.broker.snapshot().scopes).toEqual([]);
  expect(host.service.broker.snapshot().leases).toEqual([]);
});
