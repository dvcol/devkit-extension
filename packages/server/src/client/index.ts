import type { DevframeRpcClient } from 'devframe/client';
import { createRpcProviderConnection } from '@devkit/devframe/client';
import type { RpcProviderConnectionOptions, RpcProviderConnection } from '@devkit/devframe/client';

export interface DevframeProviderConnectionOptions extends Omit<
  RpcProviderConnectionOptions,
  'rpc' | 'realm'
> {
  readonly rpc: DevframeRpcClient;
}
export type DevframeProviderConnection = RpcProviderConnection;

/** Keep native authorization, cache checks and events on the supplied live client. */
export async function createDevframeProviderConnection(
  options: DevframeProviderConnectionOptions,
): Promise<DevframeProviderConnection> {
  options.signal?.throwIfAborted();
  if (options.rpc.transport === 'static') throw new Error('A live native connection is required');
  const connection = await createRpcProviderConnection({ ...options, realm: { id: 'devserver' } });
  return connection;
}
