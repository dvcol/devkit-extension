import type { DevframeRpcClient } from 'devframe/client';
import type { DevToolsRpcClient } from '@vitejs/devtools-kit/client';
import { createClient } from '@devkit/client';
import { createDevframeProviderConnection } from '../src/client/index.js';
import { counterCapability, incrementAction } from './fixtures.js';

export async function remoteClientTypes(
  rpc: DevframeRpcClient,
  devtools: DevToolsRpcClient,
): Promise<void> {
  const connection = await createDevframeProviderConnection({ rpc, providerId: 'example' });
  const nativeDevTools = await createDevframeProviderConnection({
    rpc: devtools,
    providerId: 'example',
  });
  nativeDevTools.dispose();
  const client = createClient({ connections: [connection] });
  const result: number = await client.actions.invoke({ action: incrementAction, input: 1 });
  void result;
  // @ts-expect-error Imported schemas preserve numeric input across the native adapter.
  await connection.invoke({ action: incrementAction, input: '1' });
  const resolution = await connection.resolve({ capability: counterCapability });
  if (resolution.status === 'available') {
    const value: number = await resolution.binding.api.increment(1);
    void value;
    // @ts-expect-error A remote binding does not expose raw backend primitives.
    void resolution.binding.context.native;
  }
  client.dispose();
  connection.dispose();
}
