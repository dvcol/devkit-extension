import { fileURLToPath } from 'node:url';

import { counterHostPlugins, counterPreviewPlugin } from '@devkit/example-vite-hosts';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

export default defineConfig(async ({ command, mode, isPreview }) => {
  if (mode !== 'devframe' && mode !== 'devtools')
    throw new Error('Choose devframe or devtools mode');
  let plugins: Plugin[] = [];
  if (isPreview === true) plugins = [counterPreviewPlugin(mode)];
  else if (command === 'serve') plugins = await counterHostPlugins(mode);
  return {
    root: fileURLToPath(new URL('./site', import.meta.url)),
    plugins,
    server: { host: '127.0.0.1' },
    preview: { host: '127.0.0.1' },
  };
});
