import { defineAction, defineActionContract, defineOperation, definePlugin } from '@devkit/core';
import type { TargetReference } from '@devkit/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { action, deferred, execution, provider } from './provider-fixtures.js';

describe('provider invocation requests', () => {
  it('keeps business payload separate from execution target and cancellation', async () => {
    expect.assertions(5);
    const { runtime } = provider();
    const target: TargetReference = { kind: 'document', id: 'page', generation: 'one' };
    const contract = defineActionContract({
      id: 'example.targeted',
      version: 1,
      operation: defineOperation({
        input: z.object({ target: z.string(), signal: z.string() }),
        output: z.string(),
        target: 'required',
      }),
    });
    const controller = new AbortController();
    const input = { target: 'business value', signal: 'business signal' };
    await runtime.startup({
      plugins: [
        definePlugin({
          id: 'example.requests',
          actions: [
            defineAction({
              contract,
              id: 'example.targeted-handler',
              execution,
              handler(context) {
                expect(context.input).toBe(input);
                expect(context.target).toEqual(target);
                expect(context.target).not.toBe(target);
                expect(context.signal.aborted).toBe(false);
                return context.input.target;
              },
            }),
          ],
        }),
      ],
    });
    try {
      await expect(
        runtime.invoke({ action: contract, input, target, signal: controller.signal }),
      ).resolves.toBe('business value');
    } finally {
      await runtime.dispose();
    }
  });

  it('rejects an already cancelled request without invoking the handler', async () => {
    expect.assertions(2);
    const { runtime } = provider();
    const handler = vi.fn<() => string>(() => 'unexpected');
    await runtime.startup({
      plugins: [
        definePlugin({
          id: 'example.requests',
          actions: [defineAction({ contract: action, id: 'example.handler', execution, handler })],
        }),
      ],
    });
    try {
      await expect(
        runtime.invoke({ action, input: 'value', signal: AbortSignal.abort() }),
      ).rejects.toMatchObject({ code: 'cancelled' });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  });

  it('forwards cancellation during a dispatched action without replaying it', async () => {
    expect.assertions(3);
    const { runtime } = provider();
    const started = deferred<void>();
    const controller = new AbortController();
    const handler = vi.fn<(context: { readonly signal: AbortSignal }) => Promise<string>>(
      ({ signal }) => {
        const settled = new Promise<string>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve('late');
            },
            { once: true },
          );
        });
        started.resolve();
        return settled;
      },
    );
    await runtime.startup({
      plugins: [
        definePlugin({
          id: 'example.requests',
          actions: [defineAction({ contract: action, id: 'example.handler', execution, handler })],
        }),
      ],
    });
    try {
      const invocation = runtime.invoke({ action, input: 'value', signal: controller.signal });
      const outcome = invocation.catch((error: unknown) => error);
      await started.promise;
      controller.abort();
      await expect(outcome).resolves.toMatchObject({ code: 'cancelled' });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]?.[0].signal.aborted).toBe(true);
    } finally {
      controller.abort();
      await runtime.dispose();
    }
  });
});
