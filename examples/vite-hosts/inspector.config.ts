import { fileURLToPath } from 'node:url';
import { viteDevframeHub } from '@devframes/vite/hub';
import { createDevframeProvider, createDevToolsProvider } from '@devkit/server';
import type { ServerProviderHandle } from '@devkit/server';
import { DevTools } from '@vitejs/devtools';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { createInspectorFeature } from './src/inspector';
import { inspectorComposition } from './src/inspector-composition';
import { inspectorPreviewPlugin } from './src/inspector-preview';

/** Build browser assets independently; native development and preview own their live provider. */
export default defineConfig(async ({ command, mode, isPreview }) => {
  if (mode !== 'devframe' && mode !== 'devtools') throw new Error('Choose devframe or devtools');
  const root = fileURLToPath(new URL('./inspector-site', import.meta.url));
  if (command === 'build') return { root, devtools: false };
  const feature = createInspectorFeature();
  if (isPreview === true)
    return {
      root,
      plugins: [
        feature.plugin,
        inspectorPreviewPlugin({ host: mode, composition: inspectorComposition(feature, mode) }),
      ],
      preview: { host: '127.0.0.1' },
    };
  return { root, plugins: await developmentPlugins(feature, mode), server: { host: '127.0.0.1' } };
});

async function developmentPlugins(
  feature: ReturnType<typeof createInspectorFeature>,
  host: 'devframe' | 'devtools',
): Promise<Plugin[]> {
  const contributions = inspectorComposition(feature, host);
  let provider: Promise<ServerProviderHandle> | undefined;
  const lifetime: Plugin = {
    name: 'devkit:example-inspector-lifetime',
    async closeServer() {
      await (await provider)?.dispose();
    },
  };
  const plugins: Plugin[] = [feature.plugin, lifetime];
  if (host === 'devframe') {
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
  return plugins;
}
