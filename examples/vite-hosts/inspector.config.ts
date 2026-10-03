import { fileURLToPath } from 'node:url';
import { viteDevframeHub } from '@devframes/vite/hub';
import { definePlugin } from '@devkit/core';
import {
  configureInspectorAction,
  createInspectorActions,
  inspectorCapability,
  markInspectorAction,
  readInspectorAction,
  resetInspectorAction,
} from '@devkit/example-contribution/inspector';
import { createInspectorView } from '@devkit/example-json-render/inspector';
import {
  createDevframeProvider,
  createDevToolsProvider,
  devframeHubContext,
  serverExecution,
} from '@devkit/server';
import type { ServerProviderHandle } from '@devkit/server';
import { DevTools } from '@vitejs/devtools';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { createInspectorFeature } from './src/inspector';

function composition(feature: ReturnType<typeof createInspectorFeature>, host: string) {
  return {
    providerId: `example.${host}-inspector`,
    services: [feature.service],
    plugins: [
      createInspectorActions({ execution: serverExecution }),
      definePlugin({
        id: 'example.inspector-native',
        scripts: [feature.script],
        transforms: [feature.transform],
        views: [
          createInspectorView({ execution: serverExecution, nativeContext: devframeHubContext }),
        ],
      }),
    ],
    expose: {
      capabilities: [inspectorCapability],
      actions: [
        readInspectorAction,
        configureInspectorAction,
        markInspectorAction,
        resetInspectorAction,
      ],
    },
  };
}

/** A separate native development configuration; the counter example keeps its existing defaults. */
export default defineConfig(async ({ command, mode, isPreview }) => {
  if (mode !== 'devframe' && mode !== 'devtools') throw new Error('Choose devframe or devtools');
  if (command !== 'serve' || isPreview === true)
    throw new Error('The standalone inspector currently supports native development servers');
  const feature = createInspectorFeature();
  const contributions = composition(feature, mode);
  let provider: Promise<ServerProviderHandle> | undefined;
  const lifetime: Plugin = {
    name: 'devkit:example-inspector-lifetime',
    async closeServer() {
      await (await provider)?.dispose();
    },
  };
  const plugins: Plugin[] = [feature.plugin, lifetime];
  if (mode === 'devframe') {
    plugins.push(
      viteDevframeHub({
        ui: false,
        quiet: true,
        mcp: false,
        register: false,
        async configure(context) {
          provider = createDevframeProvider({ context, ...contributions });
          await provider;
        },
      }),
    );
  } else {
    lifetime.devtools = {
      async setup(context) {
        provider = createDevToolsProvider({ context, ...contributions });
        await provider;
      },
    };
    plugins.push(...(await DevTools({ builtinDevTools: false })));
  }
  return {
    root: fileURLToPath(new URL('./inspector-site', import.meta.url)),
    plugins,
    server: { host: '127.0.0.1' },
  };
});
