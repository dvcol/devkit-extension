import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../..');
const upstream = process.argv[2];
const baseline = process.argv.includes('--baseline');
const installed = process.argv.includes('--installed');
assert.ok(upstream, 'Pass the readable native CDB checkout as the first argument.');
const verification = join(directory, '.verification');
const sourceDirectory = join(verification, 'src');
const extension = await realpath(join(repository, 'examples/debugger/node_modules/@dvcol/cdb-extension'));
const devframe = await realpath(join(repository, 'examples/debugger/node_modules/@dvcol/cdb-devframe'));
const sourceMap = JSON.parse(await readFile(join(extension, 'dist/chrome.js.map'), 'utf8'));
const sourceIndex = sourceMap.sources.indexOf('../src/chrome.ts');
assert.ok(sourceIndex >= 0);
const original = sourceMap.sourcesContent[sourceIndex];
assert.equal(original, await readFile(join(upstream, 'packages/extension/src/chrome.ts'), 'utf8'));
const verifiedSources = new Set();
for (const name of await readdir(join(extension, 'dist'))) {
  if (!name.endsWith('.map')) continue;
  const data = JSON.parse(await readFile(join(extension, 'dist', name), 'utf8'));
  for (const [index, source] of data.sources.entries()) {
    if (!source.startsWith('../src/') || data.sourcesContent?.[index] == null) continue;
    assert.equal(data.sourcesContent[index], await readFile(join(upstream, 'packages/extension', source.slice(3)), 'utf8'), source);
    verifiedSources.add(source);
  }
}
await rm(verification, { recursive: true, force: true });
await mkdir(verification, { recursive: true });
await cp(join(upstream, 'packages/extension/src'), sourceDirectory, { recursive: true });
await writeFile(join(verification, 'package.json'), '{"type":"module"}\n');
await mkdir(join(verification, 'node_modules/@dvcol'), { recursive: true });
await mkdir(join(verification, 'node_modules/@types'), { recursive: true });
for (const name of ['cdb', 'cdb-broker']) {
  await symlink(await realpath(join(devframe, '../', name)), join(verification, 'node_modules/@dvcol', name));
}
await symlink(await realpath(join(repository, 'examples/debugger/node_modules/@types/chrome')), join(verification, 'node_modules/@types/chrome'));
await symlink(extension, join(verification, 'node_modules/@dvcol/cdb-extension'));
if (!baseline) {
  const patch = await readFile(join(directory, 'chrome.patch'), 'utf8');
  const result = spawnSync('patch', ['--batch', '-p4'], { cwd: sourceDirectory, input: patch, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
const aliases = installed ? {} : { '@dvcol/cdb-extension/chrome': join(sourceDirectory, 'chrome.ts') };
await writeFile(join(verification, 'vitest.config.ts'), "import { defineConfig } from 'vitest/config';\nexport default defineConfig(" + JSON.stringify({ root: join(repository, 'examples/debugger'), resolve: { alias: aliases }, test: { include: ['tests/chrome-recovery.test.ts'], maxWorkers: 1 } }) + ');\n');
await writeFile(join(verification, 'tsconfig.json'), JSON.stringify({
  extends: '../../../../tsconfig.base.json',
  compilerOptions: { target: 'ES2024', lib: ['ES2024', 'DOM', 'DOM.Iterable'], types: ['node', 'chrome'], noEmit: true },
  include: ['src/chrome.ts', join(repository, 'examples/debugger/tests/chrome-recovery.test.ts')],
}, null, 2) + '\n');
const candidate = await readFile(join(sourceDirectory, 'chrome.ts'), 'utf8');
await writeFile(join(directory, 'source-receipt.json'), JSON.stringify({
  package: '@dvcol/cdb-extension',
  version: JSON.parse(await readFile(join(extension, 'package.json'), 'utf8')).version,
  baseline,
  installed,
  sourceMatchesRelease: true,
  verifiedRuntimeSources: [...verifiedSources].sort(),
  sourceSha256: createHash('sha256').update(original).digest('hex'),
  candidateSha256: createHash('sha256').update(candidate).digest('hex'),
  installedChromeSha256: createHash('sha256').update(await readFile(join(extension, 'dist/chrome.js'))).digest('hex'),
}, null, 2) + '\n');
let variant = baseline ? 'baseline' : 'candidate';
if (installed) variant = 'installed';
console.info(styleText('cyan', '🧪 [cdb-recovery]'), 'Prepared native Chrome provider verification', variant);
