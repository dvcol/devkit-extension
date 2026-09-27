import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initHub } from '@devframes/hub/initiate';
import { createInteractiveAuth } from 'devframe/recipes/interactive-auth';

import { counterActionsPlugin, counterService } from './definitions.js';
import { registerRemoteCounter } from './remote-counter.js';
import { createRemoteContext } from './remote-context.js';

/** Example-owned HTTP/RPC lifetime; contribution disposal does not remove host RPC definitions. */
export async function createRemoteHost(mode: 'devframe' | 'devtools') {
  const directory = await mkdtemp(join(tmpdir(), 'devkit-remote-example-'));
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => rm(directory, { recursive: true, force: true }));
  const composition = {
    providerId: `example.${mode}-remote`,
    services: [counterService],
    plugins: [counterActionsPlugin],
  };
  const { context: nativeContext, install } = await createRemoteContext(mode, directory);
  const token = randomUUID();
  const hub = initHub({
    context: nativeContext,
    base: '/__devkit-remote/',
    auth: createInteractiveAuth(nativeContext, { clientAuthTokens: [token], banner() {} }),
    register: false,
    mcp: false,
    sse: false,
  });
  const server = createHttpServer(hub);
  cleanup.defer(() => closeServer(server));
  cleanup.defer(() => hub.close());
  cleanup.defer(hub.attach(server));
  await hub.ready;
  const provider = await install(composition);
  cleanup.defer(() => provider.dispose());
  const counter = registerRemoteCounter(nativeContext, provider);
  let currentProvider = provider;
  const origin = await listen(server);
  const lifetime = cleanup.move();
  return {
    context: nativeContext,
    hub,
    provider,
    counter,
    token,
    url: `${origin.replace('http:', 'ws:')}/__devkit-remote/__ws`,
    origin,
    async replace() {
      await currentProvider.dispose();
      const successor = await install(composition);
      lifetime.defer(() => successor.dispose());
      currentProvider = successor;
      counter.replace(successor);
      return successor;
    },
    close: () => lifetime.disposeAsync(),
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing HTTP address');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function createHttpServer(hub: ReturnType<typeof initHub>): Server {
  return createServer((request, response) => {
    hub.nodeMiddleware(request, response, () => {
      response.end('host-alive');
    });
  });
}
