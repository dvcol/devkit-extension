import {
  defineAction,
  defineActionContract,
  defineCapability,
  defineOperation,
  definePlugin,
  defineService,
} from '@devkit/core';
import { z } from 'zod';
import { serverExecution } from '../src/index.js';

const inputSchema = z.object({ domain: z.string(), target: z.string(), value: z.number() });
const outcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('applied'), value: z.number() }),
  z.object({ status: z.literal('not-applicable') }),
]);
export const configurationCapability = defineCapability({
  id: 'example.configuration',
  version: 1,
  operations: {
    set: defineOperation({ input: inputSchema, output: outcomeSchema }),
    read: defineOperation({ input: z.string(), output: z.number().optional() }),
  },
});
export const configurationAction = defineActionContract({
  id: 'example.configure',
  version: 1,
  operation: configurationCapability.operations.set,
});

/** Applicability and resource names belong to this example service, not SDK routing. */
export function configurationComposition(providerId: string, domain: string) {
  return {
    providerId,
    expose: { actions: [configurationAction], capabilities: [configurationCapability] },
    services: [
      defineService({
        id: 'example.configuration-service',
        capability: configurationCapability,
        execution: serverExecution,
        setup() {
          const values = new Map<string, number>();
          return {
            set(input) {
              if (input.domain !== domain) return { status: 'not-applicable' } as const;
              values.set(input.target, input.value);
              return { status: 'applied', value: input.value } as const;
            },
            read: (target) => values.get(target),
          };
        },
      }),
    ],
    plugins: [
      definePlugin({
        id: 'example.configuration-plugin',
        actions: [
          defineAction({
            id: 'example.configuration-handler',
            contract: configurationAction,
            execution: serverExecution,
            requires: { configuration: configurationCapability },
            handler: ({ input, services, signal }) =>
              services.configuration.api.set(input, { signal }),
          }),
        ],
      }),
    ],
  };
}
