import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  openDevtoolsPanel,
  selectDevtoolsPanel,
  closeDevtoolsPanel,
} from './chromium-devtools-host.ts';
import type { DevtoolsPanel } from './chromium-devtools-host.ts';

type DevtoolsSession = DevtoolsPanel['panel'];

/** Open the genuine frontend, select its native extension tab, then close and reopen it. */
export async function checkChromiumDevtools(options: Page): Promise<string[]> {
  const browser = options.context();
  const provider = await options.locator('#provider').innerText();
  const { protocol, host } = new URL(options.url());
  const origin = `${protocol}//${host}`;
  const inspected = await browser.newPage();
  await inspected.goto('data:text/html,<h1>Inspected page</h1>');
  const pageSession = await browser.newCDPSession(inspected);
  const { targetInfo } = await pageSession.send('Target.getTargetInfo');
  const control = await browser.browser()!.newBrowserCDPSession();
  try {
    const first = await openDevtoolsPanel({
      control,
      inspectedId: targetInfo.targetId,
      origin,
    });
    const caller = await checkLivePanel({ panel: first, options, provider });
    await closeDevtoolsPanel(control, first);
    assert.equal(inspected.isClosed(), false);
    await options.locator('#release').click();
    await options.locator('#executions').click();
    await expect(options.locator('#result')).toHaveText('{"started":3,"completed":3}');
    const replacement = await openDevtoolsPanel({
      control,
      inspectedId: targetInfo.targetId,
      origin,
    });
    await checkReplacement({ panel: replacement.panel, options, provider, caller });
    const screenshot = await replacement.frontend.send('Page.captureScreenshot');
    assert.ok(
      typeof screenshot === 'object' &&
        screenshot !== null &&
        'data' in screenshot &&
        typeof screenshot.data === 'string',
    );
    await writeFile('artifacts/native-devtools.png', screenshot.data, 'base64');
    await closeDevtoolsPanel(control, replacement);
  } finally {
    await pageSession.detach();
    await control.detach();
    await inspected.close();
  }
  return [
    'native DevTools panel mounts the existing renderer and shares background state',
    'hiding DevTools panel retains its document, connection and live subscriptions',
    'closing DevTools removes its panel and pending action completes without replay',
    'reopened DevTools panel has a new caller, retained provider and working JSON action',
  ];
}

async function checkLivePanel({
  panel,
  options,
  provider,
}: {
  panel: DevtoolsPanel;
  options: Page;
  provider: string;
}): Promise<string> {
  assert.equal(
    await panel.panel.evaluate("document.querySelector('#provider').textContent"),
    provider,
  );
  const caller = await identity(panel.panel);
  const timeOrigin = await panel.panel.evaluate('performance.timeOrigin');
  await increase(panel.panel);
  await expect(options.getByText('Counter: 19', { exact: true })).toBeVisible();
  await selectDevtoolsPanel(panel.frontend, false);
  await options.locator('#routed').click();
  await expect(options.getByText('Counter: 20', { exact: true })).toBeVisible();
  await selectDevtoolsPanel(panel.frontend, true);
  assert.equal(await panel.panel.evaluate('performance.timeOrigin'), timeOrigin);
  assert.equal(await identity(panel.panel), caller);
  await counter(panel.panel, 20);
  await panel.panel.evaluate("document.querySelector('#wait').click()");
  await options.locator('#executions').click();
  await expect(options.locator('#result')).toHaveText('{"started":3,"completed":2}');
  return caller;
}

async function checkReplacement({
  panel,
  options,
  provider,
  caller,
}: {
  panel: DevtoolsSession;
  options: Page;
  provider: string;
  caller: string;
}): Promise<void> {
  assert.equal(await panel.evaluate("document.querySelector('#provider').textContent"), provider);
  assert.notEqual(await identity(panel), caller);
  await counter(panel, 20);
  await increase(panel);
  await expect(options.getByText('Counter: 21', { exact: true })).toBeVisible();
  await options.locator('#executions').click();
  await expect(options.locator('#result')).toHaveText('{"started":3,"completed":3}');
}

async function identity(panel: DevtoolsSession): Promise<string> {
  await panel.evaluate("document.querySelector('#identity').click()");
  await expect
    .poll(() => panel.evaluate("document.querySelector('#result').textContent"))
    .toContain('panel.html');
  const caller = await panel.evaluate("document.querySelector('#result').textContent");
  assert.ok(typeof caller === 'string');
  return caller;
}

async function increase(panel: DevtoolsSession): Promise<void> {
  await panel.evaluate(
    "document.querySelector('#renderer').shadowRoot.querySelector('button').click()",
  );
}

async function counter(panel: DevtoolsSession, value: number): Promise<void> {
  await expect
    .poll(() =>
      panel.evaluate(
        "document.querySelector('#renderer').shadowRoot.querySelector('.devframes-json-render-scroll-root').textContent.match(/Counter:\\s*(\\d+)/)?.[1]",
      ),
    )
    .toBe(String(value));
}
