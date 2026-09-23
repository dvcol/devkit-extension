import type { RuntimeDiagnostic } from '@devkit/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import { operationError } from './errors.js';

/** Validation deliberately ignores the transformed result and keeps the caller's value. */
export async function validateOriginal(
  schema: StandardSchemaV1,
  value: unknown,
  diagnostic: RuntimeDiagnostic,
): Promise<void> {
  let result: StandardSchemaV1.Result<unknown>;
  try {
    result = await schema['~standard'].validate(value);
  } catch (cause) {
    throw operationError(diagnostic, cause);
  }
  if (result.issues) {
    throw operationError(diagnostic, result.issues);
  }
}
