import { join } from 'node:path';

import { createHubContext } from '@devframes/hub/node';
import { installDevframeProvider, installDevToolsProvider } from '@devkit/server';
import type { ServerComposition } from '@devkit/server';
import { createKitContext } from '@vitejs/devtools-kit/node';

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
      install: (composition: ServerComposition) => installDevToolsProvider(context, composition),
    };
  }
  const context = await createHubContext(options);
  return {
    context,
    install: (composition: ServerComposition) => installDevframeProvider(context, composition),
  };
}
