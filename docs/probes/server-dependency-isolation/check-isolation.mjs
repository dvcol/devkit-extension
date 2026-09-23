import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';

const directory = await realpath(process.cwd());
let ancestor = dirname(directory);
const checkedAncestors = [];
for (;;) {
  assert.ok(!existsSync(join(ancestor, 'node_modules')), `Ancestor dependency directory invalidates isolation: ${ancestor}`);
  checkedAncestors.push(ancestor);
  const parent = dirname(ancestor);
  if (parent === ancestor) break;
  ancestor = parent;
}
const resolveFromFixture = createRequire(import.meta.url);
const devframeEntry = resolveFromFixture.resolve('devframe');
const resolveFromDevframe = createRequire(devframeEntry);
const resolutions = {};
for (const packageName of ['devframe', '@devframes/hub/initiate', '@vitejs/devtools-kit/node', 'typescript']) {
  const resolved = await realpath(resolveFromFixture.resolve(packageName));
  assert.ok(resolved.startsWith(`${directory}/node_modules/`), `Dependency escaped fixture: ${packageName}`);
  resolutions[packageName] = relative(directory, resolved);
}
for (const packageName of ['cac', 'whenexpr']) {
  const resolved = await realpath(resolveFromDevframe.resolve(packageName));
  assert.ok(resolved.startsWith(`${directory}/node_modules/`), `Devframe dependency escaped fixture: ${packageName}`);
  resolutions[`devframe -> ${packageName}`] = relative(directory, resolved);
}
await writeFile('isolation.json', JSON.stringify({runtime:process.version, checkedAt:new Date().toISOString(), checkedAncestors, ancestorNodeModulesAbsent:true, resolutions}, null, 2) + '\n');
console.info('Independent dependency resolution passed; no ancestor node_modules exists.');
