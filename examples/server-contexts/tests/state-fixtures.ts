import { createClient } from '@devkit/client';
import { increaseCounterAction } from '@devkit/example-contribution';
import type { createRemoteHost } from '@devkit/example-server-contexts';
import { createDevframeProviderConnection } from '@devkit/server/client';
import { connectDevframe } from 'devframe/client';
import { vi } from 'vitest';
import { counterStateKey } from '../src/state-key.js';

/** Real native clients; location is the browser global expected by the upstream bootstrap. */
export async function connectState(
  server: Awaited<ReturnType<typeof createRemoteHost>>,
  cleanup: Array<() => void | Promise<void>>,
) {
  vi.stubGlobal('location', new URL(server.origin));
  const nativeClient = await connectDevframe({
    baseURL: `${server.origin}/__devkit-remote/`,
    connection: { isolated: true },
    authToken: server.token,
    simpleAuth: false,
    otpParam: false,
    webmcp: false,
    callTimeout: 3000,
  });
  cleanup.push(() => nativeClient.close?.());
  const connection = await createDevframeProviderConnection({
    rpc: nativeClient,
    providerId: 'example.remote',
  });
  cleanup.push(() => {
    connection.dispose();
  });
  const client = createClient({ connections: [connection] });
  cleanup.push(() => {
    client.dispose();
  });
  const state = await nativeClient.sharedState.get<{ value: number }>(counterStateKey);
  return {
    nativeClient,
    state,
    provider: connection.provider,
    increase: (amount: number) =>
      client.actions.invoke({ action: increaseCounterAction, input: { amount } }),
    close() {
      client.dispose();
      connection.dispose();
      nativeClient.close?.();
    },
  };
}
