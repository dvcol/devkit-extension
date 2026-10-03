import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { viteDevframeHub } from '@devframes/vite/hub';
import { definePlugin } from '@devkit/core';
import {
  configureInspectorAction,
  createInspectorActions,
  inspectorCapability,
  inspectorStateKey,
  markInspectorAction,
  readInspectorAction,
  resetInspectorAction,
} from '@devkit/example-contribution/inspector';
import {
  createDevframeProvider,
  createDevToolsProvider,
  devframeHubContext,
  serverExecution,
} from '@devkit/server';
import type { ServerProviderHandle } from '@devkit/server';
import { DevTools } from '@vitejs/devtools';
import { createServer } from 'vite';
import type { Plugin } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { createInspectorFeature } from '../src/inspector.js';
import { admitted } from './fixtures.js';

const marker = 'Reflect.set(globalThis, "responseInspectorMarker", document.readyState);';

async function fixture(host: 'devframe' | 'devtools') {
  await using cleanup = new AsyncDisposableStack();
  await mkdir(new URL('../.conformance/', import.meta.url), { recursive: true });
  const directory = await mkdtemp(`${import.meta.dirname}/../.conformance/inspector-`);
  cleanup.defer(() => rm(directory, { recursive: true, force: true }));
  await writeFile(`${directory}/index.html`, '<!doctype html><head></head><body>Owned page</body>');
  await writeFile(`${directory}/unmatched.txt`, 'unmatched:original');
  const feature = createInspectorFeature();
  const composition = {
    providerId: `example.inspector-${host}`,
    services: [feature.service],
    plugins: [
      createInspectorActions({ execution: serverExecution }),
      definePlugin({ id: 'example.inspector-script', scripts: [feature.script] }),
      definePlugin({ id: 'example.inspector-transform', transforms: [feature.transform] }),
    ],
  };
  let install: (() => Promise<ServerProviderHandle>) | undefined;
  let plugins: Plugin[];
  if (host === 'devframe') {
    plugins = [
      viteDevframeHub({
        ui: false,
        quiet: true,
        mcp: false,
        register: false,
        configure(context) {
          install = () => createDevframeProvider({ context, ...composition });
        },
      }),
    ];
  } else {
    plugins = [
      {
        name: 'test:inspector-provider',
        devtools: {
          setup(context) {
            install = () => createDevToolsProvider({ context, ...composition });
          },
        },
      },
      ...(await DevTools({ builtinDevTools: false })),
    ];
  }
  const server = await createServer({
    configFile: false,
    root: directory,
    logLevel: 'silent',
    publicDir: false,
    plugins: [feature.plugin, ...plugins],
    server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  cleanup.defer(() => server.close());
  await server.listen();
  if (install === undefined) throw new Error('Native Vite host did not supply its context');
  const provider = await install();
  cleanup.defer(() => provider.dispose());
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string')
    throw new Error('Native Vite host has no HTTP address');
  const lifetime = cleanup.move();
  return {
    provider,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => lifetime.disposeAsync(),
  };
}

async function text(origin: string, path: string): Promise<string> {
  return (await fetch(new URL(path, origin))).text();
}

async function nativeStateHost(provider: ServerProviderHandle) {
  const resolution = await provider.resolve({ capability: inspectorCapability });
  if (resolution.status !== 'available' || resolution.binding.context.access !== 'local')
    throw new Error('Expected native inspector service');
  const context = resolution.binding.context.native.get(devframeHubContext);
  if (context === undefined) throw new Error('Expected native inspector state');
  return context.rpc.sharedState;
}

describe.each(['devframe', 'devtools'] as const)('%s response inspector', (host) => {
  it('reads actual owned response bytes and resets configuration and future HTML effects', async () => {
    expect.assertions(14);
    const current = await fixture(host);
    try {
      const { provider, origin } = current;
      const identity = { ...provider.provider };
      const target = `${origin}/inspector-response`;
      const originalHtml = await text(origin, '/');
      expect(originalHtml).not.toContain(marker);
      await expect(provider.invoke({ action: readInspectorAction, input: {} })).resolves.toEqual({
        target,
        configuration: { enabled: false },
        modification: { status: 'available' },
        latest: { url: target, status: 200, body: 'fixture:original' },
        marker: false,
      });
      await expect(
        provider.invoke({ action: configureInspectorAction, input: { enabled: true } }),
      ).resolves.toMatchObject({ configuration: { enabled: true } });
      await expect(
        provider.invoke({ action: readInspectorAction, input: {} }),
      ).resolves.toMatchObject({
        latest: { url: target, status: 200, body: 'native:fixture:original' },
      });
      /** Owned response generation leaves other Vite responses untouched. */
      expect(await text(origin, '/unmatched.txt')).toBe('unmatched:original');
      await expect(
        provider.invoke({ action: markInspectorAction, input: {} }),
      ).resolves.toMatchObject({ marker: true });
      const markedHtml = await text(origin, '/index.html');
      expect(markedHtml).toContain(marker);
      expect(originalHtml).not.toContain(marker);
      expect((await nativeStateHost(provider)).keys()).toContain(inspectorStateKey);
      await expect(provider.invoke({ action: resetInspectorAction, input: {} })).resolves.toEqual({
        target: null,
        configuration: { enabled: false },
        modification: { status: 'available' },
        latest: null,
        marker: false,
      });
      expect(await text(origin, '/inspector-response')).toBe('fixture:original');
      expect(await text(origin, '/')).not.toContain(marker);
      expect(provider.provider).toEqual(identity);
      /** Reset cannot retroactively change an already-received HTML response. */
      expect(markedHtml).toContain(marker);
    } finally {
      await current.close();
    }
  });

  it('owns native effects independently and restores retained state after dependency loss', async () => {
    expect.assertions(15);
    const current = await fixture(host);
    try {
      const { provider, origin } = current;
      const script = admitted(provider.startup.plugins[1]);
      const transform = admitted(provider.startup.plugins[2]);
      const service = admitted(provider.startup.services[0]);
      await provider.invoke({ action: configureInspectorAction, input: { enabled: true } });
      await provider.invoke({ action: markInspectorAction, input: {} });
      await transform.disable();
      expect(await text(origin, '/inspector-response')).toBe('fixture:original');
      expect(await text(origin, '/')).toContain(marker);
      await transform.enable();
      expect(await text(origin, '/inspector-response')).toBe('native:fixture:original');
      await script.disable();
      expect(await text(origin, '/')).not.toContain(marker);
      expect(await text(origin, '/inspector-response')).toBe('native:fixture:original');
      await script.enable();
      expect(await text(origin, '/')).toContain(marker);
      await service.disable();
      expect(await text(origin, '/inspector-response')).toBe('fixture:original');
      expect(await text(origin, '/')).not.toContain(marker);
      await expect(provider.invoke({ action: readInspectorAction, input: {} })).rejects.toThrow(
        'unavailable',
      );
      await service.enable();
      expect(await text(origin, '/inspector-response')).toBe('native:fixture:original');
      expect(await text(origin, '/')).toContain(marker);
      await provider.dispose();
      expect(await text(origin, '/inspector-response')).toBe('fixture:original');
      expect(await text(origin, '/')).not.toContain(marker);
      expect(script.snapshot().status).toBe('disposed');
      expect(transform.snapshot().status).toBe('disposed');
    } finally {
      await current.close();
    }
  });

  it('rejects malformed native state before effects and repairs it only on explicit reset', async () => {
    expect.assertions(17);
    await using cleanup = new AsyncDisposableStack();
    const { provider, origin, close } = await fixture(host);
    cleanup.defer(close);
    const identity = { ...provider.provider };
    const state = await (
      await nativeStateHost(provider)
    ).get<Record<string, unknown>>(inspectorStateKey);
    const malformed = {
      target: null,
      configuration: { enabled: true },
      modification: { status: 'available' },
      latest: { url: `${origin}/inspector-response`, status: 200, body: 42 },
      marker: true,
    };
    state.patch([{ op: 'replace', path: [], value: malformed }]);
    const response = await fetch(`${origin}/inspector-response`);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toBe('native:fixture:original');
    const page = await fetch(origin);
    expect(page.status).toBe(500);
    expect(await page.text()).not.toContain(marker);
    expect(state.value()).toEqual(malformed);
    const unmarked = { ...malformed, marker: false };
    state.patch([{ op: 'replace', path: [], value: unmarked }]);
    await expect(
      provider.invoke({ action: configureInspectorAction, input: { enabled: false } }),
    ).rejects.toThrow('Operation handler failed');
    expect(state.value()).toEqual(unmarked);
    await expect(provider.invoke({ action: markInspectorAction, input: {} })).rejects.toThrow(
      'Operation handler failed',
    );
    expect(state.value()).toEqual(unmarked);
    const requests = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(provider.invoke({ action: readInspectorAction, input: {} })).rejects.toThrow(
        'Operation handler failed',
      );
      expect(requests).not.toHaveBeenCalled();
    } finally {
      requests.mockRestore();
    }
    expect(state.value()).toEqual(unmarked);
    const initial = {
      target: null,
      configuration: { enabled: false },
      modification: { status: 'available' },
      latest: null,
      marker: false,
    };
    await expect(provider.invoke({ action: resetInspectorAction, input: {} })).resolves.toEqual(
      initial,
    );
    state.patch([{ op: 'replace', path: [], value: null }]);
    await expect(provider.invoke({ action: resetInspectorAction, input: {} })).resolves.toEqual(
      initial,
    );
    expect(await text(origin, '/inspector-response')).toBe('fixture:original');
    expect(await text(origin, '/')).not.toContain(marker);
    expect(provider.provider).toEqual(identity);
  });
});
