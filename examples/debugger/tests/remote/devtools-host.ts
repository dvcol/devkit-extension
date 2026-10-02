import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDevToolsContext, createDevToolsHub } from '@vitejs/devtools';
import type { DevToolsHub } from '@vitejs/devtools';
import { normalizeDevToolsConfig } from '@vitejs/devtools/config';
import { resolveConfig } from 'vite';
import { createDefinition } from './definition.ts';
import { closeServer, createPageServer, createPeerLifecycle, listen } from './host.ts';

/** The existing CDB recipe installed into the actual native DevTools kit context and hub. */
export async function createNativeDevToolsHost() {
  await using cleanup = new AsyncDisposableStack();
  const directory = await mkdtemp(join(tmpdir(), 'devkit-cdb-devtools-'));
  cleanup.defer(() => rm(directory, { recursive: true, force: true }));
  const fixture = createDefinition();
  const peers = createPeerLifecycle(fixture.requireService);
  let native: DevToolsHub | undefined;
  const { server, titleReads } = createPageServer(
    () => native && { nodeMiddleware: native.middleware },
  );
  cleanup.defer(() => closeServer(server));
  const origin = await listen(server);
  cleanup.defer(async () => {
    await peers.settled();
    await fixture.dispose();
  });
  const allowedOrigins: string[] = [];
  const context = await createContext(directory, origin, allowedOrigins);
  await context.install(fixture.definition);
  native = await createDevToolsHub({
    context,
    server,
    onPeerConnect: peers.onPeerConnect,
    onPeerDisconnect: peers.onPeerDisconnect,
  });
  cleanup.defer(() => native?.close());
  const lifetime = cleanup.move();
  return {
    baseURL: `${origin}/__devtools/`,
    fixtureUrl: `${origin}/owned-target`,
    titleReads,
    context,
    hub: native.hub,
    service: fixture.requireService(),
    provider: fixture.requireProvider(),
    diagnostics: fixture.diagnostics,
    sessions: peers.sessions,
    errors: peers.errors,
    settled: peers.settled,
    allowExtensionOrigin(extensionOrigin: string) {
      allowedOrigins.push(extensionOrigin);
    },
    close: () => lifetime.disposeAsync(),
  };
}

async function createContext(directory: string, origin: string, allowedOrigins: string[]) {
  const viteConfig = await resolveConfig(
    {
      root: directory,
      configFile: false,
      logLevel: 'silent',
      devtools: false,
      cacheDir: join(directory, 'vite-cache'),
      server: { host: '127.0.0.1', origin },
    },
    'serve',
  );
  return createDevToolsContext(
    viteConfig,
    undefined,
    normalizeDevToolsConfig({ allowedOrigins, mcp: false }, '127.0.0.1'),
  );
}
