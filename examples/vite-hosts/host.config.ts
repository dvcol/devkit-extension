import { fileURLToPath } from 'node:url';

import { counterHostPlugins } from '@devkit/example-vite-hosts';
import { defineConfig } from 'vite';

export default defineConfig(async ({ mode }) => {
  if (mode !== 'devframe' && mode !== 'devtools')
    throw new Error('Choose devframe or devtools mode');
  return {
    root: fileURLToPath(new URL('./site', import.meta.url)),
    plugins: await counterHostPlugins(mode),
    server: { host: '127.0.0.1' },
  };
});
