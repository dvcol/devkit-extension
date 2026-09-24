import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';

import { preview } from 'vite';

import { productionPreviewPlugin } from '@devkit/example-vite-hosts';

const mode = process.env['DEVKIT_HOST'] ?? 'devframe';
if (mode !== 'devframe' && mode !== 'devtools') throw new Error('Choose devframe or devtools');
const server = await preview({
  configFile: fileURLToPath(new URL('../host.config.ts', import.meta.url)),
  mode,
  plugins: [
    productionPreviewPlugin(fileURLToPath(new URL('../.devkit-production', import.meta.url))),
  ],
});
console.info(
  styleText('cyan', '🚀 [production-preview]'),
  'Build status is available at /__build-status',
);
server.printUrls();
server.bindCLIShortcuts({ print: true });
