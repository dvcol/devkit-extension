import type { OperationError, RuntimeDiagnostic } from '@devkit/core';

/** Native causes stay on the local error; adapters choose the wire diagnostic policy. */
export function operationError(diagnostic: RuntimeDiagnostic, cause?: unknown): OperationError {
  return Object.assign(new Error(diagnostic.message, { cause }), {
    name: 'OperationError',
    code: diagnostic.code,
    diagnostic: Object.freeze({ ...diagnostic }),
  });
}
