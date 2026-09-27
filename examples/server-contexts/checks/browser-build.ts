import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import { build } from 'vite';

await build({
  configFile: false,
  root: fileURLToPath(new URL('../browser/', import.meta.url)),
  define: { DEMO_AUTH_TOKEN: JSON.stringify('build-check-only') },
  logLevel: 'silent',
  build: { write: false },
  plugins: [
    {
      name: 'assert-remote-client-browser-boundary',
      generateBundle() {
        for (const identifier of this.getModuleIds()) {
          assert.ok(
            !identifier.startsWith('node:'),
            `Node dependency in browser client: ${identifier}`,
          );
          assert.ok(
            !identifier.includes('browser-external'),
            `Browser shim in client: ${identifier}`,
          );
          assert.ok(
            !/\/@devkit\/runtime\/dist\//u.test(identifier),
            `Backend runtime in client: ${identifier}`,
          );
          assert.ok(
            !/\/packages\/runtime\/dist\//u.test(identifier),
            `Backend runtime in client: ${identifier}`,
          );
        }
      },
    },
  ],
});
console.info(
  styleText('green', '🚀 [remote-browser]'),
  'Browser build uses no Node or provider-runtime modules.',
);
