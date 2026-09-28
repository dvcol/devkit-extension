import { access, mkdir, symlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const upstream = process.argv[2];
if (!upstream) throw new Error('Pass the path to the built Devframe prototype checkout.');
const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../..');
const dependencies = {
  '@devkit/webext': resolve(repository, 'packages/webext'),
  devframe: resolve(upstream, 'packages/devframe'),
  '@devframes/json-render': resolve(upstream, 'packages/json-render'),
  '@devframes/json-render-ui': resolve(upstream, 'packages/json-render-ui'),
  vite: resolve(upstream, 'node_modules/vite'),
  '@playwright/test': resolve(upstream, 'node_modules/@playwright/test'),
  birpc: resolve(upstream, 'packages/devframe/node_modules/birpc'),
  typescript: resolve(repository, 'node_modules/typescript'),
  '@types/node': resolve(repository, 'node_modules/@types/node'),
};
for (const [name, source] of Object.entries(dependencies)) {
  await access(source);
  const destination = resolve(directory, 'node_modules', name);
  await mkdir(dirname(destination), { recursive: true });
  try {
    await symlink(source, destination);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(
      `Remove the existing probe dependency link before selecting another checkout: ${destination}`,
    );
  }
}
