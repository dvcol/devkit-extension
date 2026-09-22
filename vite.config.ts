import type { PluginOption } from 'vite';

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { checker } from 'vite-plugin-checker';
import dtsPlugin from 'vite-plugin-dts';
import { VitePWA } from 'vite-plugin-pwa';

import pkg from './package.json';
import { isDev, isWeb, outDir, port, resolveParent, sourcemap } from './scripts/utils';

function getInput(hmr: boolean, _isWeb: boolean): Record<string, string> {
  if (hmr) return { background: resolveParent('src/scripts/background/index.ts') };

  if (_isWeb) return {
    web: resolveParent('src/index.html'),
    lib: resolveParent('src/index.ts'),
    entry: resolveParent('src/web/define-component.ts'),
  };
  return {
    background: resolveParent('src/scripts/background/index.ts'),
    options: resolveParent('src/views/options/index.html'),
    popup: resolveParent('src/views/popup/index.html'),
    panel: resolveParent('src/views/panel/index.html'),
  };
}

const i18nRegex = /.*src\/i18n\/([a-zA-Z]+)\/.*\.json/;
const slashRegex = /\\/g;
const htmlRegex = /"\/assets\//g;

type JsonLocale = Record<string, string>;
function getPlugins(_isDev: boolean, _isWeb: boolean): PluginOption[] {
  const plugins: PluginOption[] = [
    vue({
      features: {
        customElement: true,
      },
    }),
    checker({
      vueTsc: {
        tsconfigPath: 'tsconfig.app.json',
      },
    }),
    {
      name: 'i18n-hmr',
      configureServer: (server) => {
        console.info('server start');
        server.ws.on('fetch:i18n', async () => {
          const dir = await readdir(`${outDir}/_locales`);
          const locales = dir.map(async _lang =>
            readFile(`${outDir}/_locales/${_lang}/messages.json`, { encoding: 'utf-8' }).then(locale => ({ lang: _lang, locale: JSON.parse(locale) as JsonLocale })),
          );
          server.ws.send({
            type: 'custom',
            event: 'update:i18n',
            data: await Promise.all(locales),
          });
        });
      },
      handleHotUpdate: async ({ server, file, read, modules }) => {
        const lang = file.match(i18nRegex)?.[1];
        if (typeof lang !== 'string') return modules;
        console.info('Emit new i18n', file);
        const locale = JSON.parse(await read()) as JsonLocale;
        server.ws.send({
          type: 'custom',
          event: 'update:i18n',
          data: [{ lang, locale }],
        });
        return modules;
      },
    },
    // rewrite assets to use relative path
    {
      name: 'assets-rewrite',
      enforce: 'post',
      apply: 'build',
      transformIndexHtml: (html, { path }) => html.replace(htmlRegex, `"${relative(dirname(path), '/assets').replace(slashRegex, '/')}/`),
    },

    {
      name: 'write-to-disk',
      apply: 'serve',
      handleHotUpdate: async ({ file, server: { config } }) => {
        const srcDir = dirname(file);
        if (!srcDir?.endsWith('src/scripts/background')) return;
        const outPath = `${join(config.build.outDir, 'scripts/background')}.js`;
        await writeFile(outPath, `import 'http://localhost:3303/scripts/background/index.ts';`);
      },
    },
  ];

  if (!_isDev && _isWeb) {
    plugins.push(
      dtsPlugin({
        tsconfigPath: resolveParent('tsconfig.app.json'),
        include: ['index.ts', 'web/define-component.ts'],
        entryRoot: resolveParent('src'),
        outDir: resolveParent(`${outDir}/lib`),
      }),
      VitePWA({
        scope: '/web-extension-template/',
        registerType: 'autoUpdate',
        includeAssets: ['**/favicon.ico', '**/*.svg', '**/*.png', '**/*.webp', '**/*.json'],
        manifest: {
          name: pkg.title || pkg.name,
          short_name: 'Web Extension Template',
          description: pkg.description,
          theme_color: '#41b883',
          background_color: '#ffffff',
          display: 'standalone',
          icons: [
            {
              src: 'icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
          ],
        },
        workbox: {
          sourcemap: (isDev || sourcemap),
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json,mp4}'],
        },
      }),
    );
  }

  return plugins;
}

export default defineConfig(() => ({
  root: resolveParent('src'),
  envDir: resolveParent('env'),
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    '__DEV__': isDev,
    '__VUE_OPTIONS_API__': false,
    '__VUE_PROD_DEVTOOLS__': isDev,
    'import.meta.env.PKG_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.PKG_NAME': JSON.stringify(pkg.name),
  },
  devtools: {
    enabled: process.env.VITE_DEVTOOLS === 'true',
  },
  plugins: getPlugins(isDev, isWeb),
  base: process.env.VITE_BASE || './',
  server: {
    port,
    open: true,
    host: true,
    hmr: {
      host: 'localhost',
    },
  },
  preview: {
    port: port + 1,
    cors: true,
    open: true,
    host: true,
  },
  build: {
    outDir: resolveParent(outDir),
    sourcemap: (isDev || sourcemap) ? 'inline' : false,
    minify: false,
    rollupOptions: {
      input: getInput(isDev, isWeb),
      output: {
        minifyInternalExports: false,
        chunkFileNames: 'chunks/[name]-[hash].chunk.js',
        entryFileNames: (entry) => {
          if (entry.name === 'background') return 'scripts/[name].js';
          if (entry.name === 'entry') return 'entry/index.js';
          if (entry.name === 'lib') return 'lib/index.js';
          return 'scripts/[name]-[hash].js';
        },
        assetFileNames: (asset) => {
          const format = '[name][extname]';
          if (asset.name?.endsWith('css')) return `styles/${format}`;
          return 'assets/[name][extname]';
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      reportsDirectory: './coverage',
    },
    setupFiles: ['./vitest.setup.ts'],
  },
  optimizeDeps: {
    exclude: ['path', 'fast-glob'],
  },
}));
