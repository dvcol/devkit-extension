import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { expect } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { attachDevtoolsSession } from './devtools-session.ts';

type DevtoolsSession = Awaited<ReturnType<typeof attachDevtoolsSession>>;

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
    const first = await openPanel({
      control,
      inspectedId: targetInfo.targetId,
      origin,
    });
    const caller = await checkLivePanel({ panel: first, options, provider });
    await closePanel(control, first);
    assert.equal(inspected.isClosed(), false);
    await options.locator('#release').click();
    await options.locator('#executions').click();
    await expect(options.locator('#result')).toHaveText('{"started":3,"completed":3}');
    const replacement = await openPanel({
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
    await closePanel(control, replacement);
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

type OpenPanel = Awaited<ReturnType<typeof openPanel>>;

async function openPanel({
  control,
  inspectedId,
  origin,
}: {
  control: CDPSession;
  inspectedId: string;
  origin: string;
}) {
  const { targetId } = await control.send('Target.openDevTools', {
    targetId: inspectedId,
    panelId: 'network',
  });
  const frontend = await attachDevtoolsSession(control, targetId);
  await frontend.send('Page.bringToFront');
  await expect
    .poll(async () =>
      (await control.send('Target.getTargets')).targetInfos.some(
        (target) => target.url === `${origin}/devtools.html`,
      ),
    )
    .toBe(true);
  await selectPanel(frontend, true);
  let panelTargetId: string | undefined;
  await expect
    .poll(async () => {
      panelTargetId = (await control.send('Target.getTargets')).targetInfos.find(
        (target) => target.type === 'iframe' && target.url === `${origin}/panel.html`,
      )?.targetId;
      return panelTargetId;
    })
    .toBeDefined();
  assert.ok(panelTargetId !== undefined);
  const panel = await attachDevtoolsSession(control, panelTargetId);
  await expect
    .poll(() => panel.evaluate("document.querySelector('#status')?.textContent"))
    .toBe('Connected');
  return { targetId, panelTargetId, frontend, panel };
}

async function selectPanel(frontend: DevtoolsSession, extension: boolean): Promise<void> {
  /** Native next-panel shortcut also reaches tabs hidden in the overflow menu. */
  const modifiers = process.platform === 'darwin' ? 4 : 2;
  const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  const modifierCode = process.platform === 'darwin' ? 'MetaLeft' : 'ControlLeft';
  const modifierKeyCode = process.platform === 'darwin' ? 91 : 17;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (
      (await frontend.evaluate(`function elements(root) { const found = [...root.querySelectorAll('*')]; for (const element of [...found]) if (element.shadowRoot) found.push(...elements(element.shadowRoot)); return found; }
elements(document).some(element => element.getAttribute('role') === 'tab' && element.getAttribute('aria-selected') === 'true' && element.textContent === 'Devkit')`)) ===
      extension
    )
      return;
    await frontend.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      modifiers,
      key: modifierKey,
      code: modifierCode,
      windowsVirtualKeyCode: modifierKeyCode,
    });
    await frontend.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      modifiers,
      key: ']',
      code: 'BracketRight',
      windowsVirtualKeyCode: 221,
    });
    await frontend.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      modifiers,
      key: ']',
      code: 'BracketRight',
      windowsVirtualKeyCode: 221,
    });
    await frontend.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      modifiers: 0,
      key: modifierKey,
      code: modifierCode,
      windowsVirtualKeyCode: modifierKeyCode,
    });
    await setTimeout(100);
  }
  throw new Error(`Native DevTools did not ${extension ? 'show' : 'hide'} the Devkit tab`);
}

async function checkLivePanel({
  panel,
  options,
  provider,
}: {
  panel: OpenPanel;
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
  await selectPanel(panel.frontend, false);
  await options.locator('#routed').click();
  await expect(options.getByText('Counter: 20', { exact: true })).toBeVisible();
  await selectPanel(panel.frontend, true);
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

async function closePanel(control: CDPSession, panel: OpenPanel): Promise<void> {
  await control.send('Target.closeTarget', { targetId: panel.targetId });
  await expect
    .poll(async () =>
      (await control.send('Target.getTargets')).targetInfos.some(
        (target) => target.targetId === panel.panelTargetId,
      ),
    )
    .toBe(false);
  panel.frontend.dispose();
  panel.panel.dispose();
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
