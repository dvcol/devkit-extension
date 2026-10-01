import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createJsonRenderView } from '@devframes/json-render/view';
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import {
  counterHostPlugins,
  counterPreviewPlugin,
  providerFromVite,
} from '@devkit/example-vite-hosts';
import type { ViteDevToolsNodeContext } from '@vitejs/devtools-kit';
import { getRpcHandler } from 'devframe/rpc';
import { createServer, preview } from 'vite';
import type { Plugin, PreviewServer } from 'vite';
import { describe, expect, it } from 'vitest';

const collisionMessage = 'A JSON-render view with id "counter" already exists in scope "example"';
const commandId = 'example:read-server-counter';
const foreignSpec = {
  root: 'text',
  elements: { text: { type: 'Text', props: { text: 'Foreign counter view' } } },
  state: { value: 42 },
};

/** An independent native plugin owns the view before the example installs its provider. */
function conflictingView() {
  const created = Promise.withResolvers<{
    context: ViteDevToolsNodeContext;
    view: ReturnType<typeof createJsonRenderView<typeof foreignSpec>>;
    commandEvents: string[];
    dispose(): void;
  }>();
  const plugin: Plugin = {
    name: 'test:foreign-counter-view',
    devtools: {
      setup(context) {
        const commandEvents: string[] = [];
        const registered = context.commands.events.on('commands:registered', (command) => {
          if (command.id === commandId) commandEvents.push('registered');
        });
        const unregistered = context.commands.events.on('commands:unregistered', (id) => {
          if (id === commandId) commandEvents.push('unregistered');
        });
        const view = createJsonRenderView(context, {
          id: 'counter',
          scope: 'example',
          title: 'Foreign counter',
          spec: foreignSpec,
        });
        created.resolve({
          context,
          view,
          commandEvents,
          dispose() {
            registered();
            unregistered();
            view.dispose();
          },
        });
      },
    },
  };
  return { plugin, created: created.promise };
}

/** Invoke retained definitions through the public native handler/schema resolver. */
async function invokeNative(
  context: ViteDevToolsNodeContext,
  identity: readonly (string | number)[],
  ...arguments_: readonly unknown[]
): Promise<unknown> {
  const definition = context.rpc.get(`devkit:${JSON.stringify(identity)}`);
  if (definition === undefined) throw new Error('Expected the native exposure definition');
  const handler: unknown = await getRpcHandler(definition, context);
  if (typeof handler !== 'function') throw new Error('Expected the native exposure handler');
  const result: unknown = Reflect.apply(handler, undefined, arguments_);
  return result;
}

async function expectRolledBack(context: ViteDevToolsNodeContext, providerId: string) {
  expect(context.commands.commands.has(commandId)).toBe(false);
  await expect(invokeNative(context, [providerId, 'catalog'])).resolves.toBeUndefined();
  await expect(
    invokeNative(
      context,
      [providerId, 'action', increaseCounterAction.id, increaseCounterAction.version],
      'disposed-incarnation',
      { amount: 1 },
    ),
  ).rejects.toThrow('Exposed provider is unavailable');
  await expect(
    invokeNative(
      context,
      [providerId, 'capability', counterCapability.id, counterCapability.version, 'read'],
      'disposed-incarnation',
      {},
    ),
  ).rejects.toThrow('Exposed provider is unavailable');
}

describe('native view publication failure', () => {
  it('rejects development readiness and rolls back the provider without disposing the foreign view', async () => {
    expect.assertions(12);
    const directory = await mkdtemp(join(tmpdir(), 'devkit-dev-startup-failure-'));
    const collision = conflictingView();
    const server = await createServer({
      configFile: false,
      root: directory,
      logLevel: 'silent',
      devtools: false,
      publicDir: false,
      plugins: [collision.plugin, ...(await counterHostPlugins('devtools'))],
      server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    const foreign = await collision.created;
    try {
      await server.listen();
      await expect(providerFromVite(server)).rejects.toThrow(collisionMessage);
      expect(foreign.commandEvents).toEqual(['registered', 'unregistered']);
      await expectRolledBack(foreign.context, 'example.devtools-vite');
      expect(server.httpServer?.listening).toBe(true);
      const metadata = await fetch(
        new URL('/__devtools/__connection.json', server.resolvedUrls?.local[0]),
      );
      expect(await metadata.json()).toMatchObject({ backend: 'websocket' });
      expect(foreign.context.rpc.sharedState.keys()).toContain(foreign.view.ref.stateKey);
      expect(foreign.view.value()).toEqual(foreignSpec);
      foreign.view.patchState([{ op: 'replace', path: '/value', value: 43 }]);
      expect(foreign.view.value().state).toEqual({ value: 43 });
    } finally {
      foreign.dispose();
      try {
        await expect(server.close()).rejects.toThrow(collisionMessage);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it('rejects preview startup and readiness, rolls back the provider and closes its native transport', async () => {
    expect.assertions(9);
    const directory = await mkdtemp(join(tmpdir(), 'devkit-preview-startup-failure-'));
    const collision = conflictingView();
    const configured = Promise.withResolvers<PreviewServer>();
    let server: PreviewServer | undefined;
    await mkdir(join(directory, 'dist'));
    try {
      await expect(
        preview({
          configFile: false,
          root: directory,
          logLevel: 'silent',
          devtools: false,
          plugins: [
            {
              ...collision.plugin,
              enforce: 'pre',
              configurePreviewServer(current) {
                server = current;
                configured.resolve(current);
              },
            },
            counterPreviewPlugin('devtools'),
          ],
          preview: { host: '127.0.0.1', port: 0 },
        }),
      ).rejects.toThrow(collisionMessage);
      const current = await configured.promise;
      await expect(providerFromVite(current)).rejects.toThrow(collisionMessage);
      const foreign = await collision.created;
      expect(foreign.commandEvents).toEqual(['registered', 'unregistered']);
      await expectRolledBack(foreign.context, 'example.devtools-preview');
      expect(current.httpServer.listening).toBe(false);
      expect(current.httpServer.listenerCount('upgrade')).toBe(0);
      foreign.dispose();
    } finally {
      try {
        await server?.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
});
