import { describe, expect, it } from 'vitest';

import { isOperationError } from '../src/index.js';

const diagnostic = {
  code: 'invalid-input',
  message: 'Input validation failed',
  severity: 'error',
  providerId: 'example.provider',
  phase: 'call',
} as const;

describe('isOperationError', () => {
  it('recognizes native errors and portable records using the same diagnostic shape', () => {
    expect.assertions(3);
    const error = Object.assign(new Error(diagnostic.message), {
      code: diagnostic.code,
      diagnostic,
    });
    expect(isOperationError(error)).toBe(true);
    expect(
      isOperationError({
        name: 'OperationError',
        message: error.message,
        code: diagnostic.code,
        diagnostic,
      }),
    ).toBe(true);
    expect(
      isOperationError({
        name: 'OperationError',
        message: '',
        code: diagnostic.code,
        diagnostic: {
          ...diagnostic,
          pluginId: 'example.plugin',
          contributionId: 'example.service',
        },
      }),
    ).toBe(true);
  });

  it.each([
    null,
    new Error('ordinary error'),
    { code: diagnostic.code, diagnostic },
    { name: 'Error', message: '', code: 'different', diagnostic },
    {
      name: 'Error',
      message: '',
      code: diagnostic.code,
      diagnostic: { ...diagnostic, phase: 'invented' },
    },
    {
      name: 'Error',
      message: '',
      code: diagnostic.code,
      diagnostic: { ...diagnostic, severity: 'silent' },
    },
    {
      name: 'Error',
      message: '',
      code: diagnostic.code,
      diagnostic: { ...diagnostic, providerId: '' },
    },
    {
      name: 'Error',
      message: '',
      code: diagnostic.code,
      diagnostic: { ...diagnostic, pluginId: 123 },
    },
    { name: 'Error', message: '', stack: 12, code: diagnostic.code, diagnostic },
  ])('rejects incomplete or malformed portable errors %#', (error) => {
    expect.assertions(1);
    expect(isOperationError(error)).toBe(false);
  });
});
