import { setTimeout as delay } from 'node:timers/promises';
import type { Page } from '@playwright/test';
import type { z } from 'zod';
import type { RemoteRequest } from './protocol.ts';

type Response<Value> = { ok: true; value: Value } | { ok: false; error: { message: string } };

/** Test-only control messages; portable and native CDB traffic keep their existing protocols. */
export async function send<Value>(
  control: Page,
  request: RemoteRequest,
  schema: z.ZodType<Response<Value>>,
): Promise<Value> {
  const timeout = new AbortController();
  try {
    const response = schema.parse(
      await Promise.race([
        control.evaluate((message) => chrome.runtime.sendMessage<unknown>(message), request),
        delay(10_000, undefined, { signal: timeout.signal }).then(() => {
          throw new Error(`Fixture command timed out: ${request.kind}`);
        }),
      ]),
    );
    if (!response.ok) throw new Error(response.error.message);
    return response.value;
  } finally {
    timeout.abort();
  }
}

/** Wait only in the acceptance driver; the native client retains its own readiness semantics. */
export async function poll<Value>(
  read: () => Value | Promise<Value>,
  predicate: (value: Value) => boolean,
  label: string,
): Promise<Value> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
