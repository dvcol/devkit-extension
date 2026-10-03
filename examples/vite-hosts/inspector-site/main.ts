import { JSON_RENDER_INDEX_KEY } from '@devframes/json-render';
import type { JsonRenderIndex } from '@devframes/json-render';
import renderer from '@devframes/json-render-ui/renderer';
import { createClient } from '@devkit/client';
import type { Client } from '@devkit/client';
import { createActionCall } from '@devkit/devframe/client';
import {
  configureInspectorAction,
  markInspectorAction,
  readInspectorAction,
  resetInspectorAction,
} from '@devkit/example-contribution/inspector';
import { createDevframeProviderConnection } from '@devkit/server/client';
import { connectDevframe } from 'devframe/client';
import type { DevframeRpcClient } from 'devframe/client';
import { domRenderer } from '@devkit/example-json-render/renderer';

const lifetime = new AbortController();
const cleanup = new DisposableStack();
const status = document.querySelector<HTMLElement>('#connection')!;
const rendererSelect = document.querySelector<HTMLSelectElement>('#inspector-renderer')!;

function dispose(): void {
  lifetime.abort();
  cleanup.dispose();
  status.textContent = 'Disconnected. Reload to reconnect.';
}

/** Native connection or renderer startup can settle after the document has left. */
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
  lifetime.signal.throwIfAborted();
  await rpc.ensureTrusted();
  const path = new URL(rpc.connection.metaBaseUrl).pathname;
  const host = path.startsWith('/__devframes/') ? 'devframe' : 'devtools';
  const connection = await createDevframeProviderConnection({
    rpc,
    providerId: `example.${host}-inspector`,
    signal: lifetime.signal,
  });
  own(() => {
    connection.dispose();
  });
  lifetime.signal.throwIfAborted();
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
  await mountInspector({ rpc, client, provider: connection.provider.id });
}

async function mountInspector({
  rpc,
  client,
  provider,
}: {
  rpc: DevframeRpcClient;
  client: Client;
  provider: string;
}): Promise<void> {
  const index = await rpc.sharedState.get<JsonRenderIndex>(JSON_RENDER_INDEX_KEY);
  lifetime.signal.throwIfAborted();
  const view = Object.values(index.value()).find(
    (entry) => entry.id === 'response-inspector' && entry.scope === 'response-inspector',
  );
  if (view === undefined) throw new Error('The native inspector view is unavailable');
  const actions = [
    readInspectorAction,
    configureInspectorAction,
    markInspectorAction,
    resetInspectorAction,
  ];
  await selectRenderer({
    entry: {
      id: view.id,
      title: view.title,
      type: 'json-render',
      view,
      icon: 'ph:magnifying-glass',
    },
    container: document.querySelector<HTMLElement>('#inspector')!,
    context: {
      rpc: {
        ...rpc,
        call: createActionCall({
          rpc,
          actions: client.actions,
          signal: lifetime.signal,
          bindings: actions.map((action) => ({
            action,
            routing: { realm: 'devserver', provider },
          })),
        }),
      },
    },
  });
}

/** A renderer switch owns one native mount and preserves the provider's published spec/state. */
async function selectRenderer(options: Parameters<typeof renderer>[0]): Promise<void> {
  let unmount: (() => void) | undefined;
  own(() => {
    rendererSelect.disabled = true;
    unmount?.();
  });
  async function replace(): Promise<void> {
    rendererSelect.disabled = true;
    unmount?.();
    unmount = undefined;
    const next = await mountSelection(options);
    if (lifetime.signal.aborted) {
      next.dispose();
      return;
    }
    unmount = () => {
      next.dispose();
    };
    rendererSelect.disabled = false;
    status.textContent = 'Connected';
  }
  rendererSelect.addEventListener(
    'change',
    () => {
      void replace().catch((error: unknown) => {
        status.textContent = `Renderer failed: ${String(error)}`;
      });
    },
    { signal: lifetime.signal },
  );
  await replace();
}

async function mountSelection(options: Parameters<typeof renderer>[0]) {
  using resources = new DisposableStack();
  const target = document.createElement('div');
  options.container.append(target);
  resources.defer(() => {
    target.remove();
  });
  const render = rendererSelect.value === 'custom' ? domRenderer : renderer;
  const instance = await render({ ...options, container: target });
  resources.defer(() => instance.dispose?.());
  return resources.move();
}

window.addEventListener('pagehide', dispose, { once: true });
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    dispose();
    window.removeEventListener('pagehide', dispose);
  });
try {
  await start();
} catch (error) {
  dispose();
  status.textContent = `Connection failed: ${String(error)}`;
}
