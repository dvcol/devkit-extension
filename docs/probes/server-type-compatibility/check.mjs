import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { styleText } from 'node:util';

const configurations = [
  'tsconfig.baseline.json',
  'tsconfig.json',
  'tsconfig.kit.json',
  'tsconfig.strict.json',
  'tsconfig.strict-esnext-error.json',
];
const results = [];
for (const configuration of configurations) {
  const result = spawnSync(process.execPath, [
    'node_modules/typescript/bin/tsc', '--noEmit', '-p', configuration,
  ], { encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error);
  results.push({ configuration, exitCode: result.status, output: result.stdout + result.stderr });
  console.info(styleText('cyan', '🧪 [declarations]'), configuration, result.status);
}
await writeFile('results.json', JSON.stringify(results, null, 2) + '\n');
assert.ok(results.every((result) => result.exitCode === 0), JSON.stringify(results));

const resolveDevframe = createRequire(import.meta.resolve('devframe'));
const { HTTPError } = await import(resolveDevframe.resolve('h3'));
const error = new HTTPError({ status: 500 });
const optionalProperties = ['statusText', 'unhandled', 'data', 'body'].map((property) => ({
  property,
  own: Object.hasOwn(error, property),
  hasUndefinedValue: error[property] === undefined,
}));
assert.ok(optionalProperties.every((property) => property.own && property.hasUndefinedValue));
await writeFile('h3-runtime-optionals.json', JSON.stringify({ runtime: process.version, results: optionalProperties }, null, 2) + '\n');
console.info(styleText('cyan', '🧪 [declarations]'), 'H3 optional fields match the corrected declaration.');
