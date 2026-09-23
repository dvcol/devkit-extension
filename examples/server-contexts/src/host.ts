import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initHub } from '@devframes/hub/initiate';
import type { CreateHubContextOptions, DevframeHubContext } from '@devframes/hub/node';

/** Own a real headless hub without opening a listener or mounting browser assets. */
export async function createHeadlessHost<Context extends DevframeHubContext>(
  createContext: (options: CreateHubContextOptions) => Promise<Context>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'devkit-server-example-'));
  try {
    const context = await createContext({
      cwd: directory,
      mode: 'dev',
      host: {
        mountStatic() {
          throw new Error('This headless example does not mount browser assets');
        },
        resolveOrigin: () => 'http://127.0.0.1',
        getStorageDir: (scope) => join(directory, scope),
      },
    });
    const hub = initHub({
      context,
      base: '/__devkit-example/',
      auth: false,
      register: false,
      mcp: false,
      ws: false,
      sse: false,
    });
    const close = async (): Promise<void> => {
      try {
        await hub.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    };
    try {
      await hub.ready;
      return { context, close };
    } catch (error) {
      await close();
      throw error;
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
