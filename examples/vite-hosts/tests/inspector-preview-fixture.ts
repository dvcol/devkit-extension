import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { definePlugin } from '@devkit/core';
import {
  createInspectorActions,
  inspectorCapability,
  inspectorStateKey,
} from '@devkit/example-contribution/inspector';
import type { InspectorState } from '@devkit/example-contribution/inspector';
import { counterPreviewPlugin, providerFromVite } from '@devkit/example-vite-hosts';
import type { ExampleHost } from '@devkit/example-vite-hosts';
import { devframeHubContext, serverExecution } from '@devkit/server';
import type { ServerProviderHandle } from '@devkit/server';
import { build, preview } from 'vite';

import { createInspectorFeature } from '../src/inspector.js';
import { admitted } from './fixtures.js';

async function installInspector(
  provider: ServerProviderHandle,
  feature: ReturnType<typeof createInspectorFeature>,
) {
  const service = admitted(await provider.services.install(feature.service));
  const actions = admitted(
    await provider.plugins.install(createInspectorActions({ execution: serverExecution })),
  );
  const script = admitted(
    await provider.plugins.install(
      definePlugin({ id: 'example.preview-inspector-script', scripts: [feature.script] }),
    ),
  );
  const transform = admitted(
    await provider.plugins.install(
      definePlugin({ id: 'example.preview-inspector-transform', transforms: [feature.transform] }),
    ),
  );
  return { service, actions, script, transform };
}

async function nativeInspectorState(provider: ServerProviderHandle) {
  const resolution = await provider.resolve({ capability: inspectorCapability });
  if (resolution.status !== 'available' || resolution.binding.context.access !== 'local')
    throw new Error('Expected an available native preview inspector');
  const context = resolution.binding.context.native.get(devframeHubContext);
  if (context === undefined) throw new Error('Expected a native preview hub context');
  return context.rpc.sharedState.get<InspectorState>(inspectorStateKey);
}

/** Use the maintained native preview bootstrap and dynamically add this example's definitions. */
export async function inspectorPreviewFixture(host: ExampleHost) {
  await using cleanup = new AsyncDisposableStack();
  const directory = await mkdtemp(join(tmpdir(), 'devkit-inspector-preview-'));
  cleanup.defer(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, 'index.html'),
    '<!doctype html><html><head><title>Built inspector preview</title></head><body>Owned preview fixture</body></html>',
  );
  const feature = createInspectorFeature();
  const options = {
    root: directory,
    configFile: false,
    logLevel: 'silent',
    devtools: false,
  } as const;
  await build({ ...options, publicDir: false, plugins: [feature.plugin] });
  const builtHtml = await readFile(join(directory, 'dist/index.html'), 'utf8');
  const server = await preview({
    ...options,
    plugins: [feature.plugin, counterPreviewPlugin(host)],
    preview: { host: '127.0.0.1', port: 0 },
  });
  cleanup.defer(() => server.close());
  const provider = await providerFromVite(server);
  const handles = await installInspector(provider, feature);
  const state = await nativeInspectorState(provider);
  const address = server.httpServer.address();
  if (address === null || typeof address === 'string')
    throw new Error('Inspector preview did not expose a TCP address');
  const lifetime = cleanup.move();
  return {
    provider,
    handles,
    state,
    builtHtml,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => lifetime.disposeAsync(),
  };
}

export async function previewText(origin: string, path: string) {
  return (await fetch(new URL(path, origin))).text();
}
