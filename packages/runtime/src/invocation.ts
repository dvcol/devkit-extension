import { isOperationError } from '@devkit/core';
import type {
  ContextMetadata,
  InvocationOptions,
  NativeContextAccess,
  OperationDefinition,
  RuntimeDiagnostic,
  TargetReference,
} from '@devkit/core';

import { operationError } from './errors.js';
import { snapshotProvider } from './provider-identity.js';
import { validateOriginal } from './validation.js';

export interface LocalInvocationContext extends ContextMetadata {
  readonly native: NativeContextAccess;
  readonly contributionId: string;
  readonly pluginId?: string;
}

export interface LocalOperationContext extends ContextMetadata {
  readonly native: NativeContextAccess;
  readonly signal: AbortSignal;
  readonly target?: TargetReference;
}

export interface LocalInvocationOptions extends InvocationOptions {
  readonly target?: TargetReference;
}

export interface LocalInvocationRequest {
  readonly operation: OperationDefinition;
  readonly input: unknown;
  readonly options: LocalInvocationOptions;
  readonly context: LocalInvocationContext;
  readonly activationSignal: AbortSignal;
  readonly handler: (value: unknown, context: LocalOperationContext) => unknown;
}

/** Called only after the owning adapter authorizes and resolves the execution target. */
export async function invokeLocalOperation({
  operation,
  input,
  options,
  context: sourceContext,
  activationSignal,
  handler,
}: LocalInvocationRequest): Promise<unknown> {
  const context = { ...sourceContext, provider: snapshotProvider(sourceContext.provider) };
  const target = options.target ? Object.freeze({ ...options.target }) : undefined;
  const signal = options.signal
    ? AbortSignal.any([activationSignal, options.signal])
    : activationSignal;
  assertNotCancelled(signal, context);
  assertTarget(operation, target, context);
  await validateOriginal(
    operation.input,
    input,
    diagnostic(context, 'invalid-input', 'Operation input failed validation'),
  );
  assertNotCancelled(signal, context);
  let result: unknown;
  try {
    const invocationContext = { ...context, signal };
    result = await handler(input, target ? { ...invocationContext, target } : invocationContext);
  } catch (cause) {
    assertNotCancelled(signal, context);
    if (isOperationError(cause)) throw cause;
    throw operationError(
      diagnostic(context, 'operation-failed', 'Operation handler failed'),
      cause,
    );
  }
  assertNotCancelled(signal, context);
  await validateOriginal(
    operation.output,
    result,
    diagnostic(context, 'invalid-return', 'Operation return failed validation'),
  );
  assertNotCancelled(signal, context);
  return result;
}

function diagnostic(
  context: LocalInvocationContext,
  code: string,
  message: string,
): RuntimeDiagnostic {
  return {
    code,
    message,
    severity: 'error',
    phase: 'call',
    providerId: context.provider.id,
    contributionId: context.contributionId,
    ...(context.pluginId === undefined ? {} : { pluginId: context.pluginId }),
  };
}

function assertNotCancelled(signal: AbortSignal, context: LocalInvocationContext): void {
  if (signal.aborted) {
    throw operationError(
      diagnostic(context, 'cancelled', 'Operation was cancelled'),
      signal.reason,
    );
  }
}

function assertTarget(
  operation: OperationDefinition,
  target: TargetReference | undefined,
  context: LocalInvocationContext,
): void {
  if (operation.target === 'none' && target !== undefined) {
    throw operationError(
      diagnostic(context, 'invalid-input', 'Targetless operation received an execution target'),
    );
  }
  if (operation.target === 'required' && !target) {
    throw operationError(
      diagnostic(context, 'target-unavailable', 'Operation requires an execution target'),
    );
  }
}
