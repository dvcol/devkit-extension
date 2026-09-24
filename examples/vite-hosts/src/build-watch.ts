import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';

import { watchProduction } from '@devkit/example-vite-hosts';

const watcher = await watchProduction(
  {
    configFile: fileURLToPath(new URL('../host.config.ts', import.meta.url)),
    mode: 'devframe',
  },
  fileURLToPath(new URL('../.devkit-production', import.meta.url)),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void watcher.close().catch((error: unknown) => {
      console.error(styleText('red', '🚧 [production-build]'), 'Shutdown failed:', error);
      process.exitCode = 1;
    });
  });
}
