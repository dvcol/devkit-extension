import { JSON_RENDER_INDEX_KEY } from '@devframes/json-render';
import type { JsonRenderIndex, JsonRenderIndexEntry } from '@devframes/json-render';
import type { JsonRenderRpcContext } from '@devframes/json-render/hub';
import renderer from '@devframes/json-render-ui/renderer';
import { createClient } from '@devkit/client';
import type { Client } from '@devkit/client';
import { createActionCall } from '@devkit/devframe/client';
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import { createDevframeProviderConnection } from '@devkit/server/client';
import { connectDevframe } from 'devframe/client';
import type { DevframeRpcClient } from 'devframe/client';

interface CounterConnection {
  readonly rpc: DevframeRpcClient;
  readonly client: Client;
  readonly provider: string;
}

const container = document.querySelector<HTMLElement>('#counter')!;
const status = document.querySelector<HTMLElement>('#connection')!;
const result = document.querySelector<HTMLOutputElement>('#result')!;
const mountButton = document.querySelector<HTMLButtonElement>('#mount')!;
const unmountButton = document.querySelector<HTMLButtonElement>('#unmount')!;
const readButton = document.querySelector<HTMLButtonElement>('#read')!;
const disconnectButton = document.querySelector<HTMLButtonElement>('#disconnect')!;
const lifetime = new AbortController();
const cleanup = new DisposableStack();
let disposeView: (() => void) | undefined;
let pendingMount: Promise<void> = Promise.resolve();
let published = false;
let wantsMounted = true;

/** Native connection metadata identifies the selected example host, independent of build mode. */
function providerId(rpc: DevframeRpcClient): string {
  const path = new URL(rpc.connection.metaBaseUrl).pathname;
  const host = path.startsWith('/__devframes/') ? 'devframe' : 'devtools';
  return `example.${host}-${import.meta.hot === undefined ? 'preview' : 'vite'}`;
}

function unmount(): void {
  disposeView?.();
  disposeView = undefined;
  mountButton.disabled = lifetime.signal.aborted || !published;
  unmountButton.disabled = true;
}

function dispose(): void {
  lifetime.abort();
  unmount();
  cleanup.dispose();
  readButton.disabled = true;
  disconnectButton.disabled = true;
  status.textContent = 'Disconnected. Reload to reconnect.';
}

/** Native startup may finish after pagehide or a Vite module disposal. */
function own(release: () => void): void {
  if (cleanup.disposed) release();
  else cleanup.defer(release);
}

async function start(): Promise<void> {
  const rpc = await connectDevframe({
    baseURL: ['/__devframes/', '/__devtools/'],
    connection: { isolated: true },
    webmcp: false,
  });
  own(() => rpc.close?.());
  if (lifetime.signal.aborted) return;
  await rpc.ensureTrusted();
  const connection = await createDevframeProviderConnection({
    rpc,
    providerId: providerId(rpc),
    signal: lifetime.signal,
  });
  own(() => {
    connection.dispose();
  });
  if (lifetime.signal.aborted) return;
  const client = createClient({ connections: [connection] });
  own(() => {
    client.dispose();
  });
  own(
    rpc.events.on('connection:status', (value) => {
      if (value !== 'connected' && value !== 'connecting') dispose();
    }),
  );
  document.querySelector<HTMLOutputElement>('#provider')!.textContent = JSON.stringify(
    connection.provider,
  );
  await mountCounter({ rpc, client, provider: connection.provider.id });
}

