import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';

const repositoryDirectory = resolve(import.meta.dirname, '..');
const fixtureDirectory = await mkdtemp(join(repositoryDirectory, '.tooling-enforcement-'));

/** Invoke the installed tool directly so the proof uses the committed version. */
function runTool(tool: string, arguments_: readonly string[]) {
  const executable = join(repositoryDirectory, 'node_modules', '.bin', tool);
  const result = spawnSync(executable, arguments_, {
    cwd: repositoryDirectory,
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.ifError(result.error);
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

async function lintFixture(
  name: string,
  source: string,
  additionalArguments: readonly string[] = [],
) {
  const fixturePath = join(fixtureDirectory, `${name}.ts`);
  await writeFile(fixturePath, source);
  return runTool('oxlint', [
    '--config',
    '.oxlintrc.json',
    '--deny-warnings',
    '--no-ignore',
    '--format=json',
    ...additionalArguments,
    fixturePath,
  ]);
}

async function verifyLintGates() {
  const valid = await lintFixture('valid', 'export const answer = 42;\n');
  assert.equal(valid.status, 0, valid.output);

  const invalid = await lintFixture('invalid', 'export const invalid = 1 == "1";\n');
  assert.notEqual(invalid.status, 0, 'Configured equality violation unexpectedly passed.');
  assert.match(invalid.output, /eqeqeq/u);

  const warning = await lintFixture('warning', 'export const warning = 1 == "1";\n', [
    '--warn',
    'eqeqeq',
  ]);
  assert.notEqual(warning.status, 0, 'A warning unexpectedly passed the deny-warnings gate.');
  assert.match(warning.output, /"severity":\s*"warning"/u);
  assert.match(warning.output, /"code":\s*"eslint\(eqeqeq\)"/u);

  const floating = await lintFixture('floating', 'Promise.resolve(42);\nexport {};\n');
  assert.notEqual(floating.status, 0, 'The type-aware rule unexpectedly passed.');
  assert.match(floating.output, /no-floating-promises/u);
}

async function verifyFormatAndTypeGates() {
  const fixturePath = join(fixtureDirectory, 'format.ts');
  await writeFile(fixturePath, 'export const formatting={answer:42}\n');
  const unformatted = runTool('oxfmt', ['--config', '.oxfmtrc.json', '--check', fixturePath]);
  assert.notEqual(unformatted.status, 0, 'Formatting drift unexpectedly passed.');
  const formatted = runTool('oxfmt', ['--config', '.oxfmtrc.json', '--write', fixturePath]);
  assert.equal(formatted.status, 0, formatted.output);
  const checked = runTool('oxfmt', ['--config', '.oxfmtrc.json', '--check', fixturePath]);
  assert.equal(checked.status, 0, checked.output);

  await writeFile(
    join(fixtureDirectory, 'invalid-type.ts'),
    'export const amount: number = "bad";\n',
  );
  const typecheck = runTool('tsc', ['--noEmit', '--project', fixtureDirectory]);
  assert.notEqual(typecheck.status, 0, 'The independent TypeScript gate unexpectedly passed.');
  assert.match(typecheck.output, /TS2322/u);
}

try {
  await writeFile(
    join(fixtureDirectory, 'tsconfig.json'),
    JSON.stringify({ extends: '../tsconfig.base.json', include: ['*.ts'] }),
  );
  await verifyLintGates();
  await verifyFormatAndTypeGates();
  console.info(
    styleText('cyan', '🧪 [tooling]'),
    'Lint, warnings, type-aware rules, types and format gates verified.',
  );
} finally {
  await rm(fixtureDirectory, { recursive: true, force: true });
}
