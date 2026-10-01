import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  productionPreviewPlugin,
  providerFromVite,
  readProductionStatus,
  watchProduction,
} from '@devkit/example-vite-hosts';
import type { ExampleHost } from '@devkit/example-vite-hosts';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { preview } from 'vite';
import { connectPage, counterValue, disconnected } from './browser-counter.ts';

/** Copy the maintained page so genuine source edits never change the checkout's application. */
async function watchedFixture(host: ExampleHost) {
  await using cleanup = new AsyncDisposableStack();
  const artifacts = fileURLToPath(new URL('../artifacts', import.meta.url));
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(join(artifacts, 'watched-browser-'));
  cleanup.defer(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'site');
  const output = join(directory, 'production');
  await cp(fileURLToPath(new URL('../site', import.meta.url)), root, { recursive: true });
  const configFile = fileURLToPath(new URL('../host.config.ts', import.meta.url));
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
  if (address === null || typeof address === 'string') throw new Error('Preview has no address');
  const origin = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(origin)).status, 503);
  const watcher = await watchProduction(
    { configFile, root, mode: 'devframe', logLevel: 'silent' },
    output,
  );
  cleanup.defer(() => watcher.close());
  const lifetime = cleanup.move();
  return { root, output, origin, server, close: () => lifetime.disposeAsync() };
}

async function completed(output: string, after = 0) {
  await expect
    .poll(
      () => {
        const status = readProductionStatus(output);
        return status.phase === 'ready' && status.attempt > after;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return readProductionStatus(output);
}

export async function checkWatchedPreview(first: Page, second: Page, host: ExampleHost) {
  await using cleanup = new AsyncDisposableStack();
  const fixture = await watchedFixture(host);
  cleanup.defer(fixture.close);
  const provider = await providerFromVite(fixture.server);
  const initial = await completed(fixture.output);
  await connectPage(first, fixture.origin, provider.provider);
  await connectPage(second, fixture.origin, provider.provider);
  const firstUrl = first.url();
  const originalHtml = await (await fetch(firstUrl)).text();
  const originalDocument = await first.evaluate(() => performance.timeOrigin);
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counterValue(second, 1);
  const htmlPath = join(fixture.root, 'index.html');
  const html = await readFile(htmlPath, 'utf8');
  await writeFile(
    htmlPath,
    html.replace('<h1>Devkit native Vite hosts</h1>', '<h1>Updated production generation</h1>'),
  );
  const updated = await completed(fixture.output, initial.attempt);
  assert.notEqual(updated.generation, initial.generation);
  assert.equal(await first.evaluate(() => performance.timeOrigin), originalDocument);
  await expect(first.locator('h1')).toHaveText('Devkit native Vite hosts');
  await counterValue(first, 1);
  await second.goto('about:blank');
  await connectPage(second, fixture.origin, provider.provider);
  await expect(second.locator('h1')).toHaveText('Updated production generation');
  await counterValue(second, 1);
  await second.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counterValue(first, 2);
  await counterValue(second, 2);
  assert.deepEqual((await providerFromVite(fixture.server)).provider, provider.provider);
  assert.equal(await (await fetch(firstUrl)).text(), originalHtml);
  await fixture.server.close();
  await disconnected(first);
  await disconnected(second);
  return {
    host,
    mode: 'watched-preview',
    generations: 2,
    finalValue: 2,
    providerRetained: true,
    originalDocumentRetained: true,
    oldAssetsRetained: true,
  };
}
