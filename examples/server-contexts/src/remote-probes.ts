import type { DevframeHubContext } from '@devframes/hub/node';
import { createDefineWrapperWithContext } from 'devframe/rpc';
import type { DevframeNodeContext } from 'devframe/types';

const defineRpc = createDefineWrapperWithContext<DevframeNodeContext>();

/** Example-only probes inspect native session trust and ordinary disconnect behavior. */
export function registerRemoteProbes(context: DevframeHubContext) {
  const pending = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const completed = Promise.withResolvers<void>();
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
  context.rpc.register(
    defineRpc({
      name: 'example:counter:trusted',
      type: 'query',
      handler: () => context.rpc.getCurrentRpcSession()?.meta.isTrusted === true,
    }),
  );
  return {
    started: started.promise,
    completed: completed.promise,
    finish: () => {
      pending.resolve();
    },
  };
}
