import assert from 'node:assert/strict';
import { cp, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import type { Plugin } from 'vite';

export const packedExtensionDependencies = {
  '@wxt-dev/browser': '0.3.0',
  wxt: '0.21.4',
  'selenium-webdriver': '4.49.0',
};

/** Only application-owned source is copied; every SDK, shared contract and renderer stays packed. */
export async function checkPackedExtension(options: {
  readonly repository: string;
  readonly consumer: string;
  readonly run: (command: string, arguments_: readonly string[]) => Promise<string>;
}): Promise<Record<string, string>> {
  const { repository, consumer, run } = options;
  const directory = join(consumer, 'extension');
  for (const name of [
    'src',
    'entrypoints',
    'vite.config.ts',
    'wxt.config.ts',
    'tests/inspector-fixture.ts',
    'tests/chromium-inspector.ts',
    'tests/firefox-inspector.ts',
  ])
    await cp(join(repository, 'examples/webext', name), join(directory, name), {
      recursive: true,
    });
  const receipts: Record<string, string> = {};
  for (const browser of ['chromium', 'firefox']) {
    await buildExtension(consumer, browser);
    const runner = pathToFileURL(join(directory, 'tests', `${browser}-inspector.ts`)).href;
    await run(process.execPath, [
      '--input-type=module',
      '--eval',
      `process.chdir(${JSON.stringify(directory)}); await import(${JSON.stringify(runner)});`,
    ]);
    /** The maintained runners retain receipts only after their browser/server cleanup completes. */
    receipts[`packed-extension/${browser}.json`] = await readFile(
      join(directory, 'artifacts/inspector', `${browser}.json`),
      'utf8',
    );
  }
  return receipts;
}

async function buildExtension(consumer: string, browser: string): Promise<void> {
  const packages = [
    'core',
    'runtime',
    'client',
    'devframe',
    'server',
    'webext',
    'example-contribution',
    'example-json-render',
  ];
  const observed = new Set<string>();
  await build({
    configFile: join(consumer, 'extension/vite.config.ts'),
    mode: browser === 'firefox' ? 'firefox' : 'production',
    logLevel: 'silent',
    plugins: [extensionGraph(consumer, packages, observed)],
  });
  assert.deepEqual([...observed].toSorted(), packages.toSorted());
}

/** Check the real production bundle, including worker, panel and packaged injection scripts. */
function extensionGraph(
  consumer: string,
  packages: readonly string[],
  observed: Set<string>,
): Plugin {
  return {
    name: 'verify-packed-extension-graph',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const imported of [...output.imports, ...output.dynamicImports])
          assert.ok(Object.hasOwn(bundle, imported), `External extension import: ${imported}`);
      }
      for (const identifier of this.getModuleIds()) {
        assert.ok(
          !/(?:^node:|browser-external)/u.test(identifier),
          `Node extension import: ${identifier}`,
        );
        if (identifier.startsWith('\0')) continue;
        const local = relative(consumer, identifier);
        assert.ok(
          local !== '..' && !local.startsWith('../') && !local.startsWith('..\\'),
          `Module outside consumer: ${identifier}`,
        );
        for (const name of packages)
          if (identifier.includes(`/@devkit/${name}/dist/`)) observed.add(name);
      }
    },
  };
}
