import { createServer } from 'node:http';
import { join } from 'node:path';
import { createHubContext } from '@devframes/hub/node';
import { initHub } from '@devframes/hub/initiate';
import { getDevframeRpcClient } from 'devframe/client';
import { createInteractiveAuth } from 'devframe/recipes/interactive-auth';
import { afterEach, vi } from 'vitest';
import { createDevframeProvider } from '../src/index.js';
import type { ServerComposition } from '../src/index.js';
import { counterCapability, counterPlugin, counterService, incrementAction } from './fixtures.js';
import { listenHost, temporaryDirectory } from './host-fixtures.js';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

export const remoteComposition = {
  providerId: 'example.remote',
  services: [counterService],
  plugins: [counterPlugin],
  expose: { actions: [incrementAction], capabilities: [counterCapability] },
};

/** Real HTTP, interactive auth and native WebSocket client; only browser environment globals are supplied. */
export async function remoteHost(composition: ServerComposition = remoteComposition) {
  const context = await createRemoteContext();
  const token = crypto.randomUUID();
  const hub = initHub({
    context,
    base: '/__remote/',
    register: false,
    mcp: false,
    sse: false,
    auth: createInteractiveAuth(context, { clientAuthTokens: [token], banner() {} }),
  });
  const server = createServer((request, response) => {
    hub.nodeMiddleware(request, response, () => {
      response.end('host-alive');
    });
  });
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((cause) => {
          if (cause) reject(cause);
          else resolve();
        });
      }),
    () => hub.close(),
    hub.attach(server),
  );
  await hub.ready;
  const provider = await createDevframeProvider({ context, ...composition });
  cleanup.push(() => provider.dispose());
  const origin = await listenHost(server);
  vi.stubGlobal('location', new URL(origin));
  return {
    context,
    hub,
    provider,
    origin,
    connect: (authToken: string = token) => connectNativeClient(origin, authToken),
  };
}

export function ownCleanup(dispose: () => void | Promise<void>): void {
  cleanup.push(dispose);
}

async function createRemoteContext() {
  const { directory, dispose } = await temporaryDirectory();
  cleanup.push(dispose);
  return createHubContext({
    cwd: directory,
    mode: 'dev',
    host: {
      mountStatic() {
        throw new Error('No browser assets in socket tests');
      },
      resolveOrigin: () => 'http://127.0.0.1',
      getStorageDir: (scope) => join(directory, scope),
    },
  });
}

async function connectNativeClient(origin: string, authToken: string) {
  const rpc = await getDevframeRpcClient({
    baseURL: `${origin}/__remote/`,
    connection: { isolated: true },
    authToken,
    simpleAuth: false,
    otpParam: false,
    webmcp: false,
    callTimeout: 3000,
  });
  cleanup.push(() => {
    rpc.close?.();
  });
  return rpc;
}
