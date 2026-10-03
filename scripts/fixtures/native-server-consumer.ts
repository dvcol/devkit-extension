export { inspectorNativeConsumer } from './inspector-native-consumer.ts';

export const nativeServerConsumer = `
import { join } from 'node:path';
import { createHubContext } from '@devframes/hub/node';
import { initHub } from '@devframes/hub/initiate';
import { createKitContext } from '@vitejs/devtools-kit/node';
import { defineAction, definePlugin } from '@devkit/core';
import type { InstallationHandle } from '@devkit/core';
import { createDevframeProvider, createDevToolsProvider, serverExecution } from '@devkit/server';
import type { ServerProviderHandle } from '@devkit/server';
import { action } from './browser.js';
import { checkInspectorComposition } from './inspector.js';

export async function runServers(directory: string): Promise<void> {
  for (const mode of ['devframe', 'devtools']) {
    const host = await createHost(mode, directory);
    const hub = initHub({ context: host.context, base: '/__consumer/', auth: false, register: false, mcp: false, ws: false, sse: false });
    try {
      await hub.ready;
      await checkProvider(await host.createProvider());
    } finally { await hub.close(); }
  }
}

async function createHost(mode: string, directory: string) {
  const options = {
    cwd: directory, mode: 'dev' as const,
    host: {
      mountStatic() { throw new Error('This consumer does not serve assets'); },
      resolveOrigin: () => 'http://127.0.0.1',
      getStorageDir: (scope: string) => join(directory, scope),
    },
  };
  const composition = { providerId: 'consumer.server', expose: { actions: [action] } };
  if (mode === 'devtools') {
    const context = await createKitContext(options);
    return { context, createProvider: () => createDevToolsProvider({ context, ...composition }) };
  }
  const context = await createHubContext(options);
  return { context, createProvider: () => createDevframeProvider({ context, ...composition }) };
}

async function checkProvider(provider: ServerProviderHandle<true>): Promise<void> {
  try {
    const handle = await provider.plugins.install(definePlugin({
      id: 'consumer.server-plugin',
      actions: [defineAction({
        id: 'consumer.server-action', contract: action, execution: serverExecution,
        handler: ({ input }) => input + 1,
      })],
    }));
    handle satisfies InstallationHandle;
    const value: number = await provider.invoke({ action, input: 41 });
    if (value !== 42) throw new Error('Packed server action returned the wrong result');
    await handle.dispose();
    await checkInspectorComposition(provider);
  } finally { await provider.dispose(); }
}
`;
