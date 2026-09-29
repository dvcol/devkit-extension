import type {
  ActionClient,
  ActionDescriptor,
  BroadcastInvocationOptions,
  RoutingPolicy,
} from '@devkit/core';
import type { DevframeRpcClient } from 'devframe/client';

export type ActionBinding = { readonly action: ActionDescriptor } & (
  | { readonly selection: BroadcastInvocationOptions['selection']; readonly routing?: never }
  | { readonly routing?: RoutingPolicy; readonly selection?: never }
);

export interface ActionCallOptions {
  readonly rpc: Pick<DevframeRpcClient, 'call'>;
  readonly actions: ActionClient;
  readonly bindings: readonly ActionBinding[];
  /** Forward view lifetime cancellation to the router; dispatched work is not replayed. */
  readonly signal?: AbortSignal;
}

/** Bind contract IDs to portable dispatch; every other call retains native arguments and ownership. */
export function createActionCall(options: ActionCallOptions): DevframeRpcClient['call'] {
  const bindings = new Map<string, ActionBinding>();
  for (const binding of options.bindings) {
    const actionId = binding.action.id;
    if (binding.selection !== undefined && binding.routing !== undefined)
      throw new Error(`Action binding ${actionId} cannot combine selection and routing`);
    if (bindings.has(actionId)) throw new Error(`Duplicate action binding: ${actionId}`);
    bindings.set(actionId, binding);
  }

  /** Preserve Devframe's generic call signature without reconstructing its RPC function types. */
  return new Proxy(options.rpc.call, {
    async apply(target, _receiver, parameters: readonly unknown[]): Promise<unknown> {
      const [method, input] = parameters;
      const binding = typeof method === 'string' ? bindings.get(method) : undefined;
      if (binding === undefined) {
        const value: unknown = await Reflect.apply(target, options.rpc, parameters);
        return value;
      }
      options.signal?.throwIfAborted();
      if (parameters.length !== 2)
        throw new Error(`Portable action ${binding.action.id} requires exactly one input`);
      const request = {
        action: binding.action,
        input,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      };
      if (binding.selection !== undefined)
        return options.actions.broadcast({ ...request, selection: binding.selection });
      return options.actions.invoke({
        ...request,
        ...(binding.routing === undefined ? {} : { routing: binding.routing }),
      });
    },
  });
}
