import { defineActionContract, defineCapability, defineOperation } from '@devkit/core';
import type { PublishedTarget } from '@dvcol/cdb';
import { z } from 'zod';

/** This capability consumes CDB's own target identity, not a universal SDK target. */
export type DebuggerTarget = Pick<PublishedTarget, 'id' | 'generation'>;
export const targetSchema = z.strictObject({
  id: z.uuid(),
  generation: z.number().int().positive(),
}) satisfies z.ZodType<DebuggerTarget>;

export const pageTitleCapability = defineCapability({
  id: 'example.debugger.page-title',
  version: 1,
  operations: {
    read: defineOperation({ input: targetSchema, output: z.string() }),
  },
});

export const readPageTitleAction = defineActionContract({
  id: 'example.debugger.read-page-title',
  version: 1,
  operation: pageTitleCapability.operations.read,
});
