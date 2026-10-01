import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { CDPSession, Page } from '@playwright/test';
import { z } from 'zod';
import { poll } from './driver.ts';

const responseSchema = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
const documentSchema = z.object({
  result: z.object({
    value: z.object({
      title: z.literal('DevTools'),
      ready: z.literal('complete'),
      text: z.string(),
    }),
  }),
});

/** The native DevTools frontend is an `other` target, outside Playwright's Page collection. */
async function frontendCommand(
  session: CDPSession,
  { sessionId, method, parameters }: { sessionId: string; method: string; parameters: object },
) {
  let resolveResponse: ((value: unknown) => void) | undefined;
  const response = new Promise<unknown>((resolve) => {
    resolveResponse = resolve;
  });
  const listener = (event: { sessionId: string; message: string }) => {
    if (event.sessionId !== sessionId) return;
    const parsed = responseSchema.safeParse(JSON.parse(event.message));
    if (parsed.success && parsed.data.id === 1) resolveResponse?.(parsed.data);
  };
  const timeout = new AbortController();
  session.on('Target.receivedMessageFromTarget', listener);
  try {
    await session.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id: 1, method, params: parameters }),
    });
    const result = responseSchema.parse(
      await Promise.race([
        response,
        delay(5_000, undefined, { signal: timeout.signal }).then(() => {
          throw new Error(`Native DevTools ${method} timed out`);
        }),
      ]),
    );
    assert.equal(result.error, undefined);
    return result.result;
  } finally {
    timeout.abort();
    session.off('Target.receivedMessageFromTarget', listener);
  }
}

/** Public browser CDP opens the real frontend; standard DOM reads establish rendered readiness. */
export async function openNativeDevTools(target: Page, screenshot: string) {
  await using cleanup = new AsyncDisposableStack();
  const browser = target.context().browser();
  assert.ok(browser);
  const session = await browser.newBrowserCDPSession();
  cleanup.defer(() => session.detach());
  const targets = await session.send('Target.getTargets');
  const inspected = targets.targetInfos.find(
    (candidate) => candidate.type === 'page' && candidate.url === target.url(),
  );
  assert.ok(inspected);
  const opened = await session.send('Target.openDevTools', {
    targetId: inspected.targetId,
    panelId: 'console',
  });
  cleanup.defer(async () => {
    await session.send('Target.closeTarget', { targetId: opened.targetId });
    await poll(
      () => session.send('Target.getDevToolsTarget', { targetId: inspected.targetId }),
      (result) => result.targetId === undefined,
      'native DevTools closure',
    );
  });
  const relation = await session.send('Target.getDevToolsTarget', { targetId: inspected.targetId });
  assert.equal(relation.targetId, opened.targetId);
  const { targetInfo } = await session.send('Target.getTargetInfo', { targetId: opened.targetId });
  assert.equal(new URL(targetInfo.url).protocol, 'devtools:');
  await inspectFrontend(session, opened.targetId, screenshot);
  const lifetime = cleanup.move();
  return {
    ready: { linkedTarget: true, documentReady: 'complete', consoleRendered: true },
    close: () => lifetime.disposeAsync(),
  };
}

async function inspectFrontend(session: CDPSession, targetId: string, screenshot: string) {
  await using cleanup = new AsyncDisposableStack();
  const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: false });
  cleanup.defer(async () => {
    await session.send('Target.detachFromTarget', { sessionId });
  });
  const ready = await poll(
    async () =>
      documentSchema.safeParse(
        await frontendCommand(session, {
          sessionId,
          method: 'Runtime.evaluate',
          parameters: {
            expression:
              '({title:document.title,ready:document.readyState,text:document.body.innerText})',
            returnByValue: true,
          },
        }),
      ),
    (result) => result.success && result.data.result.value.text.includes('Default levels'),
    'rendered native DevTools Console',
  );
  assert.equal(ready.success, true);
  const image = z.object({ data: z.string() }).parse(
    await frontendCommand(session, {
      sessionId,
      method: 'Page.captureScreenshot',
      parameters: { format: 'png' },
    }),
  );
  await writeFile(screenshot, Buffer.from(image.data, 'base64'));
}
