import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  openChromiumSidebar,
  closeChromiumSidebar,
  sidebarContexts,
} from './chromium-sidebar-host.ts';
import type { ChromiumSidebarHost, ChromiumSidebar } from './chromium-sidebar-host.ts';

type SidebarSession = ChromiumSidebar['panel'];

/** Verify the native global side panel, including its user-gesture gate and document ownership. */
export async function checkChromiumSidebar(options: Page): Promise<string[]> {
  const windowId = await options.evaluate(async () => (await chrome.windows.getCurrent()).id);
  assert.ok(windowId !== undefined);
  const control = await options.context().newCDPSession(options);
  const host = { options, control, windowId };
  try {
    await rejectWithoutGesture(host);
    const provider = await options.locator('#provider').innerText();
    const first = await openChromiumSidebar(host);
    const caller = await checkLiveSidebar(host, first.panel, provider);
    await closeChromiumSidebar(host, first);
    await options.locator('#release').click();
    await options.locator('#executions').click();
    await expect(options.locator('#result')).toHaveText('{"started":4,"completed":4}');
    const replacement = await openChromiumSidebar(host);
    assert.notEqual(replacement.documentId, first.documentId);
    await checkReplacement(host, replacement.panel, provider, caller);
    const screenshot = await replacement.panel.send('Page.captureScreenshot');
    assert.ok(
      typeof screenshot === 'object' &&
        screenshot !== null &&
        'data' in screenshot &&
        typeof screenshot.data === 'string',
    );
    await writeFile('artifacts/native-sidebar.png', screenshot.data, 'base64');
    await closeChromiumSidebar(host, replacement);
  } finally {
    await control.detach();
  }
  return [
    'native side panel rejects opening without an active user gesture',
    'native side panel renders the shared JSON view within its actual narrow viewport',
    'global side panel retains its caller, local form and shared state across tab navigation',
    'closing side panel removes its context while the dispatched action completes once',
    'reopened side panel has a fresh document and caller, retained provider and no replay',
  ];
}

async function rejectWithoutGesture({ control, windowId }: ChromiumSidebarHost): Promise<void> {
  /** CDP must not refresh activation while observing its native expiry. */
  await expect
    .poll(
      async () =>
        (
          await control.send('Runtime.evaluate', {
            expression: 'navigator.userActivation.isActive',
            returnByValue: true,
            userGesture: false,
          })
        ).result.value === true,
      { timeout: 10_000 },
    )
    .toBe(false);
  const response = await control.send('Runtime.evaluate', {
    expression: `chrome.sidePanel.open({windowId:${windowId}}).then(() => 'opened', error => error.message)`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
  });
  assert.equal(response.exceptionDetails, undefined);
  assert.match(String(response.result.value), /user gesture/u);
}

async function checkLiveSidebar(
  host: ChromiumSidebarHost,
  panel: SidebarSession,
  provider: string,
) {
  const { options } = host;
  assert.equal(await panel.evaluate("document.querySelector('#provider').textContent"), provider);
  const caller = await identity(panel);
  const timeOrigin = await panel.evaluate('performance.timeOrigin');
  await increase(panel);
  await expect(options.getByText('Counter: 22', { exact: true })).toBeVisible();
  await panel.evaluate("document.querySelector('#server-id').value = 'local-sidebar-form'");
  const other = await options.context().newPage();
  try {
    await other.goto('data:text/html,<h1>Sidebar companion page</h1>');
    await options.locator('#routed').click();
    await expect(options.getByText('Counter: 23', { exact: true })).toBeVisible();
    await other.bringToFront();
    await other.goto('data:text/html,<h1>Navigated companion page</h1>');
    await counter(panel, 23);
    assert.equal(await panel.evaluate('performance.timeOrigin'), timeOrigin);
    assert.equal(await identity(panel), caller);
    assert.equal(
      await panel.evaluate("document.querySelector('#server-id').value"),
      'local-sidebar-form',
    );
  } finally {
    await other.close();
    await options.bringToFront();
  }
  await panel.evaluate("document.querySelector('#wait').click()");
  await options.locator('#executions').click();
  await expect(options.locator('#result')).toHaveText('{"started":4,"completed":3}');
  return caller;
}

async function checkReplacement(
  { options, windowId }: ChromiumSidebarHost,
  panel: SidebarSession,
  provider: string,
  caller: string,
): Promise<void> {
  assert.equal(await panel.evaluate("document.querySelector('#provider').textContent"), provider);
  assert.notEqual(await identity(panel), caller);
  assert.equal(await panel.evaluate("document.querySelector('#server-id').value"), '');
  await counter(panel, 23);
  const timeOrigin = await panel.evaluate('performance.timeOrigin');
  await options.evaluate((value) => chrome.sidePanel.open({ windowId: value }), windowId);
  assert.equal((await sidebarContexts(options)).length, 1);
  assert.equal(await panel.evaluate('performance.timeOrigin'), timeOrigin);
  await increase(panel);
  await expect(options.getByText('Counter: 24', { exact: true })).toBeVisible();
  await options.locator('#executions').click();
  await expect(options.locator('#result')).toHaveText('{"started":4,"completed":4}');
}

async function identity(panel: SidebarSession): Promise<string> {
  await panel.evaluate("document.querySelector('#identity').click()");
  await expect
    .poll(() => panel.evaluate("document.querySelector('#result').textContent"))
    .toContain('panel.html');
  const caller = await panel.evaluate("document.querySelector('#result').textContent");
  assert.ok(typeof caller === 'string');
  return caller;
}

async function increase(panel: SidebarSession): Promise<void> {
  const bounds = await panel.evaluate(
    "document.querySelector('#renderer').shadowRoot.querySelector('button').getBoundingClientRect().toJSON()",
  );
  assert.ok(
    typeof bounds === 'object' &&
      bounds !== null &&
      'x' in bounds &&
      typeof bounds.x === 'number' &&
      'y' in bounds &&
      typeof bounds.y === 'number' &&
      'width' in bounds &&
      typeof bounds.width === 'number' &&
      bounds.width > 0 &&
      'height' in bounds &&
      typeof bounds.height === 'number' &&
      bounds.height > 0,
  );
  const position = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await panel.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    clickCount: 1,
    ...position,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
    ...position,
  });
}

async function counter(panel: SidebarSession, value: number): Promise<void> {
  await expect
    .poll(() =>
      panel.evaluate(
        "document.querySelector('#renderer').shadowRoot.querySelector('.devframes-json-render-scroll-root').textContent.match(/Counter:\\s*(\\d+)/)?.[1]",
      ),
    )
    .toBe(String(value));
}
