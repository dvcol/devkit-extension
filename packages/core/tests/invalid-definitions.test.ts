import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  defineActionContract,
  defineAction,
  defineCapability,
  defineContributionKind,
  defineExecution,
  defineExtension,
  defineOperation,
  definePlugin,
  defineRealm,
  defineService,
} from '../src/index.js';

const execution = defineExecution({ id: 'example.server' });
const operation = defineOperation({ input: z.string(), output: z.string(), target: 'none' });
const capability = defineCapability({
  id: 'example.text',
  version: 1,
  operations: { echo: operation },
});
const action = defineActionContract({ id: 'example.echo', version: 1, operation });
const setup = (): { echo: (value: string) => string } => ({ echo: (value) => value });

/** Exercise JavaScript callers with malformed values without pretending they satisfy TypeScript contracts. */
function invokeFactory(
  factory: (...factoryArguments: never[]) => unknown,
  ...parameters: readonly unknown[]
): unknown {
  return Reflect.apply(factory, undefined, parameters);
}

describe('invalid declarations', () => {
  it.each(['', ' ', 12, null, undefined])('rejects invalid identifiers %s', (identifier) => {
    expect.assertions(1);
    expect(() => invokeFactory(defineRealm, { id: identifier })).toThrow(TypeError);
  });

  it.each([
    0,
    -1,
    1.2,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '1',
    undefined,
  ])('rejects invalid contract version %s', (version) => {
    expect.assertions(2);
    expect(() =>
      invokeFactory(defineCapability, { id: 'example.invalid', version, operations: {} }),
    ).toThrow(TypeError);
    expect(() =>
      invokeFactory(defineActionContract, { id: 'example.invalid', version, operation }),
    ).toThrow(TypeError);
  });

  it.each([
    {
      name: 'unknown plugin key',
      create: () => invokeFactory(definePlugin, { id: 'example.invalid', actons: [] }),
    },
    {
      name: 'unknown operation key',
      create: () => invokeFactory(defineOperation, { ...operation, unknowable: true }),
    },
    {
      name: 'unknown capability key',
      create: () =>
        invokeFactory(defineCapability, {
          id: 'example.invalid',
          version: 1,
          operations: {},
          extra: true,
        }),
    },
    {
      name: 'symbol declaration key',
      create: () =>
        invokeFactory(defineExecution, { id: 'example.invalid', [Symbol('extra')]: true }),
    },
    {
      name: 'missing output schema',
      create: () => invokeFactory(defineOperation, { input: z.string(), target: 'none' }),
    },
    {
      name: 'unsupported schema protocol',
      create: () =>
        invokeFactory(defineOperation, {
          ...operation,
          input: {
            '~standard': { version: 2, vendor: 'example', validate: () => ({ value: '' }) },
          },
        }),
    },
    {
      name: 'schema missing validator',
      create: () =>
        invokeFactory(defineOperation, {
          ...operation,
          input: { '~standard': { version: 1, vendor: 'example' } },
        }),
    },
    {
      name: 'schema missing vendor',
      create: () =>
        invokeFactory(defineOperation, {
          ...operation,
          input: { '~standard': { version: 1, validate: () => ({ value: '' }) } },
        }),
    },
    {
      name: 'invalid target requirement',
      create: () => invokeFactory(defineOperation, { ...operation, target: 'optional' }),
    },
    {
      name: 'blank operation name',
      create: () =>
        invokeFactory(defineCapability, {
          id: 'example.invalid',
          version: 1,
          operations: { ' ': operation },
        }),
    },
    {
      name: 'invalid requirement contract',
      create: () =>
        invokeFactory(defineService, {
          capability: capability,
          id: 'example.invalid',
          execution,
          requires: { wrong: {} },
          setup,
        }),
    },
    {
      name: 'null requirements',
      create: () =>
        invokeFactory(defineService, {
          capability: capability,
          id: 'example.invalid',
          execution,
          requires: null,
          setup,
        }),
    },
    {
      name: 'missing setup',
      create: () =>
        invokeFactory(defineService, { capability: capability, id: 'example.invalid', execution }),
    },
    {
      name: 'missing action handler',
      create: () =>
        invokeFactory(defineAction, { contract: action, id: 'example.invalid', execution }),
    },
    {
      name: 'missing execution',
      create: () =>
        invokeFactory(defineService, { capability: capability, id: 'example.invalid', setup }),
    },
    {
      name: 'wrong plugin list kind',
      create: () =>
        invokeFactory(definePlugin, {
          id: 'example.invalid',
          actions: [
            invokeFactory(defineService, {
              capability: capability,
              id: 'example.service',
              execution,
              setup,
            }),
          ],
        }),
    },
    {
      name: 'non-array list',
      create: () => invokeFactory(definePlugin, { id: 'example.invalid', services: {} }),
    },
    {
      name: 'undefined present list',
      create: () => invokeFactory(definePlugin, { id: 'example.invalid', services: undefined }),
    },
    {
      name: 'missing extension payload',
      create: () =>
        invokeFactory(defineExtension, {
          descriptor: invokeFactory(defineContributionKind, {
            id: 'example.kind',
            schema: z.string(),
          }),
          id: 'example.invalid',
          execution,
        }),
    },
    {
      name: 'forged nested contract kind',
      create: () =>
        invokeFactory(definePlugin, {
          id: 'example.invalid',
          services: [
            {
              kind: 'service',
              id: 'example.service',
              execution,
              requires: {},
              setup,
              capability: { ...capability, kind: 'other' },
            },
          ],
        }),
    },
  ])('rejects $name', ({ create }) => {
    expect.assertions(1);
    expect(create).toThrow(TypeError);
  });
});
