import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';

const root = resolve('boundary-fixture');
await mkdir(root, { recursive: true });
const entry = resolve(root, 'entry.ts');
const rendererEntry = resolve(root, 'renderer-only.ts');
const forbiddenImports = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const results: Array<{ name: string; expected: string; observed: string }> = [];
function boundaryGuard(): Plugin {
  return {
    name: 'probe-browser-boundary', enforce: 'pre',
    async resolveId(identifier, importer) {
      if (forbiddenImports.has(identifier)) throw new Error(`Forbidden browser builtin: ${identifier}`);
      const resolved = await this.resolve(identifier, importer, { skipSelf: true });
      if (resolved?.id === rendererEntry) throw new Error('Renderer entry forbidden in background');
      return resolved;
    },
  };
}
await writeFile(resolve(root, 'helper.ts'), "export { readFileSync } from 'node:fs';\n");
await writeFile(rendererEntry, "export const renderer = 'renderer-only';\n");
const cases = [
  { name: 'portable-core', source: "import { defineContribution } from '../fixtures/sdk/dist/index.js'; export const value = defineContribution({id:'probe',value:7});", failure: false },
  { name: 'direct-node', source: "import { readFileSync } from 'node:fs'; export { readFileSync };", failure: true },
  { name: 'transitive-node', source: "export { readFileSync } from './helper';", failure: true },
  { name: 'background-renderer', source: "export { renderer } from './renderer-only';", failure: true },
];
for (const sample of cases) {
  await writeFile(entry, sample.source);
  let errorMessage = '';
  try {
    await build({ root, configFile: false, plugins: [boundaryGuard()], build: { write: false, minify: false, lib: { entry, formats: ['es'] } } });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  assert.equal(errorMessage.length > 0, sample.failure, `${sample.name}: ${errorMessage}`);
  if (sample.failure) assert.match(errorMessage, /Forbidden browser builtin|Renderer entry forbidden/);
  results.push({ name: sample.name, expected: sample.failure ? 'rejected' : 'accepted', observed: errorMessage || 'accepted' });
}
await writeFile(entry, cases[0].source);
assert.match(await readFile(entry, 'utf8'), /defineContribution/);
await writeFile('../boundary-results.json', JSON.stringify(results, null, 2));
