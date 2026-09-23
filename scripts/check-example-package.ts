import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { styleText } from 'node:util';
import { build, parseSync } from 'vite';

import {
  contractsConsumerSource,
  exampleConsumerSource,
} from './fixtures/example-package-sources.ts';

const repositoryDirectory = resolvePath(import.meta.dirname, '..');
const consumerDirectory = await realpath(await mkdtemp(join(tmpdir(), 'devkit-example-consumer-')));
const packages = [
  { name: '@devkit/core', directory: 'packages/core' },
  { name: '@devkit/runtime', directory: 'packages/runtime' },
  { name: '@devkit/example-contribution', directory: 'examples/contribution' },
] as const;

function run(command: string, arguments_: readonly string[], directory: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      arguments_,
      { cwd: directory, timeout: 60_000, maxBuffer: 1024 * 1024 },
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
  for (const definition of packages) {
    const artifact = join(consumerDirectory, `${definition.name.replace('@devkit/', '')}.tgz`);
    await run('pnpm', ['pack', '--out', artifact], join(repositoryDirectory, definition.directory));
    dependencies[definition.name] = `file:${artifact}`;
  }
  await writeFile(
    join(consumerDirectory, 'package.json'),
    JSON.stringify({
      name: 'devkit-example-artifact-consumer',
      private: true,
      type: 'module',
      dependencies,
    }),
  );
  await writeFile(join(consumerDirectory, '.npmrc'), 'registry=https://registry.npmjs.org\n');
  await writeFile(
    join(consumerDirectory, 'pnpm-workspace.yaml'),
    `overrides:\n  '@devkit/core': ${JSON.stringify(dependencies['@devkit/core'])}\n  '@devkit/runtime': ${JSON.stringify(dependencies['@devkit/runtime'])}\n`,
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
  const versions = new Map<string, string>();
  for (const definition of packages) {
    const directory = join(consumerDirectory, 'node_modules', definition.name);
    const actualDirectory = await realpath(directory);
    assert.ok(
      actualDirectory.startsWith(`${consumerDirectory}/`),
      'Workspace package link escaped the consumer',
    );
    const manifest: unknown = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    assert.ok(isRecord(manifest));
    assert.equal(manifest['name'], definition.name);
    assert.ok(typeof manifest['version'] === 'string');
    assert.ok(isRecord(manifest['dependencies']));
    for (const [name, version] of versions) {
      if (name in manifest['dependencies']) {
        assert.equal(
          manifest['dependencies'][name],
          version,
          'Workspace dependency was not rewritten',
        );
      }
    }
    versions.set(definition.name, manifest['version']);
    const files = await readdir(directory);
    assert.ok(files.includes('dist'));
    assert.ok(!files.includes('src'), 'Consumer received source files');
    assert.ok(!files.includes('tests'), 'Consumer received repository tests');
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
        noImplicitOverride: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        skipLibCheck: false,
        verbatimModuleSyntax: true,
        types: [],
        outDir: outputDirectory,
      },
      include: ['consumer.ts', 'contracts.ts'],
    }),
  );
  await run(
    process.execPath,
    [join(repositoryDirectory, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', configuration],
    consumerDirectory,
  );
  await executeConsumer(
    join(consumerDirectory, outputDirectory, 'consumer.js'),
    'example-consumer-passed',
  );
  await executeConsumer(
    join(consumerDirectory, outputDirectory, 'contracts.js'),
    'contracts-consumer-passed',
  );
}

async function executeConsumer(modulePath: string, expected: string) {
  const moduleUrl = pathToFileURL(modulePath).href;
  const source = `const module = await import(${JSON.stringify(moduleUrl)});
if (await module.runConsumer() !== ${JSON.stringify(expected)}) throw new Error('Consumer failed');`;
  await run(process.execPath, ['--input-type=module', '--eval', source], consumerDirectory);
}

function inspectStaticWrapper(identifier: string, source: string) {
  const parsed = parseSync(identifier, source);
  assert.deepEqual(parsed.errors, [], 'Contract entry could not be parsed');
  assert.ok(parsed.program.body.length > 0, 'Contract entry was empty');
  assert.ok(
    parsed.program.body.every((statement) => {
      if (statement.type === 'ImportDeclaration') return true;
      if (statement.type === 'ExportAllDeclaration') return true;
      return statement.type === 'ExportNamedDeclaration' && statement.declaration === null;
    }),
    `Mapless contract entry contains executable declarations or statements: ${identifier}`,
  );
}

async function inspectContractModule(identifier: string) {
  const isIndex = identifier.endsWith('/dist/index.js');
  const sourceMapText = await readFile(`${identifier}.map`, 'utf8').catch((error: unknown) => {
    if (isRecord(error) && error['code'] === 'ENOENT') return null;
    throw error;
  });
  if (sourceMapText === null) {
    assert.ok(isIndex, `Contract chunk has no source map: ${identifier}`);
    inspectStaticWrapper(identifier, await readFile(identifier, 'utf8'));
    return;
  }
  const sourceMap: unknown = JSON.parse(sourceMapText);
  assert.ok(isRecord(sourceMap));
  const sources = sourceMap['sources'];
  assert.ok(Array.isArray(sources) && sources.length > 0);
  assert.ok(
    sources.every(
      (source: unknown) =>
        source === '../src/contracts.ts' || (isIndex && source === '../src/index.ts'),
    ),
    `Example bundled provider code into its contract entry: ${identifier}`,
  );
}

function inspectModule(identifier: string): 'core' | 'example' | 'zod' | undefined {
  const modulePath = relative(consumerDirectory, identifier).replaceAll('\\', '/');
  assert.ok(
    !modulePath.startsWith('..'),
    `Bundle used an external or workspace module: ${identifier}`,
  );
  if (modulePath === 'contracts.ts') return undefined;
  if (modulePath.includes('/@devkit/core/dist/')) return 'core';
  if (modulePath.includes('/@devkit/example-contribution/dist/')) return 'example';
  if (modulePath.includes('/zod/')) return 'zod';
  return assert.fail(`Unexpected runtime, host, Node or framework module: ${identifier}`);
}

async function checkContractsBrowserBundle() {
  const observedPackages = new Set<string>();
  await build({
    root: consumerDirectory,
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir: 'output-browser',
      lib: { entry: 'contracts.ts', formats: ['es'], fileName: 'contracts' },
    },
    plugins: [
      {
        name: 'verify-example-contract-graph',
        async generateBundle(_outputOptions, outputBundle) {
          for (const output of Object.values(outputBundle)) {
            if (output.type !== 'chunk') continue;
            assert.deepEqual(output.imports, [], 'Browser bundle retained external imports');
            assert.deepEqual(output.dynamicImports, [], 'Browser bundle retained dynamic imports');
          }
          for (const identifier of this.getModuleIds()) {
            const packageName = inspectModule(identifier);
            if (packageName === undefined) continue;
            observedPackages.add(packageName);
            if (packageName === 'example') await inspectContractModule(identifier);
          }
        },
      },
    ],
  });
  assert.deepEqual([...observedPackages].toSorted(), ['core', 'example', 'zod']);
  await executeConsumer(
    join(consumerDirectory, 'output-browser', 'contracts.js'),
    'contracts-consumer-passed',
  );
}

try {
  console.info(
    styleText('cyan', '📦 [example-artifacts]'),
    'Packing core, runtime and the contribution example into an isolated consumer.',
  );
  await packAndInstall();
  await inspectInstalledPackages();
  await writeFile(join(consumerDirectory, 'consumer.ts'), exampleConsumerSource);
  await writeFile(join(consumerDirectory, 'contracts.ts'), contractsConsumerSource);
  await checkConsumerTypes('ESNext', 'Bundler');
  await checkConsumerTypes('NodeNext', 'NodeNext');
  await checkContractsBrowserBundle();
  console.info(
    styleText('cyan', '📦 [example-artifacts]'),
    'Packed NodeNext/Bundler declarations, action/capability calls, subscription disposal and browser contract graph passed.',
  );
} finally {
  await rm(consumerDirectory, { recursive: true, force: true });
}
