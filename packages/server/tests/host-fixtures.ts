import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initHub } from '@devframes/hub/initiate';
import { createHubContext } from '@devframes/hub/node';
import type { CreateHubContextOptions, DevframeHubContext } from '@devframes/hub/node';
import { createKitContext } from '@vitejs/devtools-kit/node';
import { afterEach } from 'vitest';

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
});

async function createHeadlessHost<Context extends DevframeHubContext>(
  createContext: (options: CreateHubContextOptions) => Promise<Context>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'devkit-server-test-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const context = await createContext({
    cwd: directory,
    mode: 'dev',
    host: {
      mountStatic() {
        throw new Error('Headless test does not mount client assets');
      },
      resolveOrigin: () => 'http://127.0.0.1',
      getStorageDir: (scope) => join(directory, scope),
    },
  });
  const hub = initHub({
    context,
    base: '/__devkit-test/',
    auth: false,
    register: false,
    mcp: false,
    ws: false,
    sse: false,
  });
  const httpServer = createServer((request, response) => {
    hub.nodeMiddleware(request, response, () => {
      response.end('host-alive');
    });
  });
  cleanup.push(async () => {
    await hub.close();
    if (httpServer.listening) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });
  await hub.ready;
  return { context, hub, httpServer };
}

export function createDevframeHost() {
  return createHeadlessHost(createHubContext);
}

export function createDevToolsHost() {
  return createHeadlessHost(createKitContext);
}

export async function listenHost(httpServer: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  const address = httpServer.address();
  if (address === null || typeof address === 'string') throw new Error('Missing HTTP address');
  return `http://127.0.0.1:${address.port}`;
}
