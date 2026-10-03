import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acceptedConsumers, contractsSource } from './declaration-fixtures.js';
import { rejectedConsumers } from './rejected-declarations.js';

const repositoryDirectory = resolve(import.meta.dirname, '../../..');
const packageDirectory = resolve(import.meta.dirname, '..');
const compiler = join(repositoryDirectory, 'node_modules/.bin/tsc');

/** Self-reference resolves the manifest's dist export, just as an external package consumer does. */
async function compileConsumer(source: string) {
  const evidenceDirectory = join(packageDirectory, '.conformance');
  await mkdir(evidenceDirectory, { recursive: true });
  const directory = await mkdtemp(join(evidenceDirectory, 'declarations-'));
  try {
    await writeFile(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        extends: join(repositoryDirectory, 'tsconfig.base.json'),
        compilerOptions: { noEmit: true, types: [], lib: ['ES2023', 'DOM'] },
        include: ['consumer.ts', 'contracts.ts'],
      }),
    );
    await writeFile(join(directory, 'contracts.ts'), contractsSource);
    await writeFile(join(directory, 'consumer.ts'), source);
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

describe('built public core declarations', () => {
  /** Keep assertions and cleanup inside their test after the compiler's 30-second bound. */
  for (const { name, source } of acceptedConsumers) {
    it(`accepts ${name}`, async () => {
      expect.assertions(2);
      const result = await compileConsumer(source);
      expect(result.error).toBeUndefined();
      expect({ status: result.status, output: result.output }).toEqual({ status: 0, output: '' });
    }, 35_000);
  }

  for (const { name, source, diagnostic, code } of rejectedConsumers) {
    it(`rejects ${name}`, async () => {
      expect.assertions(4);
      const result = await compileConsumer(source);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.output).toContain(diagnostic);
      expect(result.output.match(/error TS\d+/gu)).toEqual([`error ${code}`]);
    }, 35_000);
  }
});
