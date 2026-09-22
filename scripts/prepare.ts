import { exec } from 'node:child_process';

import { mergeJson } from '@dvcol/web-extension-utils/node/file';
import { watch } from 'chokidar';
import fs from 'fs-extra';

import { writeManifest } from './manifest';
import { getDirName, isDev, outDir, resolveParent } from './utils';

/**
 * Replace index.html with link to vite localhost for hot reload
 * @param view the view to replace
 */
async function copyIndexHtml(view: string) {
  fs.ensureDirSync(resolveParent(`${outDir}/views/${view}`));
  const data = fs.readFileSync(resolveParent(`src/views/${view}/index.html`), 'utf-8').replace(
    '<script type="module" src="./main.ts"></script>',
    `<script type="module" src="http://localhost:3303/@vite/client"></script>
    <script type="module" src="http://localhost:3303/views/${view}/main.ts"></script>`,
  );
  fs.writeFileSync(resolveParent(`${outDir}/views/${view}/index.html`), data, 'utf-8');
  console.info(`Stubbing '${view}' to '${getDirName()}/${outDir}/views/${view}/index.html'`);
}

/**
 * copy index.html to use Vite in development
 */
const copyViews = async (views = ['options', 'popup', 'panel']) => views.map(copyIndexHtml);

/**
 * Copy extension icons to outDir folder
 */
async function copyIcons(_isDev: boolean) {
  if (_isDev) return fs.symlink(resolveParent('icons'), resolveParent(`${outDir}/icons`), 'junction');
  return fs.copySync('icons', `${outDir}/icons`, { overwrite: true });
}

/**
 * Copy extension icons to outDir folder
 */
const copyAssets = async () => fs.symlink(resolveParent('src/assets'), resolveParent(`${outDir}/assets`), 'junction');

/**
 * Prepare outDir folder with manifest.json and views
 */
async function prepare(hmr = isDev) {
  writeManifest().catch(e => console.error('Failed to write manifest.json', e));

  copyIcons(isDev).catch(e => console.error('Failed to copy extension icons', e));

  mergeJson({
    pattern: 'src/i18n/en/**/*.json',
    output: `${outDir}/_locales/en/messages.json`,
  }).catch((e: Error) => console.error('Failed to merge jsons', e));

  if (hmr) {
    console.info('Watching changes ...');

    copyViews().catch(e => console.error('Failed to copy html', e));
    watch(resolveParent('src/**/*.html')).on('change', () => {
      copyViews().catch(e => console.error('Failed to copy html', e));
    });

    watch([resolveParent('src/manifest.ts'), resolveParent('package.json')]).on('change', () => {
      writeManifest().catch(e => console.error('Failed to write manifest.json', e));
    });

    exec('vite build');
    watch(resolveParent('src/script/**/*.ts')).on('change', () => {
      try {
        exec('vite build');
      } catch (e) {
        console.error('Failed to write manifest.json', e);
      }
    });

    watch([resolveParent('src/i18n/en/**/*.json')]).on('change', () => {
      mergeJson({
        pattern: 'src/i18n/en/**/*.json',
        output: `${outDir}/_locales/en/messages.json`,
      }).catch((e: Error) => console.error('Failed to merge jsons', e));
    });

    copyAssets().catch(e => console.error('Failed to write assets', e));
  }
}

prepare().catch(e => console.error(`Failed to prepare ${outDir} folder`, e));
