import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readProductionStatus } from '@devkit/example-vite-hosts';
import { expect, it } from 'vitest';

it('releases the publication lock synchronously when its owner process exits', async () => {
  expect.assertions(2);
  const directory = await mkdtemp(join(tmpdir(), 'devkit-publication-exit-'));
  const source = new URL('../src/production-output.ts', import.meta.url).href;
  try {
    const childArguments = [
      '--input-type=module',
      '-e',
      `
      import { ProductionPublication } from ${JSON.stringify(source)};
      const publication = new ProductionPublication(${JSON.stringify(directory)});
      publication.start();
      process.exit(0);
    `,
    ];
    execFileSync(process.execPath, childArguments);
    expect(readProductionStatus(directory).phase).toBe('stopped');
    expect(existsSync(join(directory, 'publisher.lock'))).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
