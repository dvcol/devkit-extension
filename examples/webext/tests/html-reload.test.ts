import { appendFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Plugin } from 'vite';
import { createServer } from 'wxt';
import { availablePort, createDevelopmentFixture } from './development-fixture.ts';

it('reloads changed HTML output, including transform dependencies and missing snapshots', async () => {
  expect.assertions(3);
  const fixture = await createDevelopmentFixture();
  const panelPath = join(fixture, 'entrypoints/panel.html');
  const server = await createServer({
    root: fixture,
    browser: 'chrome',
    webExt: { disabled: true },
    dev: { server: { port: await availablePort() } },
    vite: () => ({ plugins: [sharedHtmlTransform(panelPath)] }),
  });
  const reload = vi.spyOn(server, 'reloadPage');
  try {
    await server.start();
    await appendFile(panelPath, '\n<!-- panel-only -->\n');
    await vi.waitUntil(() => reload.mock.calls.length > 0, { timeout: 30_000 });
    expect(reload.mock.calls).toEqual([['panel.html']]);
    reload.mockClear();
    await appendFile(panelPath, '\n<!-- shared-transform -->\n');
    await vi.waitUntil(() => reload.mock.calls.length >= 2, { timeout: 30_000 });
    expect(reload.mock.calls.map(([path]) => path).toSorted()).toEqual([
      'devtools.html',
      'panel.html',
    ]);
    reload.mockClear();
    await rm(join(fixture, '.output/chrome-mv3-dev/devtools.html'));
    await appendFile(panelPath, '\n<!-- missing-output -->\n');
    await vi.waitUntil(() => reload.mock.calls.length >= 2, { timeout: 30_000 });
    expect(reload.mock.calls.map(([path]) => path).toSorted()).toEqual([
      'devtools.html',
      'panel.html',
    ]);
  } finally {
    await server.stop();
    await rm(fixture, { recursive: true, force: true });
  }
}, 60_000);

function sharedHtmlTransform(panelPath: string): Plugin {
  return {
    name: 'test-shared-html-transform',
    async transformIndexHtml(html, context) {
      if (!context.filename.endsWith('/devtools.html')) return html;
      const source = await readFile(panelPath, 'utf8');
      return html.replace(
        '</body>',
        `<!-- shared: ${source.includes('shared-transform')} --></body>`,
      );
    },
  };
}
