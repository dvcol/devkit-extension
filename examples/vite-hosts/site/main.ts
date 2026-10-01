import { JSON_RENDER_INDEX_KEY } from '@devframes/json-render';
import type { JsonRenderIndex } from '@devframes/json-render';
import type { DevframeJsonRenderDockEntry, JsonRenderRpcContext } from '@devframes/json-render/hub';
import renderer from '@devframes/json-render-ui/renderer';
import { createClient } from '@devkit/client';
import type { Client } from '@devkit/client';
import { createActionCall } from '@devkit/devframe/client';
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import { createDevframeProviderConnection } from '@devkit/server/client';
import { connectDevframe } from 'devframe/client';
import type { DevframeRpcClient } from 'devframe/client';

const container = document.querySelector<HTMLElement>('#counter')!;
const status = document.querySelector<HTMLElement>('#connection')!;
const result = document.querySelector<HTMLOutputElement>('#result')!;
const mountButton = document.querySelector<HTMLButtonElement>('#mount')!;
const unmountButton = document.querySelector<HTMLButtonElement>('#unmount')!;
const readButton = document.querySelector<HTMLButtonElement>('#read')!;
const disconnectButton = document.querySelector<HTMLButtonElement>('#disconnect')!;
const lifetime = new AbortController();
const cleanup = new DisposableStack();
let mounted: Awaited<ReturnType<typeof renderer>> | undefined;
let mounting = false;

/** Native connection metadata identifies the selected example host, independent of build mode. */
function providerId(rpc: DevframeRpcClient): string {
  const path = new URL(rpc.connection.metaBaseUrl).pathname;
  const host = path.startsWith('/__devframes/') ? 'devframe' : 'devtools';
  return `example.${host}-${import.meta.hot === undefined ? 'preview' : 'vite'}`;
}

function unmount(): void {
  mounted?.dispose?.();
  mounted = undefined;
  container.replaceChildren();
  mountButton.disabled = lifetime.signal.aborted || mounting;
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
  await mountCounter(rpc, client, connection.provider.id);
}

async function mountCounter(
  rpc: DevframeRpcClient,
  client: Client,
  provider: string,
): Promise<void> {
  const routing = { realm: 'devserver', provider: provider };
  const context = {
    rpc: {
      ...rpc,
      call: createActionCall({
        rpc,
        actions: client.actions,
        bindings: [{ action: increaseCounterAction, routing }],
        signal: lifetime.signal,
      }),
    },
  };
  const index = await rpc.sharedState.get<JsonRenderIndex>(JSON_RENDER_INDEX_KEY);
  lifetime.signal.throwIfAborted();
  const view = Object.values(index.value()).find((entry) => entry.id === 'counter');
  if (view === undefined) throw new Error('The shared counter view is unavailable');
  const entry = {
    id: view.id,
    title: view.title,
    type: 'json-render',
    view,
    icon: 'ph:plus',
  } as const;

  mountButton.addEventListener('click', () => void mount(entry, context), {
    signal: lifetime.signal,
  });
  readButton.addEventListener('click', () => void read(client), { signal: lifetime.signal });
  readButton.disabled = false;
  disconnectButton.disabled = false;
  await mount(entry, context);
}

async function mount(
  entry: DevframeJsonRenderDockEntry,
  context: JsonRenderRpcContext,
): Promise<void> {
  mounting = true;
  mountButton.disabled = true;
  try {
    const instance = await renderer({ entry, container, context });
    if (lifetime.signal.aborted) {
      instance.dispose?.();
      return;
    }
    mounted = instance;
    unmountButton.disabled = false;
    status.textContent = 'Connected';
  } catch (error) {
    if (!lifetime.signal.aborted) status.textContent = `Mount failed: ${String(error)}`;
  } finally {
    mounting = false;
    mountButton.disabled = lifetime.signal.aborted || mounted !== undefined;
  }
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

unmountButton.addEventListener('click', unmount, { signal: lifetime.signal });
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
