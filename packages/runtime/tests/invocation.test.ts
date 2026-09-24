import { defineExecution, defineOperation, defineRealm, isOperationError } from '@devkit/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { operationError } from '../src/errors';
import { invokeLocalOperation } from '../src/invocation';
import type {
  LocalInvocationContext,
  LocalInvocationOptions,
  LocalOperationContext,
} from '../src/invocation';

const context: LocalInvocationContext = {
  provider: {
    id: 'provider',
    incarnation: 'test.backend-lifetime',
    realm: defineRealm({ id: 'custom' }),
  },
  execution: defineExecution({ id: 'server' }),
  native: {
    get() {
      throw new Error('Unexpected native lookup in invocation test');
    },
  },
  contributionId: 'echo',
};
const operation = defineOperation({ input: z.string(), output: z.string(), target: 'none' });

function invoke(
  handler: (value: unknown, operationContext: LocalOperationContext) => unknown,
  options: LocalInvocationOptions = {},
) {
  return invokeLocalOperation({
    operation,
    input: 'input',
    options,
    context,
    activationSignal: new AbortController().signal,
    handler,
  });
}

function deferred<Value>() {
  let complete: ((value: Value | PromiseLike<Value>) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    complete = resolve;
  });
  if (!complete) throw new Error('Promise constructor did not initialize resolver');
  return { promise, resolve: complete };
}

describe('guarded local invocation', () => {
  it('keeps original input and output when schemas transform them', async () => {
    expect.assertions(2);
    const transforming = defineOperation({
      input: z.string().transform(Number),
      output: z.string().transform(Number),
      target: 'none',
    });
    const handler = vi.fn<(value: unknown) => unknown>((value) => value);
    await expect(
      invokeLocalOperation({
        operation: transforming,
        input: '12',
        options: {},
        context,
        activationSignal: new AbortController().signal,
        handler,
      }),
    ).resolves.toBe('12');
    expect(handler).toHaveBeenCalledWith(
      '12',
      expect.objectContaining({ provider: context.provider, native: context.native }),
    );
  });

  it('rejects invalid input without dispatch', async () => {
    expect.assertions(2);
    const handler = vi.fn<() => unknown>();
    await expect(
      invokeLocalOperation({
        operation,
        input: 12,
        options: {},
        context,
        activationSignal: new AbortController().signal,
        handler,
      }),
    ).rejects.toMatchObject({
      code: 'invalid-input',
      diagnostic: { phase: 'call', providerId: 'provider' },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects invalid returns and keeps a native validator exception local', async () => {
    expect.assertions(2);
    await expect(invoke(() => 12)).rejects.toMatchObject({ code: 'invalid-return' });
    const failure = new Error('validator failed');
    const throwing = defineOperation({
      ...operation,
      input: z.string().transform(() => {
        throw failure;
      }),
    });
    await expect(
      invokeLocalOperation({
        operation: throwing,
        input: 'input',
        options: {},
        context,
        activationSignal: new AbortController().signal,
        handler: () => 'output',
      }),
    ).rejects.toMatchObject({ code: 'invalid-input', cause: failure });
  });

  it('validates target presence separately from the business payload', async () => {
    expect.assertions(3);
    const target = { kind: 'document', id: 'opaque', generation: '1' };
    await expect(invoke(() => 'output', { target })).rejects.toMatchObject({
      code: 'invalid-input',
    });
    const targeted = defineOperation({ ...operation, target: 'required' });
    await expect(
      invokeLocalOperation({
        operation: targeted,
        input: 'input',
        options: {},
        context,
        activationSignal: new AbortController().signal,
        handler: () => 'output',
      }),
    ).rejects.toMatchObject({ code: 'target-unavailable' });
    await expect(
      invokeLocalOperation({
        operation: targeted,
        input: 'input',
        options: { target },
        context,
        activationSignal: new AbortController().signal,
        handler: (_value, invocationContext) => invocationContext.target?.generation,
      }),
    ).resolves.toBe('1');
  });

  it('pins the authorized target before asynchronous validation', async () => {
    expect.assertions(2);
    const validating = deferred<void>();
    const resumeValidation = deferred<void>();
    const originalTarget = { kind: 'document', id: 'authorized', generation: '1' };
    const options = { target: originalTarget };
    const targeted = defineOperation({
      ...operation,
      target: 'required',
      input: z.string().refine(async () => {
        validating.resolve();
        await resumeValidation.promise;
        return true;
      }),
    });
    const handler = vi.fn<(input: unknown, invocationContext: LocalOperationContext) => unknown>(
      (_input, invocationContext) => invocationContext.target?.id,
    );
    const invocation = invokeLocalOperation({
      operation: targeted,
      input: 'input',
      options,
      context,
      activationSignal: new AbortController().signal,
      handler,
    });
    await validating.promise;
    originalTarget.id = 'mutated';
    options.target = { kind: 'document', id: 'replacement', generation: '2' };
    resumeValidation.resolve();
    await expect(invocation).resolves.toBe('authorized');
    expect(handler).toHaveBeenCalledWith(
      'input',
      expect.objectContaining({ target: { kind: 'document', id: 'authorized', generation: '1' } }),
    );
  });

  it('does not dispatch an already aborted invocation', async () => {
    expect.assertions(2);
    const handler = vi.fn<() => unknown>();
    const controller = new AbortController();
    controller.abort();
    await expect(invoke(handler, { signal: controller.signal })).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rechecks cancellation after asynchronous validation before dispatch', async () => {
    expect.assertions(2);
    const controller = new AbortController();
    const handler = vi.fn<() => unknown>();
    const delayed = defineOperation({
      ...operation,
      input: z.string().refine(async () => {
        await Promise.resolve();
        controller.abort();
        return true;
      }),
    });
    await expect(
      invokeLocalOperation({
        operation: delayed,
        input: 'input',
        options: { signal: controller.signal },
        context,
        activationSignal: new AbortController().signal,
        handler,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('waits for running work to finish after cancellation and discards its value', async () => {
    expect.assertions(3);
    const started = deferred<void>();
    const finished = deferred<string>();
    const controller = new AbortController();
    const handler = vi.fn<() => Promise<string>>(() => {
      started.resolve();
      return finished.promise;
    });
    const invocation = invoke(handler, { signal: controller.signal });
    let settled = false;
    const observed = invocation.then(
      () => {
        settled = true;
        return true;
      },
      () => {
        settled = true;
        return true;
      },
    );
    await started.promise;
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    finished.resolve('late value');
    await expect(invocation).rejects.toMatchObject({ code: 'cancelled' });
    await observed;
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('preserves supported portable errors and classifies other handler failures', async () => {
    expect.assertions(4);
    const failure = new Error('native detail');
    const portable = operationError({
      code: 'transport-failure',
      severity: 'error',
      message: 'Disconnected',
      providerId: 'provider',
      phase: 'transport',
    });
    await expect(
      invoke(() => {
        throw portable;
      }),
    ).rejects.toBe(portable);
    const rejected = invoke(() => {
      throw failure;
    });
    await expect(rejected).rejects.toMatchObject({ code: 'operation-failed', cause: failure });
    const error: unknown = await rejected.catch((cause: unknown) => cause);
    expect(isOperationError(error)).toBe(true);
    expect(isOperationError({ code: 'fake' })).toBe(false);
  });
});
