import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { checkScriptTiming } from './chromium-script-timing.ts';
import { checkChromiumScriptReload } from './chromium-script-reload.ts';
import { checkChromiumPopupDevelopment } from './chromium-popup-development.ts';
import { openDevtoolsPanel, closeDevtoolsPanel } from './chromium-devtools-host.ts';
import type { DevtoolsPanel } from './chromium-devtools-host.ts';
import { openChromiumSidebar, closeChromiumSidebar } from './chromium-sidebar-host.ts';

type PanelSession = DevtoolsPanel['panel'];
type DevelopmentHost = {
  options: Page;
  panel: PanelSession;
  fixture: string;
  name: string;
  counter: number;
};

/** Keep native hosts open while WXT replaces their module and reloads their HTML. */
export async function checkChromiumHostDevelopment(options: Page, fixture: string): Promise<Page> {
  await checkScriptTiming(options, 'artifacts/chromium-development');
  await checkChromiumPopupDevelopment(options, fixture);
  await checkDevtools(options, fixture);
  await checkSidebar(options, fixture);
  return checkChromiumScriptReload(options, fixture);
}

async function checkDevtools(options: Page, fixture: string): Promise<void> {
  const browser = options.context();
  const inspected = await browser.newPage();
  await inspected.goto('data:text/html,<h1>Development inspected page</h1>');
  const pageSession = await browser.newCDPSession(inspected);
  const { targetInfo } = await pageSession.send('Target.getTargetInfo');
  const control = await browser.browser()!.newBrowserCDPSession();
  try {
    const { protocol, host } = new URL(options.url());
    const panel = await openDevtoolsPanel({
      control,
      inspectedId: targetInfo.targetId,
      origin: `${protocol}//${host}`,
    });
    await checkUpdates({ options, panel: panel.panel, fixture, name: 'DevTools', counter: 3 });
    await screenshot(panel.frontend, 'devtools');
    await closeDevtoolsPanel(control, panel);
    assert.equal(inspected.isClosed(), false);
  } finally {
    await pageSession.detach();
    await control.detach();
    await inspected.close();
  }
}

async function checkSidebar(options: Page, fixture: string): Promise<void> {
  const windowId = await options.evaluate(async () => (await chrome.windows.getCurrent()).id);
  assert.ok(windowId !== undefined);
  const control = await options.context().newCDPSession(options);
  const host = { options, control, windowId };
  try {
    const sidebar = await openChromiumSidebar(host);
    await checkUpdates({ options, panel: sidebar.panel, fixture, name: 'Sidebar', counter: 5 });
    await screenshot(sidebar.panel, 'sidebar');
    await closeChromiumSidebar(host, sidebar);
  } finally {
    await control.detach();
  }
}

async function checkUpdates(host: DevelopmentHost): Promise<void> {
  const { options, panel, counter } = host;
  const before = await snapshot(panel);
  assert.equal(before.provider, await options.locator('#provider').innerText());
  assert.equal(before.counter, String(counter));
  await panel.evaluate("document.querySelector('#server-id').value = 'host-local-form'");
  await updateModule(host);
  const updated = await snapshot(panel);
  assert.equal(updated.timeOrigin, before.timeOrigin);
  assert.equal(updated.provider, before.provider);
  assert.notEqual(updated.caller, before.caller);
  assert.equal(updated.counter, String(counter));
  assert.equal(
    await panel.evaluate("document.querySelector('#server-id').value"),
    'host-local-form',
  );
  await increase(host, counter + 1);
  await updateHtml(host);
  const reloaded = await snapshot(panel);
  assert.notEqual(reloaded.timeOrigin, updated.timeOrigin);
  assert.equal(reloaded.provider, before.provider);
  assert.notEqual(reloaded.caller, updated.caller);
  assert.equal(reloaded.counter, String(counter + 1));
  assert.equal(await panel.evaluate("document.querySelector('#server-id').value"), '');
  await increase(host, counter + 2);
}

async function updateModule({ options, panel, fixture }: DevelopmentHost): Promise<void> {
  const marker = crypto.randomUUID();
  await appendFile(
    join(fixture, 'src/panel.ts'),
    `\ndocument.body.dataset.hostDevelopment = ${JSON.stringify(marker)};\n`,
  );
  await expect
    .poll(() => panel.evaluate('document.body.dataset.hostDevelopment'), { timeout: 30_000 })
    .toBe(marker);
  await expect(options.locator('body')).toHaveAttribute('data-host-development', marker);
  await expect
    .poll(() => panel.evaluate("document.querySelector('#status').textContent"))
    .toBe('Connected');
}

async function updateHtml({ options, panel, fixture, name }: DevelopmentHost): Promise<void> {
  const path = join(fixture, 'entrypoints/panel.html');
  const html = await readFile(path, 'utf8');
  const heading = `${name} native HTML reload`;
  const updated = html.replace(/<h1>[^<]+<\/h1>/u, `<h1>${heading}</h1>`);
  assert.notEqual(updated, html);
  await writeFile(path, updated);
  await expect
    .poll(() => panel.evaluate("document.querySelector('h1')?.textContent"), { timeout: 30_000 })
    .toBe(heading);
  await expect(options.getByRole('heading', { name: heading })).toBeVisible();
  await expect
    .poll(() => panel.evaluate("document.querySelector('#status').textContent"))
    .toBe('Connected');
}

async function snapshot(panel: PanelSession) {
  await panel.evaluate("document.querySelector('#identity').click()");
  await expect
    .poll(() => panel.evaluate("document.querySelector('#result').textContent"))
    .toContain('panel.html');
  return {
    timeOrigin: await panel.evaluate('performance.timeOrigin'),
    provider: await panel.evaluate("document.querySelector('#provider').textContent"),
    caller: await panel.evaluate("document.querySelector('#result').textContent"),
    counter: await renderedCounter(panel),
  };
}

async function increase({ options, panel }: DevelopmentHost, counter: number): Promise<void> {
  assert.equal(
    await panel.evaluate(
      "document.querySelector('#renderer').shadowRoot.querySelectorAll('button').length",
    ),
    1,
  );
  await panel.evaluate(
    "document.querySelector('#renderer').shadowRoot.querySelector('button').click()",
  );
  await expect.poll(() => renderedCounter(panel)).toBe(String(counter));
  await expect(options.getByText(`Counter: ${counter}`, { exact: true })).toBeVisible();
}

function renderedCounter(panel: PanelSession): Promise<unknown> {
  return panel.evaluate(
    "document.querySelector('#renderer')?.shadowRoot?.querySelector('.devframes-json-render-scroll-root')?.textContent.match(/Counter:\\s*(\\d+)/)?.[1]",
  );
}

async function screenshot(panel: PanelSession, name: string): Promise<void> {
  const captured = await panel.send('Page.captureScreenshot');
  assert.ok(
    typeof captured === 'object' &&
      captured !== null &&
      'data' in captured &&
      typeof captured.data === 'string',
  );
  await writeFile(`artifacts/chromium-development/${name}.png`, captured.data, 'base64');
}
