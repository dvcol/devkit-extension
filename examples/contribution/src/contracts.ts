import { defineActionContract, defineCapability, defineOperation } from '@devkit/core';
import { z } from 'zod';

export const counterCapability = defineCapability({
  id: 'example.counter',
  version: 1,
  operations: {
    read: defineOperation({
      input: z.strictObject({}),
      output: z.number().int(),
    }),
    increase: defineOperation({
      input: z.strictObject({ amount: z.number().int().positive() }),
      output: z.number().int(),
    }),
  },
});

export const increaseCounterAction = defineActionContract({
  id: 'example.counter.increase',
  version: 1,
  operation: counterCapability.operations.increase,
});

/** Domain applicability belongs to this example action, not transport or recipient selection. */
export const increaseMatchingCounterAction = defineActionContract({
  id: 'example.counter.increase-matching',
  version: 1,
  operation: defineOperation({
    input: z.strictObject({ domain: z.string().min(1), amount: z.number().int().positive() }),
    output: z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('applied'), value: z.number().int() }),
      z.strictObject({ status: z.literal('not-applicable') }),
    ]),
  }),
});
