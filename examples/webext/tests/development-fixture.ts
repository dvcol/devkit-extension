import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

/** Isolate native watcher edits and browser profiles from the developer's working tree. */
export async function createDevelopmentFixture(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'devkit-webext-development-')));
  try {
    for (const name of ['package.json', 'wxt.config.ts', 'src', 'entrypoints']) {
      await cp(resolvePath(name), join(root, name), { recursive: true });
    }
    await symlink(resolvePath('node_modules'), join(root, 'node_modules'), 'dir');
    return root;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP port');
  return address.port;
}

/** Change the application's actual watched configuration, not the generated manifest. */
export async function updateDevelopmentVersion(root: string): Promise<void> {
  const path = join(root, 'wxt.config.ts');
  const source = await readFile(path, 'utf8');
  const updated = source.replace("version: '0.0.1'", "version: '0.0.2'");
  assert.notEqual(updated, source, 'Expected the application version in the native WXT config');
  await writeFile(path, updated);
}
