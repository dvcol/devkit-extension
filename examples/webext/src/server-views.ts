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
  const views = new Map<string, () => void>();
  const dispose = () => {
    lifetime.abort();
    for (const release of views.values()) release();
    views.clear();
    group.remove();
  };
  const unsubscribe = rpc.events.on('connection:status', (status) => {
    if (status !== 'connected' && status !== 'connecting') dispose();
  });
  lifetime.signal.addEventListener('abort', unsubscribe, { once: true });
  function update(index: JsonRenderIndex = {}): void {
    for (const [stateKey, release] of views) {
      if (index[stateKey] !== undefined) continue;
      release();
      views.delete(stateKey);
    }
    for (const entry of Object.values(index)) {
      if (!views.has(entry.stateKey))
        views.set(entry.stateKey, mountView({ entry, server: options, group }));
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
}): () => void {
  const { entry, server, group } = options;
  const lifetime = new AbortController();
  const context = createRendererContext(server, lifetime.signal);
  const container = document.createElement('div');
  container.dataset.view = entry.stateKey;
  group.append(container);
  let disposed = false;
  let mounted: Awaited<ReturnType<typeof renderer>> | undefined;
  async function render(): Promise<void> {
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
    if (disposed) instance.dispose?.();
  }
  void render().catch((error: unknown) => {
    if (disposed) return;
    (container.shadowRoot ?? container).textContent =
      error instanceof Error ? error.message : String(error);
  });
  return () => {
    disposed = true;
    lifetime.abort();
    mounted?.dispose?.();
    container.remove();
  };
}
