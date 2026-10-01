import type { JsonRenderRpcContext } from '@devframes/json-render/hub';
import type { ActionClient, BroadcastInvocationOptions } from '@devkit/core';
import { createActionCall } from '@devkit/devframe/client';
import {
  increaseCounterAction,
  increaseMatchingCounterAction,
  providerId,
  realm,
} from './contracts';

/** Host-owned selection and result presentation; rendering, state and action schemas stay native. */
export function createRendererRpc(options: {
  readonly rpc: JsonRenderRpcContext['rpc'];
  readonly actions: ActionClient;
  readonly signal: AbortSignal;
}): JsonRenderRpcContext['rpc'] {
  const selection = document.querySelector<HTMLSelectElement>('#json-selection')!;
  const result = document.querySelector<HTMLOutputElement>('#json-result')!;
  async function report<Value>(operation: () => Promise<Value>): Promise<Value> {
    result.textContent = 'Pending';
    try {
      const value = await operation();
      if (!options.signal.aborted) result.textContent = JSON.stringify(value, errorMessage);
      return value;
    } catch (error) {
      if (!options.signal.aborted)
        result.textContent = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
  const actions: ActionClient = {
    invoke: (request) => report(() => options.actions.invoke(request)),
    broadcast: (request) => report(() => options.actions.broadcast(request)),
  };
  function bind() {
    return createActionCall({
      rpc: options.rpc,
      actions,
      signal: options.signal,
      bindings: [
        { action: increaseCounterAction, routing: { realm: realm.id, provider: providerId } },
        { action: increaseMatchingCounterAction, selection: recipients(selection.value) },
      ],
    });
  }
  let call = bind();
  selection.addEventListener(
    'change',
    () => {
      call = bind();
    },
    { signal: options.signal },
  );
  return {
    ...options.rpc,
    get call() {
      return call;
    },
  };
}

export function recipients(value: string): BroadcastInvocationOptions['selection'] {
  if (value === 'all') return [{ realm: 'devserver' }, { realm: 'webext' }];
  if (value === 'servers') return [{ realm: 'devserver' }];
  if (value === 'devframe') return [{ realm: 'devserver', provider: 'example.devframe' }];
  return [{ realm: 'webext' }];
}

function errorMessage(_key: string, value: unknown): unknown {
  if (value instanceof Error) return { message: value.message };
  return value;
}
