import { defineAction, defineCapability, defineOperation } from '@devkit/core';
import { z } from 'zod';

export const counterCapability = defineCapability({
  id: 'example.counter',
  version: 1,
  operations: {
    read: defineOperation({
      input: z.strictObject({}),
      output: z.number().int(),
      target: 'none',
    }),
    increase: defineOperation({
      input: z.strictObject({ amount: z.number().int().positive() }),
      output: z.number().int(),
      target: 'none',
    }),
  },
});

export const increaseCounterAction = defineAction({
  id: 'example.counter.increase',
  version: 1,
  operation: counterCapability.operations.increase,
});