async function mountCounter(connection: CounterConnection): Promise<void> {
  const { rpc, client } = connection;
  const index = await rpc.sharedState.get<JsonRenderIndex>(JSON_RENDER_INDEX_KEY);
  lifetime.signal.throwIfAborted();
  let view: JsonRenderIndexEntry | undefined;
  function update(): void {
    const next = Object.values(index.value()).find(
      (entry) => entry.id === 'counter' && entry.scope === 'example',
    );
    const removedKey = view?.stateKey;
    if (next?.stateKey === removedKey && published) return;
    view = next;
    published = view !== undefined;
    if (removedKey !== undefined) {
      unmount();
      /** A pending native get can refill the cache; settle it before eviction and remount. */
      const evictRemovedState = (): void => {
        rpc.sharedState.delete(removedKey);
      };
      pendingMount = pendingMount.then(evictRemovedState);
    }
    mountButton.disabled = lifetime.signal.aborted || !published || disposeView !== undefined;
    if (view === undefined) {
      status.textContent = 'Connected. Counter view unavailable.';
      return;
    }
    status.textContent = 'Connected';
    if (wantsMounted) void mount(view, connection);
  }

  own(index.on('updated', update));
  mountButton.addEventListener(
    'click',
    () => {
      wantsMounted = true;
      if (view !== undefined) void mount(view, connection);
    },
    { signal: lifetime.signal },
  );
  readButton.addEventListener('click', () => void read(client), { signal: lifetime.signal });
  readButton.disabled = false;
  disconnectButton.disabled = false;
  update();
  await pendingMount;
}

function mount(view: JsonRenderIndexEntry, connection: CounterConnection): Promise<void> {
  if (!published || lifetime.signal.aborted || disposeView !== undefined) return Promise.resolve();
  const actions = new AbortController();
  const resources = new DisposableStack();
  const target = document.createElement('div');
  container.append(target);
  resources.defer(() => {
    target.remove();
  });
  const disposeMount = () => {
    actions.abort();
    resources.dispose();
  };
  disposeView = disposeMount;
  mountButton.disabled = true;
  async function activate(): Promise<void> {
    if (actions.signal.aborted) return;
    try {
      const instance = await renderer({
        entry: { id: view.id, title: view.title, type: 'json-render', view, icon: 'ph:plus' },
        container: target,
        context: rendererContext(connection, actions.signal),
      });
      if (resources.disposed) {
        instance.dispose?.();
        return;
      }
      resources.defer(() => instance.dispose?.());
      unmountButton.disabled = false;
      status.textContent = 'Connected';
    } catch (error) {
      if (actions.signal.aborted) return;
      unmount();
      status.textContent = `Mount failed: ${String(error)}`;
    } finally {
      if (disposeView === disposeMount || disposeView === undefined)
        mountButton.disabled = lifetime.signal.aborted || !published || disposeView !== undefined;
    }
  }
  const completion = pendingMount.then(activate);
  pendingMount = completion;
  return completion;
}

function rendererContext(connection: CounterConnection, signal: AbortSignal): JsonRenderRpcContext {
  const { rpc, client, provider } = connection;
  return {
    rpc: {
      ...rpc,
      call: createActionCall({
        rpc,
        actions: client.actions,
        bindings: [{ action: increaseCounterAction, routing: { realm: 'devserver', provider } }],
        signal,
      }),
    },
  };
}

async function read(client: Client): Promise<void> {
  try {
    const value = await client.capabilities.invoke({
      capability: counterCapability,
      operation: 'read',
      input: {},
      signal: lifetime.signal,
    });
    if (!lifetime.signal.aborted) result.textContent = JSON.stringify({ value });
  } catch (error) {
    if (!lifetime.signal.aborted) result.textContent = String(error);
  }
}

unmountButton.addEventListener(
  'click',
  () => {
    wantsMounted = false;
    unmount();
  },
  { signal: lifetime.signal },
);
disconnectButton.addEventListener('click', dispose, { signal: lifetime.signal });
const reloadButton = document.querySelector<HTMLButtonElement>('#reload')!;
const reload = () => {
  location.reload();
};
reloadButton.addEventListener('click', reload);
window.addEventListener('pagehide', dispose, { once: true });
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    dispose();
    reloadButton.removeEventListener('click', reload);
    window.removeEventListener('pagehide', dispose);
  });

try {
  await start();
} catch (error) {
  dispose();
  status.textContent = `Connection failed: ${String(error)}`;
}
