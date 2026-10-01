import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { expect } from '@playwright/test';
import type { CDPSession } from '@playwright/test';
import { attachTargetSession } from './target-session.ts';

type DevtoolsSession = Awaited<ReturnType<typeof attachTargetSession>>;
export type DevtoolsPanel = Awaited<ReturnType<typeof openDevtoolsPanel>>;

/** Native extension view enumeration excludes the hidden registration document. */
export async function attachDevtoolsRegistration(control: CDPSession, origin: string) {
  const { targetInfos } = await control.send('Target.getTargets');
  const target = targetInfos.find((candidate) => candidate.url === `${origin}/devtools.html`);
  assert.ok(target);
  return attachTargetSession(control, target.targetId);
}

export async function openDevtoolsPanel({
  control,
  inspectedId,
  origin,
  panelTitle = 'Devkit',
}: {
  control: CDPSession;
  inspectedId: string;
  origin: string;
  panelTitle?: string;
}) {
  const { targetId } = await control.send('Target.openDevTools', {
    targetId: inspectedId,
    panelId: 'network',
  });
  const frontend = await attachTargetSession(control, targetId);
  await frontend.send('Page.bringToFront');
  await expect
    .poll(async () =>
      (await control.send('Target.getTargets')).targetInfos.some(
        (target) => target.url === `${origin}/devtools.html`,
      ),
    )
    .toBe(true);
  await selectDevtoolsPanel(frontend, true, panelTitle);
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
  const panel = await attachTargetSession(control, panelTargetId);
  await expect
    .poll(() => panel.evaluate("document.querySelector('#status')?.textContent"))
    .toBe('Connected');
  return { targetId, panelTargetId, frontend, panel };
}

export async function selectDevtoolsPanel(
  frontend: DevtoolsSession,
  extension: boolean,
  panelTitle = 'Devkit',
): Promise<void> {
  /** Native next-panel shortcut also reaches tabs hidden in the overflow menu. */
  const modifiers = process.platform === 'darwin' ? 4 : 2;
  const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  const modifierCode = process.platform === 'darwin' ? 'MetaLeft' : 'ControlLeft';
  const modifierKeyCode = process.platform === 'darwin' ? 91 : 17;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (
      (await frontend.evaluate(`function elements(root) { const found = [...root.querySelectorAll('*')]; for (const element of [...found]) if (element.shadowRoot) found.push(...elements(element.shadowRoot)); return found; }
elements(document).some(element => element.getAttribute('role') === 'tab' && element.getAttribute('aria-selected') === 'true' && element.textContent === ${JSON.stringify(panelTitle)})`)) ===
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
  throw new Error(`Native DevTools did not ${extension ? 'show' : 'hide'} the ${panelTitle} tab`);
}

export async function closeDevtoolsPanel(control: CDPSession, panel: DevtoolsPanel): Promise<void> {
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
