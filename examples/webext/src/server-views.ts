import { JSON_RENDER_INDEX_KEY } from '@devframes/json-render';
import type { JsonRenderIndex, JsonRenderIndexEntry } from '@devframes/json-render';
import type { JsonRenderRpcContext } from '@devframes/json-render/hub';
import renderer from '@devframes/json-render-ui/renderer';
import type { ActionClient } from '@devkit/core';
import { createActionCall } from '@devkit/devframe/client';
import type { DevframeRpcClient } from 'devframe/client';
import { increaseCounterAction, increaseMatchingCounterAction } from './contracts';

interface ServerViewsOptions {
  readonly providerId: string;
  readonly rpc: DevframeRpcClient;
  readonly actions: ActionClient;
}

interface MountedView {
  readonly signal: AbortSignal;
  readonly ready: Promise<void>;
  dispose(): Promise<void>;
}

/** Each connection keeps its native view index, state keys and RPC ownership. */
export async function mountServerViews(options: ServerViewsOptions): Promise<() => void> {
  const { providerId, rpc } = options;
  const lifetime = new AbortController();
  const group = document.createElement('section');
  group.dataset.provider = providerId;
  const heading = document.createElement('h3');
  heading.textContent = providerId;
  group.append(heading);
  document.querySelector('#server-views')!.append(group);
  const views = new Map<string, MountedView>();
  const dispose = () => {
    lifetime.abort();
    for (const mounted of views.values()) void mounted.dispose();
    views.clear();
    group.remove();
  };
  const unsubscribe = rpc.events.on('connection:status', (status) => {
    if (status !== 'connected' && status !== 'connecting') dispose();
  });
  lifetime.signal.addEventListener('abort', unsubscribe, { once: true });
  function update(index: JsonRenderIndex = {}): void {
    for (const [stateKey, mounted] of views) {
      if (index[stateKey] !== undefined || mounted.signal.aborted) continue;
      void mounted.dispose().finally(() => {
        if (views.get(stateKey) === mounted) views.delete(stateKey);
      });
    }
    for (const entry of Object.values(index)) {
      const previous = views.get(entry.stateKey);
      if (previous !== undefined && !previous.signal.aborted) continue;
      views.set(entry.stateKey, mountView({ entry, server: options, group, previous }));
    }
  }
  try {
    const index = await rpc.sharedState.get<JsonRenderIndex>(JSON_RENDER_INDEX_KEY);
    lifetime.signal.throwIfAborted();
    const releaseIndex = index.on('updated', update);
    lifetime.signal.addEventListener('abort', releaseIndex, { once: true });
    update(index.value());
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}

function createRendererContext(
  { providerId, rpc, actions }: ServerViewsOptions,
  signal: AbortSignal,
): JsonRenderRpcContext {
  const routing = { realm: 'devserver', provider: providerId };
  return {
    rpc: {
      ...rpc,
      call: createActionCall({
        rpc,
        actions,
        signal,
        bindings: [
          { action: increaseCounterAction, routing },
          { action: increaseMatchingCounterAction, routing },
          { action: readInspectorAction, routing },
          { action: configureInspectorAction, routing },
          { action: markInspectorAction, routing },
          { action: resetInspectorAction, routing },
        ],
      }),
    },
  };
}

/** A removed entry may still have an asynchronous renderer mount completing. */
function mountView(options: {
  readonly entry: JsonRenderIndexEntry;
  readonly server: ServerViewsOptions;
  readonly group: HTMLElement;
  readonly previous: MountedView | undefined;
}): MountedView {
  const { entry, server, group, previous } = options;
  const lifetime = new AbortController();
  const context = createRendererContext(server, lifetime.signal);
  const container = document.createElement('div');
  container.dataset.view = entry.stateKey;
  group.append(container);
  let mounted: Awaited<ReturnType<typeof renderer>> | undefined;
  let disposal: Promise<void> | undefined;
  async function render(): Promise<void> {
    await previous?.dispose();
    if (lifetime.signal.aborted) return;
    const instance = await renderer({
      entry: {
        id: entry.id,
        title: entry.title,
        icon: 'ph:layout',
        type: 'json-render',
        view: entry,
      },
      container,
      context,
    });
    mounted = instance;
  }
  const ready = render().catch((error: unknown) => {
    if (lifetime.signal.aborted) return;
    (container.shadowRoot ?? container).textContent =
      error instanceof Error ? error.message : String(error);
  });
  const dispose = (): Promise<void> => {
    lifetime.abort();
    container.remove();
    disposal ??= ready.finally(() => {
      try {
        mounted?.dispose?.();
      } finally {
        server.rpc.sharedState.delete(entry.stateKey);
      }
    });
    return disposal;
  };
  return { signal: lifetime.signal, ready, dispose };
}
import {
  configureInspectorAction,
  markInspectorAction,
  readInspectorAction,
  resetInspectorAction,
} from '@devkit/example-contribution/inspector';
