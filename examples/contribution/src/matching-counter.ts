import { defineAction, definePlugin } from '@devkit/core';
import type { ExecutionDescriptor } from '@devkit/core';
import { counterCapability, increaseMatchingCounterAction } from './contracts.js';

/** Each host supplies its own resources; several providers may handle the same domain. */
export function createMatchingCounterPlugin(options: {
  readonly execution: ExecutionDescriptor;
  readonly domains: readonly string[];
}) {
  const domains = new Set(options.domains);
  return definePlugin({
    id: 'example.matching-counter',
    actions: [
      defineAction({
        id: 'example.increase-matching-counter',
        contract: increaseMatchingCounterAction,
        execution: options.execution,
        requires: { counter: counterCapability },
        async handler({ input, services, signal }) {
          if (!domains.has(input.domain)) return { status: 'not-applicable' as const };
          const value = await services.counter.api.increase({ amount: input.amount }, { signal });
          return { status: 'applied' as const, value };
        },
      }),
    ],
  });
}
