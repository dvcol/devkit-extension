import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { builtinModules, createRequire } from 'node:module';
import { styleText } from 'node:util';
const dependencyLoader = createRequire(await realpath('/Users/dinh-van.colomban/Workspace/private/devkit-extension/node_modules/vite/package.json'));
const { rolldown } = await import(dependencyLoader.resolve('rolldown'));
const builtinNames = new Set(builtinModules.map((name) => name.replace(/^node:/u, '')));
const bundle = await rolldown({
  input: 'background.mjs', platform: 'browser', tsconfig: false,
  external(specifier) { if (specifier.startsWith('node:') || builtinNames.has(specifier)) throw new Error(`Node builtin in browser graph: ${specifier}`); return false; },
});
await mkdir('extension', { recursive: true });
try {
  const output = await bundle.write({ dir: 'extension', format: 'esm', entryFileNames: 'background.js' });
  if (output.output.some((chunk) => chunk.type === 'chunk' && chunk.imports.length !== 0)) throw new Error('External or split imports remain');
} finally { await bundle.close(); }
await writeFile('extension/manifest.json', JSON.stringify({ manifest_version: 3, name: 'CDB-owned configured Fetch proof', version: '0.0.1', permissions: ['debugger', 'tabs'], background: { service_worker: 'background.js', type: 'module' } }));
await writeFile('extension/control.html', '<!doctype html><title>Owned CDB control</title><p>Packaged extension probe</p>');
console.info(styleText('green', '✅ [cdb-probe]'), 'Browser bundle contains no external imports');
