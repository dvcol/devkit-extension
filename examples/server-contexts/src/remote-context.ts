import { join } from 'node:path';

import {
  counterCapability,
  increaseCounterAction,
  increaseMatchingCounterAction,
} from '@devkit/example-contribution';
import { createMatchingCounterPlugin } from '@devkit/example-contribution/provider';

import { createHubContext } from '@devframes/hub/node';
import { createDevframeProvider, createDevToolsProvider, serverExecution } from '@devkit/server';
import type { ServerComposition } from '@devkit/server';
import { createKitContext } from '@vitejs/devtools-kit/node';

import { counterActionsPlugin, counterService } from './definitions.js';

export const remoteComposition = {
  providerId: 'example.remote',
  services: [counterService],
  plugins: [
    counterActionsPlugin,
    createMatchingCounterPlugin({
      execution: serverExecution,
      domains: ['shared.example.test', 'dev.example.test'],
    }),
  ],
  expose: {
    actions: [increaseCounterAction, increaseMatchingCounterAction],
    capabilities: [counterCapability],
  },
};

export async function createRemoteContext(mode: 'devframe' | 'devtools', directory: string) {
  const options = {
    cwd: directory,
    mode: 'dev' as const,
    host: {
      mountStatic() {
        throw new Error('Remote counter does not serve browser assets');
      },
      resolveOrigin: () => 'http://127.0.0.1',
      getStorageDir: (scope: string) => join(directory, scope),
    },
  };
  if (mode === 'devtools') {
    const context = await createKitContext(options);
    return {
      context,
      createProvider: (composition: ServerComposition) =>
        createDevToolsProvider({ context, ...composition }),
    };
  }
  const context = await createHubContext(options);
  return {
    context,
    createProvider: (composition: ServerComposition) =>
      createDevframeProvider({ context, ...composition }),
  };
}
