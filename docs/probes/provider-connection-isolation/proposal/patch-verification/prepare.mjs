import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const fixtureDirectory = process.argv[2];
const toolingDirectory = process.argv[3];
if (
  fixtureDirectory === undefined ||
  fixtureDirectory.length === 0 ||
  toolingDirectory === undefined ||
  toolingDirectory.length === 0
) {
  throw new Error('Usage: node prepare.mjs <installed-server-type-fixture> <monorepo-root>');
}
const sourcePackage = realpathSync(join(fixtureDirectory, 'node_modules/devframe'));
const packageRequire = createRequire(join(sourcePackage, 'package.json'));
const sourceDependencies = dirname(sourcePackage);
const targetDirectory = mkdtempSync(join(tmpdir(), 'devframe-isolation-verification-'));
const targetPackage = join(targetDirectory, 'devframe');
const baselineHashes = {
  'dist/client/index.mjs': ['0e835386c35519d788ebcd6a7c091307d58fe9271cfca76320762b5cc53dc96e'],
  'dist/client/index.d.mts': [
    'ee65069553be253575e08149250debf035623b611d2e368f957aa6cc37af08ca',
    'b5d8fa892d17cc3ccd0df976f537159f7147fb3a7c72fa29981bc9d89dcd096e',
  ],
};

/** @param {string} filename */
function hashFile(filename) {
  return createHash('sha256').update(readFileSync(filename)).digest('hex');
}

for (const [filename, allowedHashes] of Object.entries(baselineHashes)) {
  if (!allowedHashes.includes(hashFile(join(sourcePackage, filename)))) {
    throw new Error(`Unexpected devframe baseline bytes: ${filename}`);
  }
}
cpSync(sourcePackage, targetPackage, { recursive: true });
for (const dependency of readdirSync(sourceDependencies)) {
  const dependencyPath = join(sourceDependencies, dependency);
  if (dependency !== 'devframe' && lstatSync(dependencyPath).isSymbolicLink()) {
    symlinkSync(
      realpathSync(dependencyPath),
      join(targetPackage, 'node_modules', dependency),
      'dir',
    );
  }
}
/** The exact declaration baseline imports its optional cac peer. */
const cacTarget = join(targetPackage, 'node_modules/cac');
if (!existsSync(cacTarget)) {
  symlinkSync(dirname(packageRequire.resolve('cac/package.json')), cacTarget, 'dir');
}
symlinkSync(
  resolve(toolingDirectory, 'node_modules'),
  join(targetDirectory, 'node_modules'),
  'dir',
);
const patchOutput = execFileSync(
  'patch',
  [
    '--batch',
    '--fuzz=0',
    '-p1',
    '-d',
    targetPackage,
    '-i',
    join(import.meta.dirname, 'devframe-1.0.0-isolate-connection.patch'),
  ],
  { encoding: 'utf8' },
);
const hashes = Object.fromEntries(
  Object.keys(baselineHashes).map((filename) => [
    filename,
    {
      baseline: hashFile(join(sourcePackage, filename)),
      patched: hashFile(join(targetPackage, filename)),
    },
  ]),
);
for (const filename of [
  'package.json',
  'prepare.mjs',
  'devframe-1.0.0-isolate-connection.patch',
  'tsconfig.json',
  'vitest.config.ts',
  'isolation.test.ts',
  'isolation.type-test.ts',
]) {
  cpSync(join(import.meta.dirname, filename), join(targetDirectory, filename));
}
writeFileSync(
  join(targetDirectory, 'preparation.json'),
  JSON.stringify({ patchOutput, hashes }, null, 2) + '\n',
);
process.stdout.write(targetDirectory + '\n');
