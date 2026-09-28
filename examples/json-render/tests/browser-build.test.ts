import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { expect, it } from 'vitest';

it('builds the surface host without Node or provider implementation modules', async () => {
  expect.assertions(1);
  const modules: string[] = [];
  await build({
    configFile: false,
    root: fileURLToPath(new URL('../browser/', import.meta.url)),
    define: { DEMO_AUTH_TOKEN: JSON.stringify('build-check-only') },
    logLevel: 'silent',
    build: { write: false },
    plugins: [
      {
        name: 'assert-renderer-browser-boundary',
        generateBundle() {
          modules.push(...this.getModuleIds());
        },
      },
    ],
  });
  const forbidden =
    /(?:^node:|browser-external|\/(?:packages\/|@devkit\/)(?:runtime|server)\/dist\/)/u;
  expect(modules.filter((identifier) => forbidden.test(identifier))).toEqual([]);
});
