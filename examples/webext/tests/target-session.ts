import assert from 'node:assert/strict';
import type { CDPSession } from '@playwright/test';

/** Observe native UI documents omitted by Playwright through the public CDP target API. */
export async function attachTargetSession(control: CDPSession, targetId: string) {
  const { sessionId } = await control.send('Target.attachToTarget', { targetId, flatten: false });
  let nextRequestId = 0;
  const pending = new Map<number, (response: Record<string, unknown>) => void>();
  const receive = (event: { sessionId: string; message: string }) => {
    receiveResponse(sessionId, pending, event);
  };
  control.on('Target.receivedMessageFromTarget', receive);

  function send(method: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
    const requestId = ++nextRequestId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Target observer timed out: ${method}`));
      }, 10_000);
      pending.set(requestId, (response) => {
        clearTimeout(timeout);
        if ('error' in response) reject(new Error(JSON.stringify(response.error)));
        else resolve(response.result);
      });
      void control
        .send('Target.sendMessageToTarget', {
          sessionId,
          message: JSON.stringify({ id: requestId, method, params: parameters }),
        })
        .catch((error: unknown) => {
          clearTimeout(timeout);
          pending.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  return {
    send,
    evaluate: (expression: string) => evaluateSession(send, expression),
    dispose: () => control.off('Target.receivedMessageFromTarget', receive),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function receiveResponse(
  sessionId: string,
  pending: Map<number, (response: Record<string, unknown>) => void>,
  event: { sessionId: string; message: string },
): void {
  if (event.sessionId !== sessionId) return;
  const response: unknown = JSON.parse(event.message);
  assert.ok(isRecord(response));
  if (typeof response.id !== 'number') return;
  const callback = pending.get(response.id);
  pending.delete(response.id);
  callback?.(response);
}

async function evaluateSession(
  send: (method: string, parameters: Record<string, unknown>) => Promise<unknown>,
  expression: string,
): Promise<unknown> {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  assert.ok(isRecord(response));
  assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
  assert.ok(isRecord(response.result));
  return response.result.value;
}
