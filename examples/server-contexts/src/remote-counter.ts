import type { DevframeHubContext } from '@devframes/hub/node';
import { increaseCounterAction } from '@devkit/example-contribution';
import type { ServerProviderHandle } from '@devkit/server';
import { createDefineWrapperWithContext } from 'devframe/rpc';
import type { DevframeNodeContext } from 'devframe/types';
import { z } from 'zod';

const defineRpc = createDefineWrapperWithContext<DevframeNodeContext>();
const inputSchema = increaseCounterAction.operation.input;
const receiptSchema = z.object({ value: z.number(), trusted: z.boolean() });

/** Explicit host-owned methods preserve native per-method authorization and wire codecs. */
export function registerRemoteCounter(context: DevframeHubContext, provider: ServerProviderHandle) {
  let current = provider;
  const pending = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const completed = Promise.withResolvers<void>();
  context.rpc.register(
    defineRpc({
      name: 'example:counter:increase',
      type: 'action',
      args: [z.string(), inputSchema] as const,
      returns: receiptSchema,
      async handler(incarnation, input) {
        const selected = current;
        assertIncarnation(selected, incarnation);
        const trusted = context.rpc.getCurrentRpcSession()?.meta.isTrusted === true;
        const value = await selected.invoke({ action: increaseCounterAction, input });
        return { value, trusted };
      },
    }),
  );
  context.rpc.register(
    defineRpc({
      name: 'example:counter:pending',
      type: 'query',
      handler: async () => {
        started.resolve();
        await pending.promise;
        completed.resolve();
        return 'finished';
      },
    }),
  );
  return {
    replace(successor: ServerProviderHandle) {
      current = successor;
    },
    started: started.promise,
    completed: completed.promise,
    finish: () => {
      pending.resolve();
    },
  };
}

function assertIncarnation(provider: ServerProviderHandle, expected: string): void {
  if (provider.provider.incarnation !== expected)
    throw new Error('The provider incarnation changed; make a fresh selection before retrying');
}
