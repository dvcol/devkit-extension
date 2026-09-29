import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CdbDevframeService } from '@dvcol/cdb-devframe';
import type { DevframeNodeRpcSession, DevframeRpcConnection } from 'devframe';
import { initDevframe } from 'devframe/initiate';
import type { DevframeInstance } from 'devframe/initiate';
import { createWsOriginRegistry } from 'devframe/rpc/transports/ws-server';
import { createDefinition } from './definition.ts';

/** A native host fixture. Devframe owns trust/RPC; CDB owns pairing, grants and operations. */
export async function createNativeHost() {
  await using cleanup = new AsyncDisposableStack();
  const directory = await mkdtemp(join(tmpdir(), 'devkit-cdb-auth-'));
  cleanup.defer(() => rm(directory, { recursive: true, force: true }));
  const allowedOrigins = createWsOriginRegistry();
  const fixture = createDefinition();
  const peers = createPeerLifecycle(fixture.requireService);
  let native: DevframeInstance | undefined;
  const server = createPageServer(() => native);
  cleanup.defer(() => closeServer(server));
  const origin = await listen(server);
  cleanup.defer(async () => {
    await peers.settled();
    await fixture.dispose();
  });
  native = initDevframe(fixture.definition, {
    base: '/__cdb/',
    origin,
    server,
    allowedOrigins,
    mcp: false,
    register: false,
    getStorageDir: (scope) => join(directory, scope),
    onPeerConnect: peers.onPeerConnect,
    onPeerDisconnect: peers.onPeerDisconnect,
  });
  cleanup.defer(() => native?.close());
  await native.ready;
  const service = fixture.requireService();
  const lifetime = cleanup.move();
  return {
    baseURL: `${origin}/__cdb/`,
    fixtureUrl: `${origin}/owned-target`,
    allowedOrigins,
    service,
    provider: fixture.requireProvider(),
    diagnostics: fixture.diagnostics,
    sessions: peers.sessions,
    errors: peers.errors,
    settled: peers.settled,
    close: () => lifetime.disposeAsync(),
  };
}

function createPeerLifecycle(service: () => CdbDevframeService) {
  const sessions = new Set<number>();
  const disconnects = new Set<Promise<void>>();
  const errors: string[] = [];
  return {
    sessions,
    errors,
    settled: () => Promise.all(disconnects),
    onPeerConnect: (connection: DevframeRpcConnection, session: DevframeNodeRpcSession) => {
      sessions.add(connection.id);
      service().onPeerConnect(connection, session);
    },
    onPeerDisconnect: (connection: DevframeRpcConnection) => {
      sessions.delete(connection.id);
      const pending = service()
        .onPeerDisconnect(connection)
        .catch((error: unknown) => {
          errors.push(String(error));
        })
        .finally(() => {
          disconnects.delete(pending);
        });
      disconnects.add(pending);
    },
  };
}

function createPageServer(getNative: () => DevframeInstance | undefined) {
  return createServer((request, response) => {
    const native = getNative();
    if (native === undefined) {
      response.writeHead(503);
      response.end();
      return;
    }
    native.nodeMiddleware(request, response, () => {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      response.end(
        '<!doctype html><title>Owned remote debugger target</title><p id="result">initial</p>',
      );
    });
  });
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
  if (address === null || typeof address === 'string') throw new Error('Expected loopback server');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
