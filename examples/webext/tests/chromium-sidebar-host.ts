import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { attachTargetSession } from './target-session.ts';

export type ChromiumSidebarHost = { options: Page; control: CDPSession; windowId: number };
export type ChromiumSidebar = Awaited<ReturnType<typeof openChromiumSidebar>>;

export async function openChromiumSidebar({ options, control, windowId }: ChromiumSidebarHost) {
  const existing = new Set(
    (await control.send('Target.getTargets')).targetInfos.map((target) => target.targetId),
  );
  /** Playwright supplies a user gesture to this native API call. */
  await options.evaluate((value) => chrome.sidePanel.open({ windowId: value }), windowId);
  await expect.poll(async () => (await sidebarContexts(options)).length).toBe(1);
  const context = (await sidebarContexts(options))[0]!;
  assert.equal(context.documentUrl, options.url());
  assert.ok(context.documentId !== undefined);
  let targetId: string | undefined;
  await expect
    .poll(async () => {
      targetId = (await control.send('Target.getTargets')).targetInfos.find(
        (target) =>
          !existing.has(target.targetId) &&
          target.type === 'page' &&
          target.url === context.documentUrl,
      )?.targetId;
      return targetId;
    })
    .toBeDefined();
  assert.ok(targetId !== undefined);
  const panel = await attachTargetSession(control, targetId);
  await expect
    .poll(() => panel.evaluate("document.querySelector('#status')?.textContent"))
    .toBe('Connected');
  await expect
    .poll(() =>
      panel.evaluate('innerWidth > 0 && document.documentElement.scrollWidth <= innerWidth'),
    )
    .toBe(true);
  return { targetId, documentId: context.documentId, panel };
}

export async function closeChromiumSidebar(
  { options, windowId, control }: ChromiumSidebarHost,
  sidebar: ChromiumSidebar,
) {
  await options.evaluate((value) => chrome.sidePanel.close({ windowId: value }), windowId);
  await expect.poll(async () => (await sidebarContexts(options)).length).toBe(0);
  await expect
    .poll(async () =>
      (await control.send('Target.getTargets')).targetInfos.some(
        (target) => target.targetId === sidebar.targetId,
      ),
    )
    .toBe(false);
  sidebar.panel.dispose();
}

export function sidebarContexts(options: Page) {
  return options.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }));
}
