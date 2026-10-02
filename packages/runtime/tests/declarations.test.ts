import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryDirectory = resolve(import.meta.dirname, '../../..');
const packageDirectory = resolve(import.meta.dirname, '..');
const compiler = join(repositoryDirectory, 'node_modules/.bin/tsc');

/** Manifest self-reference resolves built declarations without source aliases or helper overloads. */
async function compileConsumer(fixture: string) {
  const evidenceDirectory = join(packageDirectory, '.conformance');
  await mkdir(evidenceDirectory, { recursive: true });
  const directory = await mkdtemp(join(evidenceDirectory, 'declarations-'));
  try {
    await writeFile(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        extends: join(repositoryDirectory, 'tsconfig.base.json'),
        compilerOptions: { noEmit: true, types: [], lib: ['ES2023', 'DOM'] },
        include: ['consumer.ts'],
      }),
    );
    const source = await readFile(join(import.meta.dirname, fixture), 'utf8');
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

describe('built public runtime declarations', () => {
  it('preserves strict relaxed and configured installation result contracts', async () => {
    expect.assertions(2);
    const result = await compileConsumer('provider-results.type-test.ts');
    expect(result.error).toBeUndefined();
    expect({ status: result.status, output: result.output }).toEqual({ status: 0, output: '' });
  });

  it('preserves native context descriptor types and optional lookup results', async () => {
    expect.assertions(2);
    const result = await compileConsumer('native-context.type-test.ts');
    expect(result.error).toBeUndefined();
    expect({ status: result.status, output: result.output }).toEqual({ status: 0, output: '' });
  });
});
