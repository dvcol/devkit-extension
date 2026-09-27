import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { styleText } from 'node:util';
import { build } from 'vite';

import { consumerSource } from './fixtures/core-runtime-package-source.ts';

const repositoryDirectory = resolvePath(import.meta.dirname, '..');
const consumerDirectory = await realpath(await mkdtemp(join(tmpdir(), 'devkit-package-consumer-')));
const packageNames = ['core', 'runtime'] as const;

function run(command: string, arguments_: readonly string[], directory: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      arguments_,
      {
        cwd: directory,
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      },
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

async function packAndInstall() {
  const dependencies: Record<string, string> = { '@standard-schema/spec': '1.1.0' };
  for (const packageName of packageNames) {
    const artifact = join(consumerDirectory, `${packageName}.tgz`);
    await run(
      'pnpm',
      ['pack', '--out', artifact],
      join(repositoryDirectory, 'packages', packageName),
    );
    dependencies[`@devkit/${packageName}`] = `file:${artifact}`;
  }
  await writeFile(
    join(consumerDirectory, 'package.json'),
    JSON.stringify({
      name: 'devkit-artifact-consumer',
      private: true,
      type: 'module',
      dependencies,
    }),
  );
  await writeFile(join(consumerDirectory, '.npmrc'), 'registry=https://registry.npmjs.org\n');
  /** The unpublished core version is satisfied by its actual tarball in this isolated consumer. */
  await writeFile(
    join(consumerDirectory, 'pnpm-workspace.yaml'),
    `overrides:\n  '@devkit/core': ${JSON.stringify(dependencies['@devkit/core'])}\n`,
  );
  await run(
    'pnpm',
    ['install', '--prefer-offline', '--ignore-scripts', '--registry=https://registry.npmjs.org'],
    consumerDirectory,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function inspectInstalledPackages() {
  let coreVersion: string | undefined;
  for (const packageName of packageNames) {
    const directory = join(consumerDirectory, 'node_modules', '@devkit', packageName);
    const actualDirectory = await realpath(directory);
    assert.ok(
      actualDirectory.startsWith(`${consumerDirectory}/`),
      'Package escaped the clean consumer',
    );
    const manifest: unknown = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    assert.ok(isRecord(manifest));
    assert.equal(manifest['name'], `@devkit/${packageName}`);
    assert.ok(typeof manifest['version'] === 'string');
    if (packageName === 'core') coreVersion = manifest['version'];
    assert.ok(isRecord(manifest['dependencies']));
    const dependencies = manifest['dependencies'];
    assert.equal(dependencies['@standard-schema/spec'], '1.1.0');
    if (packageName === 'runtime') {
      assert.equal(
        dependencies['@devkit/core'],
        coreVersion,
        'Workspace protocol was not rewritten',
      );
    }
    const permitted = new Set(['@standard-schema/spec']);
    if (packageName === 'runtime') permitted.add('@devkit/core');
    assert.ok(Object.keys(dependencies).every((dependency) => permitted.has(dependency)));
    const files = await readdir(directory);
    assert.ok(files.includes('dist'));
    assert.ok(!files.includes('src'), 'Consumer received repository sources instead of dist');
    assert.ok(!files.includes('tests'), 'Consumer received workspace test fixtures');
    if (packageName === 'core') await inspectCoreSourceMap(directory);
  }
}

async function inspectCoreSourceMap(directory: string) {
  const sourceMap: unknown = JSON.parse(
    await readFile(join(directory, 'dist', 'index.js.map'), 'utf8'),
  );
  assert.ok(isRecord(sourceMap));
  const sources = sourceMap['sources'];
  assert.ok(Array.isArray(sources) && sources.length > 0);
  for (const source of sources) {
    assert.ok(typeof source === 'string');
    assert.ok(
      source.startsWith('../src/') && !source.includes('/../'),
      `Core inlined code outside its portable sources: ${source}`,
    );
  }
}

async function checkConsumerTypes(
  module: 'ESNext' | 'NodeNext',
  resolution: 'Bundler' | 'NodeNext',
) {
  const outputDirectory = `output-${resolution.toLowerCase()}`;
  const configuration = `tsconfig.${resolution.toLowerCase()}.json`;
  await writeFile(
    join(consumerDirectory, configuration),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        module,
        moduleResolution: resolution,
        lib: ['ES2023', 'DOM'],
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: false,
        verbatimModuleSyntax: true,
        types: [],
        outDir: outputDirectory,
      },
      include: ['consumer.ts'],
    }),
  );
  await run(
    process.execPath,
    [join(repositoryDirectory, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', configuration],
    consumerDirectory,
  );
  await executeConsumer(join(consumerDirectory, outputDirectory, 'consumer.js'));
}

async function executeConsumer(modulePath: string) {
  const moduleUrl = pathToFileURL(modulePath).href;
  const source = `const module = await import(${JSON.stringify(moduleUrl)});
if (await module.runConsumer() !== 'artifact-consumer-passed') throw new Error('Consumer failed');`;
  await run(process.execPath, ['--input-type=module', '--eval', source], consumerDirectory);
}

async function checkBrowserBundle() {
  const observedPackages = new Set<string>();
  await build({
    root: consumerDirectory,
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir: 'output-browser',
      lib: { entry: 'consumer.ts', formats: ['es'], fileName: 'consumer' },
    },
    plugins: [
      {
        name: 'verify-portable-artifacts',
        generateBundle(_outputOptions, outputBundle) {
          for (const output of Object.values(outputBundle)) {
            if (output.type !== 'chunk') continue;
            assert.deepEqual(output.imports, [], 'Browser bundle retained external imports');
            assert.deepEqual(output.dynamicImports, [], 'Browser bundle retained dynamic imports');
          }
          for (const identifier of this.getModuleIds()) {
            if (identifier.startsWith('\0')) continue;
            const modulePath = relative(consumerDirectory, identifier).replaceAll('\\', '/');
            assert.ok(
              !modulePath.startsWith('..'),
              `Bundle used a workspace module: ${identifier}`,
            );
            if (modulePath === 'consumer.ts') continue;
            const packageName = packageNames.find((name) =>
              modulePath.includes(`/@devkit/${name}/dist/`),
            );
            assert.ok(
              packageName !== undefined,
              `Unexpected host or framework module: ${identifier}`,
            );
            observedPackages.add(packageName);
          }
        },
      },
    ],
  });
  assert.deepEqual([...observedPackages].toSorted(), [...packageNames].toSorted());
  await executeConsumer(join(consumerDirectory, 'output-browser', 'consumer.js'));
}

try {
  console.info(
    styleText('cyan', '📦 [artifacts]'),
    'Packing and installing core/runtime in a clean consumer using cached dependencies where available.',
  );
  await packAndInstall();
  await inspectInstalledPackages();
  await writeFile(join(consumerDirectory, 'consumer.ts'), consumerSource);
  await checkConsumerTypes('ESNext', 'Bundler');
  await checkConsumerTypes('NodeNext', 'NodeNext');
  await checkBrowserBundle();
  console.info(
    styleText('cyan', '📦 [artifacts]'),
    'Bundler and NodeNext types, runtime imports and portable browser bundle passed.',
  );
} finally {
  await rm(consumerDirectory, { recursive: true, force: true });
}
