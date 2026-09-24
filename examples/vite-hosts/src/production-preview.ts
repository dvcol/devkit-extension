import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Plugin } from 'vite';

import { productionPaths, readProductionStatus } from './production-output.js';

/** Route the example entry page to a completed generation; Vite serves its immutable assets. */
export function productionPreviewPlugin(directory: string): Plugin {
  const output = resolve(directory);
  return {
    name: 'devkit:example-production-preview',
    apply: (_config, environment) => environment.isPreview === true,
    config() {
      mkdirSync(productionPaths(output).published, { recursive: true });
      return { base: '/', build: { outDir: productionPaths(output).published } };
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://preview.local');
        if (!['/', '/index.html', '/__build-status'].includes(url.pathname)) {
          next();
          return;
        }
        try {
          const status = readProductionStatus(output);
          response.setHeader('Cache-Control', 'no-store');
          if (url.pathname === '/__build-status') {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(status));
            return;
          }
          if (status.generation === null) {
            response.statusCode = 503;
            response.end('Waiting for the first complete production build');
            return;
          }
          response.statusCode = 302;
          response.setHeader('Location', `/${status.generation}/index.html${url.search}`);
          response.end();
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
