import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { styleText } from 'node:util';
import { build } from 'vite';
import { nativeBrowserConsumer } from './fixtures/native-browser-consumer.ts';
import { nativeServerConsumer } from './fixtures/native-server-consumer.ts';

const repository = resolvePath(import.meta.dirname, '..');
const consumer = await realpath(await mkdtemp(join(tmpdir(), 'devkit-native-consumer-')));
const packages = ['core', 'runtime', 'client', 'devframe', 'server', 'webext'] as const;

function run(command: string, arguments_: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      arguments_,
      { cwd: consumer, timeout: 120_000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`${command} failed:\n${stdout}\n${stderr}`, { cause: error }));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function installConsumer(): Promise<void> {
  const overrides: Record<string, string> = {};
  const dependencies: Record<string, string> = {
    '@devframes/hub': '1.0.0',
    '@devframes/json-render': '1.0.0',
    '@devframes/json-render-ui': '1.0.0',
    '@vitejs/devtools-kit': '0.7.5',
    '@types/node': '26.6.1',
    devframe: '1.0.0',
    vite: '8.3.0',
    zod: '4.6.5',
  };
  for (const name of packages) {
    const artifact = join(consumer, `${name}.tgz`);
    await run('pnpm', ['--dir', join(repository, 'packages', name), 'pack', '--out', artifact]);
    overrides[`@devkit/${name}`] = `file:${artifact}`;
    dependencies[`@devkit/${name}`] = `file:${artifact}`;
  }
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      name: 'native-artifact-consumer',
      private: true,
      type: 'module',
      dependencies,
    }),
  );
  await writeFile(join(consumer, '.npmrc'), 'registry=https://registry.npmjs.org\n');
  /** Patches are explicit consumer installation policy, never assumed to propagate through tarballs. */
  const workspace = await readFile(join(repository, 'pnpm-workspace.yaml'), 'utf8');
  /** The packed runtime consumer does not install the extension example's development tools. */
  const runtimeWorkspace = workspace.replaceAll(
    /^  (?:'@wxt-dev\/browser@[^']+'|wxt@[^:]+):.*\n/gmu,
    '',
  );
  await writeFile(
    join(consumer, 'pnpm-workspace.yaml'),
    `${runtimeWorkspace}\noverrides: ${JSON.stringify(overrides)}\n`,
  );
  await cp(join(repository, 'patches'), join(consumer, 'patches'), { recursive: true });
  await run('pnpm', ['install', '--ignore-scripts', '--prefer-offline']);
}

async function checkIsolation(): Promise<void> {
  for (let ancestor = dirname(consumer); ; ancestor = dirname(ancestor)) {
    const entries = await readdir(ancestor);
    assert.ok(!entries.includes('node_modules'), `Ancestor could supply dependencies: ${ancestor}`);
    if (ancestor === dirname(ancestor)) break;
  }
  for (const name of packages) {
    const directory = await realpath(join(consumer, 'node_modules', '@devkit', name));
    assertInside(directory);
    const files = await readdir(directory);
    assert.ok(files.includes('dist'), `Missing packed output: ${name}`);
    assert.ok(
      !files.includes('src') && !files.includes('tests'),
      `Packed source/test leakage: ${name}`,
    );
    const manifest: unknown = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    assert.ok(isRecord(manifest) && isRecord(manifest['exports']));
    for (const entry of Object.values(manifest['exports'])) {
      assert.ok(isRecord(entry));
      for (const path of Object.values(entry)) {
        assert.ok(typeof path === 'string' && path.startsWith('./dist/'));
        assertInside(await realpath(join(directory, path)));
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertInside(path: string): void {
  const local = relative(consumer, path);
  assert.ok(
    local !== '..' && !local.startsWith('../') && !local.startsWith('..\\'),
    `Dependency escaped consumer: ${path}`,
  );
}

async function checkTypes(mode: 'Bundler' | 'NodeNext'): Promise<void> {
  const output = `output-${mode}`;
  await writeFile(
    join(consumer, `tsconfig.${mode}.json`),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        module: mode === 'Bundler' ? 'ESNext' : 'NodeNext',
        moduleResolution: mode,
        lib: ['ES2023', 'DOM'],
        types: ['node'],
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        skipLibCheck: false,
        verbatimModuleSyntax: true,
        outDir: output,
      },
      include: ['browser.ts', 'server.ts'],
    }),
  );
  await run(process.execPath, [
    join(repository, 'node_modules/typescript/bin/tsc'),
    '-p',
    `tsconfig.${mode}.json`,
  ]);
  await execute(join(consumer, output, 'browser.js'), true);
}

async function execute(browser: string, servers: boolean): Promise<void> {
  let source = `const browser = await import(${JSON.stringify(pathToFileURL(browser).href)});
if (await browser.runConsumer() !== 42) throw new Error('Packed native client failed');`;
  if (servers) {
    source += `\nconst server = await import(${JSON.stringify(pathToFileURL(join(dirname(browser), 'server.js')).href)});
await server.runServers(${JSON.stringify(consumer)});`;
  }
  await run(process.execPath, ['--input-type=module', '--eval', source]);
}

async function checkBrowserBundle(): Promise<void> {
  const observedPackages = new Set<string>();
  await build({
    root: consumer,
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir: 'output-browser',
      target: 'esnext',
      lib: { entry: 'browser.ts', formats: ['es'], fileName: 'browser' },
    },
    plugins: [
      {
        name: 'verify-native-consumer-graph',
        generateBundle(_options, bundle) {
          for (const output of Object.values(bundle)) {
            if (output.type !== 'chunk') continue;
            assert.deepEqual(output.imports, [], 'Browser retained external imports');
            assert.deepEqual(output.dynamicImports, [], 'Browser retained dynamic imports');
          }
          for (const identifier of this.getModuleIds()) {
            assert.ok(
              !/(?:^node:|browser-external)/u.test(identifier),
              `Node import in browser: ${identifier}`,
            );
            if (identifier.startsWith('\0')) continue;
            assertInside(identifier);
            for (const name of packages) {
              if (identifier.includes(`/@devkit/${name}/dist/`)) observedPackages.add(name);
            }
          }
        },
      },
    ],
  });
  assert.deepEqual([...observedPackages].toSorted(), [...packages].toSorted());
  await execute(join(consumer, 'output-browser/browser.js'), false);
}

try {
  console.info(
    styleText('cyan', '📦 [native-artifacts]'),
    'Checking packed adapters outside the workspace with explicit native patches.',
  );
  await installConsumer();
  await checkIsolation();
  await writeFile(join(consumer, 'browser.ts'), nativeBrowserConsumer);
  await writeFile(join(consumer, 'server.ts'), nativeServerConsumer);
  await checkTypes('Bundler');
  await checkTypes('NodeNext');
  await checkBrowserBundle();
  console.info(
    styleText('green', '✅ [native-artifacts]'),
    'Packed exports, strict Bundler/NodeNext types, native hosts and browser RPC passed.',
  );
} finally {
  await rm(consumer, { recursive: true, force: true });
}
