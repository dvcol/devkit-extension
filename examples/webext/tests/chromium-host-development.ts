import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { checkScriptTiming } from './chromium-script-timing.ts';
import { checkChromiumScriptReload } from './chromium-script-reload.ts';
import { checkChromiumPopupDevelopment } from './chromium-popup-development.ts';
import { updateDevtoolsRegistration } from './devtools-registration.ts';
import {
  attachDevtoolsRegistration,
  openDevtoolsPanel,
  closeDevtoolsPanel,
} from './chromium-devtools-host.ts';
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
    const connection = {
      control,
      inspectedId: targetInfo.targetId,
      origin: `${protocol}//${host}`,
    };
    const panel = await openDevtoolsPanel(connection);
    await checkUpdates({ options, panel: panel.panel, fixture, name: 'DevTools', counter: 3 });
    await screenshot(panel.frontend, 'devtools');
    const replacement = await checkRegistrationUpdate({ options, fixture, panel, connection });
    await closeDevtoolsPanel(control, replacement);
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
    await checkUpdates({ options, panel: sidebar.panel, fixture, name: 'Sidebar', counter: 6 });
    await screenshot(sidebar.panel, 'sidebar');
    await closeChromiumSidebar(host, sidebar);
  } finally {
    await control.detach();
  }
}

async function checkRegistrationUpdate({
  options,
  fixture,
  panel,
  connection,
}: {
  options: Page;
  fixture: string;
  panel: DevtoolsPanel;
  connection: { control: CDPSession; inspectedId: string; origin: string };
}): Promise<DevtoolsPanel> {
  const before = await snapshot(panel.panel);
  const registration = await observeRegistrationUpdate({ ...connection, fixture });
  const immediateTitles = await registrationTitles(panel.frontend);
  assert.deepEqual(immediateTitles, ['Devkit']);
  await closeDevtoolsPanel(connection.control, panel);
  const replacement = await openDevtoolsPanel({ ...connection, panelTitle: 'Devkit updated' });
  assert.deepEqual(await registrationTitles(replacement.frontend), ['Devkit updated']);
  const after = await snapshot(replacement.panel);
  assert.notEqual(after.timeOrigin, before.timeOrigin);
  assert.notEqual(after.caller, before.caller);
  assert.equal(after.provider, before.provider);
  assert.equal(after.counter, before.counter);
  await increase({ options, panel: replacement.panel, fixture, name: 'DevTools', counter: 5 }, 6);
  const receipt = {
    ...registration,
    immediateTitles,
    reopenedTitles: await registrationTitles(replacement.frontend),
    before,
    after,
  };
  await writeFile(
    'artifacts/chromium-development/devtools-registration.json',
    JSON.stringify(receipt, null, 2),
  );
  return replacement;
}

async function observeRegistrationUpdate({
  control,
  origin,
  fixture,
}: {
  control: CDPSession;
  origin: string;
  fixture: string;
}) {
  const registration = await attachDevtoolsRegistration(control, origin);
  const expression = '({ title: document.title, timeOrigin: performance.timeOrigin })';
  try {
    const previousRegistration = await registration.evaluate(expression);
    const previousTimeOrigin = await registration.evaluate('performance.timeOrigin');
    await updateDevtoolsRegistration(fixture);
    await expect
      .poll(() => registration.evaluate('document.title'), { timeout: 30_000 })
      .toBe('Updated Devkit DevTools');
    assert.notEqual(await registration.evaluate('performance.timeOrigin'), previousTimeOrigin);
    const updatedRegistration = await registration.evaluate(expression);
    return { previousRegistration, updatedRegistration };
  } finally {
    registration.dispose();
  }
}

async function registrationTitles(frontend: PanelSession): Promise<string[]> {
  const titles =
    await frontend.evaluate(`function elements(root) { const found = [...root.querySelectorAll('*')]; for (const element of [...found]) if (element.shadowRoot) found.push(...elements(element.shadowRoot)); return found; }
elements(document).filter(element => element.getAttribute('role') === 'tab' && element.textContent.startsWith('Devkit')).map(element => element.textContent)`);
  assert.ok(
    Array.isArray(titles) && titles.every((title): title is string => typeof title === 'string'),
  );
  return titles;
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
  assert.deepEqual(
    await panel.evaluate(
      "Array.from(document.querySelector('#renderer').shadowRoot.querySelectorAll('button'), (button) => button.textContent.trim())",
    ),
    ['Increase counter', 'Increase matching domain'],
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
