import { fileURLToPath } from 'node:url';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { createServer } from 'vite';
import type { Plugin } from 'vite';

function responseGate() {
  const requests: { status: 'pending' | 'completed' | 'aborted' }[] = [];
  let holdNext = false;
  let releaseRequest: (() => void) | undefined;
  const plugin: Plugin = {
    name: 'test:hold-inspector-response',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== '/inspector-response') {
          next();
          return;
        }
        const receipt: (typeof requests)[number] = { status: 'pending' };
        requests.push(receipt);
        response.once('finish', () => {
          receipt.status = 'completed';
        });
        response.once('close', () => {
          if (!response.writableFinished) receipt.status = 'aborted';
        });
        if (!holdNext) {
          next();
          return;
        }
        holdNext = false;
        releaseRequest = next;
      });
    },
  };
  return {
    plugin,
    hold() {
      if (holdNext || releaseRequest !== undefined) throw new Error('A response is already held');
      holdNext = true;
    },
    release(this: void) {
      holdNext = false;
      const release = releaseRequest;
      releaseRequest = undefined;
      release?.();
    },
    snapshot() {
      return requests.map((request) => ({ ...request }));
    },
  };
}

/** Delay only real endpoint admission; the unchanged feature writes the actual response bytes. */
export async function inspectorRaceServer(host: 'devframe' | 'devtools') {
  const gate = responseGate();
  const server = await createServer({
    configFile: fileURLToPath(new URL('../inspector.config.ts', import.meta.url)),
    mode: host,
    logLevel: 'silent',
    plugins: [gate.plugin],
    server: { host: '127.0.0.1', port: 0 },
  });
  const peers: { path: string; closed: boolean }[] = [];
  server.httpServer?.on('upgrade', (request: IncomingMessage, socket: Duplex) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (!path.endsWith('/__ws')) return;
    const peer = { path, closed: false };
    peers.push(peer);
    socket.once('close', () => {
      peer.closed = true;
    });
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (address === undefined || address === null || typeof address === 'string')
      throw new Error('The native inspector server did not expose a TCP address');
    return {
      host,
      origin: `http://127.0.0.1:${address.port}`,
      gate,
      peers: () => peers.map((peer) => ({ ...peer })),
      async close(this: void) {
        gate.release();
        await server.close();
      },
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}
