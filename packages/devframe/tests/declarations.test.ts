import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryDirectory = resolve(import.meta.dirname, '../../..');
const packageDirectory = resolve(import.meta.dirname, '..');
const compiler = join(repositoryDirectory, 'node_modules/.bin/tsc');

/** Compile the public client subpath through its manifest's built declarations. */
async function compileConsumer() {
  const evidenceDirectory = join(packageDirectory, '.conformance');
  await mkdir(evidenceDirectory, { recursive: true });
  const directory = await mkdtemp(join(evidenceDirectory, 'declarations-'));
  try {
    await writeFile(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        extends: join(repositoryDirectory, 'tsconfig.base.json'),
        compilerOptions: { noEmit: true, types: ['node'], lib: ['ES2023', 'DOM'] },
        include: ['consumer.ts'],
      }),
    );
    const source = await readFile(join(import.meta.dirname, 'client.type-test.ts'), 'utf8');
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

describe('built public Devframe client declarations', () => {
  it('preserves native client composition and portable action binding types', async () => {
    expect.assertions(2);
    const result = await compileConsumer();
    expect(result.error).toBeUndefined();
    expect({ status: result.status, output: result.output }).toEqual({ status: 0, output: '' });
  }, 35_000);
});
