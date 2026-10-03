import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  productionPreviewPlugin,
  readProductionStatus,
  watchProduction,
} from '@devkit/example-vite-hosts';
import type { ProductionStatus } from '@devkit/example-vite-hosts';
import { expect } from '@playwright/test';
import { preview } from 'vite';

/** Copy the authored page; only Vite and the existing publication policy watch and serve edits. */
export async function inspectorProductionFixture(host: 'devframe' | 'devtools') {
  await using cleanup = new AsyncDisposableStack();
  await mkdir('artifacts', { recursive: true });
  const directory = await mkdtemp(join('artifacts', 'inspector-production-'));
  cleanup.defer(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL(`../${directory}/site`, import.meta.url));
  const output = join(root, '../production');
  await mkdir(root, { recursive: true });
  for (const name of ['index.html', 'main.ts'])
    await cp(
      fileURLToPath(new URL(`../inspector-site/${name}`, import.meta.url)),
      join(root, name),
    );
  const configFile = fileURLToPath(new URL('../inspector.config.ts', import.meta.url));
  const server = await preview({
    configFile,
    root,
    mode: host,
    logLevel: 'silent',
    plugins: [productionPreviewPlugin(output)],
    preview: { host: '127.0.0.1', port: 0 },
  });
  cleanup.defer(() => server.close());
  const address = server.httpServer.address();
  assert.ok(address !== null && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(origin)).status, 503);
  assert.equal(readProductionStatus(output).phase, 'starting');
  const watcher = await watchProduction(
    { configFile, root, mode: 'devframe', logLevel: 'silent' },
    output,
  );
  cleanup.defer(() => watcher.close());
  const sourcePath = join(root, 'main.ts');
  const source = await readFile(sourcePath, 'utf8');
  const lifetime = cleanup.move();
  return {
    origin,
    output,
    server,
    invalidate: () => writeFile(sourcePath, `${source}\nexport const invalidInspector = ;\n`),
    recover: () =>
      writeFile(
        sourcePath,
        `${source}\ndocument.querySelector('h1')!.textContent = 'Updated production inspector';\n`,
      ),
    close: () => lifetime.disposeAsync(),
  };
}

export async function settledInspectorBuild(
  output: string,
  phase: ProductionStatus['phase'],
  after = 0,
) {
  await expect
    .poll(
      () => {
        const status = readProductionStatus(output);
        return status.phase === phase && status.attempt > after;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return readProductionStatus(output);
}

export async function inspectorAssets(url: string) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const html = await response.text();
  const script = /<script\b[^>]*\bsrc="([^"]+)"/u.exec(html)?.[1];
  assert.ok(script !== undefined);
  const scriptUrl = new URL(script, response.url).href;
  const javascript = await fetch(scriptUrl);
  assert.equal(javascript.status, 200);
  return { url: response.url, html, scriptUrl, javascript: await javascript.text() };
}
