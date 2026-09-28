import { build } from 'vite';
import { expect, it } from 'vitest';

it('bundles the installed native RPC and renderer without Node imports', async () => {
  expect.assertions(4);
  const modules: string[] = [];
  const files: string[] = [];
  await build({
    configFile: './vite.config.ts',
    logLevel: 'silent',
    plugins: [
      {
        name: 'inspect-extension-bundle',
        generateBundle(_options, bundle) {
          modules.push(...this.getModuleIds());
          files.push(...Object.keys(bundle));
        },
      },
    ],
    build: { write: false },
  });
  expect(modules.filter((id) => /(?:^node:|browser-external)/u.test(id))).toEqual([]);
  expect(files).toContain('background.js');
  expect(files).toContain('panel.js');
  expect(files).toContain('manifest.json');
});
