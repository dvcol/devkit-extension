import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryDirectory = resolve(import.meta.dirname, '../../..');
const packageDirectory = resolve(import.meta.dirname, '..');
const compiler = join(repositoryDirectory, 'node_modules/.bin/tsc');

/** Compile the maintained fixtures against manifest exports instead of repository source. */
async function compileConsumer(fixture: string) {
  const evidenceDirectory = join(packageDirectory, '.conformance');
  await mkdir(evidenceDirectory, { recursive: true });
  const directory = await mkdtemp(join(evidenceDirectory, 'declarations-'));
  try {
    await writeFile(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        extends: join(repositoryDirectory, 'tsconfig.base.json'),
        compilerOptions: { noEmit: true, types: ['node'], lib: ['ES2023', 'DOM'] },
        include: ['consumer.ts', 'fixtures.ts'],
      }),
    );
    for (const [sourceFile, outputFile] of [
      [fixture, 'consumer.ts'],
      ['fixtures.ts', 'fixtures.ts'],
    ] as const) {
      const source = await readFile(join(import.meta.dirname, sourceFile), 'utf8');
      await writeFile(
        join(directory, outputFile),
        source
          .replaceAll("'../src/index.js'", "'@devkit/server'")
          .replaceAll("'../src/client/index.js'", "'@devkit/server/client'"),
      );
    }
    const result = spawnSync(compiler, ['--project', directory, '--pretty', 'false'], {
      cwd: packageDirectory,
      encoding: 'utf8',
      timeout: 30_000,
    });
    return { error: result.error, status: result.status, output: result.stdout + result.stderr };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('built public server declarations', () => {
  for (const fixture of [
    'provider.type-test.ts',
    'remote-client.type-test.ts',
    'native-context.type-test.ts',
    'connection-isolation.type-test.ts',
  ]) {
    it(`preserves the positive and negative contracts in ${fixture}`, async () => {
      expect.assertions(2);
      const result = await compileConsumer(fixture);
      expect(result.error).toBeUndefined();
      expect({ status: result.status, output: result.output }).toEqual({ status: 0, output: '' });
    });
  }
});
