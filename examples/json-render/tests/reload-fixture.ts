import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsonRenderExample } from '@devkit/example-json-render';
import { serve } from './browser-fixture.ts';

export const reloadChecks = [
  'native CSS HMR retains document and custom mount with shared backend state',
  'invalid renderer source shows the native error overlay with no mount and disabled renderer control',
  'valid source recovers backend actions made during the native transform failure without replay',
  'native renderer-module reload creates a fresh document and retains provider state without replay',
  'updated custom renderer remounts once and each action has one backend effect',
];

/** Real edits use a copy of the maintained page; Vite alone chooses HMR versus page reload. */
export async function createReloadFixture(mode: 'devframe' | 'devtools') {
  await using cleanup = new AsyncDisposableStack();
  await mkdir('.conformance', { recursive: true });
  const directory = await mkdtemp(join('.conformance', 'renderer-reload-'));
  cleanup.defer(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL(`../${directory}/site/`, import.meta.url));
  await cp(fileURLToPath(new URL('../browser/', import.meta.url)), root, { recursive: true });
  const htmlPath = join(root, 'index.html');
  const html = await readFile(htmlPath, 'utf8');
  await writeFile(
    htmlPath,
    html.replace('</head>', '<link rel="stylesheet" href="/reload.css" /></head>'),
  );
  const stylePath = join(root, 'reload.css');
  await writeFile(stylePath, 'h1 { color: rgb(1, 2, 3); }\n');
  const rendererPath = join(root, 'renderer.ts');
  const renderer = await readFile(rendererPath, 'utf8');
  const example = await createJsonRenderExample(mode);
  cleanup.defer(example.close);
  const server = await serve(example, { root });
  cleanup.defer(() => server.close());
  const origin = server.resolvedUrls?.local[0];
  assert.ok(typeof origin === 'string' && origin.length > 0);
  const lifetime = cleanup.move();
  return {
    example,
    origin,
    updateStyle: () => writeFile(stylePath, 'h1 { color: rgb(4, 5, 6); }\n'),
    invalidateRenderer: () =>
      writeFile(rendererPath, `${renderer}\nexport const invalidRenderer = ;\n`),
    updateRenderer: () =>
      writeFile(
        rendererPath,
        renderer.replace(
          'const view = new DomView(context.rpc);',
          "const view = new DomView(context.rpc);\n  view.root.dataset.sourceVersion = 'updated';",
        ),
      ),
    close: () => lifetime.disposeAsync(),
  };
}
