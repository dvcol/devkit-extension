import { resolve } from 'node:path';
import { styleText } from 'node:util';

import { build } from 'vite';
import type { InlineConfig, Plugin } from 'vite';

import { ProductionPublication, productionPaths } from './production-output.js';

function publishCompletedBuild(publication: ProductionPublication): void {
  try {
    publication.complete();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    publication.fail(message);
    console.error(styleText('red', '🚧 [production-build]'), 'Publication failed:', error);
    return;
  }
  console.info(styleText('cyan', '🚀 [production-build]'), 'Published a complete build');
}

/** Example policy for one HTML application, one output directory and relative asset URLs. */
export async function watchProduction(config: InlineConfig, directory: string) {
  const output = resolve(directory);
  const publication = new ProductionPublication(output);
  const plugin: Plugin = {
    name: 'devkit:example-production-output',
    buildStart() {
      publication.start();
    },
  };
  try {
    const watcher = await build({
      ...config,
      base: './',
      plugins: [...(config.plugins ?? []), plugin],
      build: {
        ...config.build,
        outDir: productionPaths(output).staging,
        emptyOutDir: true,
        watch: config.build?.watch ?? {},
      },
    });
    if (!('on' in watcher)) throw new Error('Vite did not create a build watcher');
    watcher.on('event', (event) => {
      if (event.code === 'ERROR') {
        publication.fail(event.error.message);
        console.error(styleText('red', '🚧 [production-build]'), event.error.message);
        return;
      }
      if (event.code !== 'BUNDLE_END') return;
      publishCompletedBuild(publication);
    });
    let closing: Promise<void> | undefined;
    return {
      close() {
        closing ??= watcher.close().finally(() => {
          publication.close();
        });
        return closing;
      },
    };
  } catch (error) {
    publication.close();
    throw error;
  }
}
