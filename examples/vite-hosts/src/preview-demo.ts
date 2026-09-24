import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';

import { increaseCounterAction } from '@devkit/example-contribution';
import { providerFromVite } from '@devkit/example-vite-hosts';
import { preview } from 'vite';

const mode = process.argv[2];
if (mode !== 'devframe' && mode !== 'devtools') throw new Error('Choose devframe or devtools');
const server = await preview({
  configFile: fileURLToPath(new URL('../host.config.ts', import.meta.url)),
  mode,
});
try {
  const provider = await providerFromVite(server);
  const value = await provider.invoke(increaseCounterAction, { amount: 3 });
  console.info(styleText('cyan', '🚀 [vite-preview]'), 'Live counter action:', {
    provider: provider.provider,
    value,
  });
  server.printUrls();
  server.bindCLIShortcuts({ print: true });
} catch (error) {
  await server.close();
  throw error;
}
