import { createExampleConnection } from './connection';
import { mountServerControls } from './servers';
import { createRendererRpc, recipients } from './renderer-actions';
import { mountPermissionControls } from './permissions';
import { JSON_RENDER_INDEX_KEY } from '@devframes/json-render';
import type { JsonRenderIndex, JsonRenderIndexEntry } from '@devframes/json-render';
import renderer from '@devframes/json-render-ui/renderer';
import { mountInspectorRendererControl, selectedInspectorRenderer } from './inspector-renderer';
import { createClient } from '@devkit/client';
import { createRpcProviderConnection } from '@devkit/devframe/client';
import type { RpcProviderConnection } from '@devkit/devframe/client';
import {
  counterCapability,
  counterStateKey,
  increaseCounterAction,
  providerId,
  realm,
} from './contracts';

/** Only popups need an intrinsic minimum width; Firefox omits getViews in DevTools contexts. */
if (chrome.extension.getViews?.({ type: 'popup' }).includes(window))
  document.documentElement.classList.add('popup');

const listeners = new AbortController();
const viewLifetime = new AbortController();
const { port, client, events, rpc, sharedState } = createExampleConnection(closeBackground);
const container = document.querySelector<HTMLElement>('#renderer')!;
const status = document.querySelector<HTMLElement>('#status')!;
const result = document.querySelector<HTMLElement>('#result')!;
interface MountedView {
  readonly signal: AbortSignal;
  readonly ready: Promise<void>;
  dispose(): Promise<void>;
}
const mountedViews = new Map<string, MountedView>();
let closed = false;
let backgroundClosed = false;
const routedClient = createClient();
const disposeServers = mountServerControls(routedClient);
const disposePermissions = mountPermissionControls();
let providerConnection: RpcProviderConnection | undefined;
let unsubscribeCatalog: (() => void) | undefined;
let unsubscribeViews: (() => void) | undefined;
function close(): void {
  if (closed) return;
  closed = true;
  disposeServers();
  routedClient.dispose();
  closeBackground();
}
/** A lost background Port does not own the page's independent server connections. */
function closeBackground(): void {
  if (backgroundClosed) return;
  backgroundClosed = true;
  viewLifetime.abort(new Error('Renderer connection closed'));
  rpc.$close();
  events.emit('connection:status', 'disconnected', 'connected');
  unsubscribeCatalog?.();
  unsubscribeViews?.();
  providerConnection?.dispose();
  for (const key of sharedState.keys()) sharedState.delete(key);
  for (const mounted of mountedViews.values()) void mounted.dispose().catch(reportViewFailure);
  mountedViews.clear();
  port.disconnect();
  status.textContent = 'Disconnected';
}
function dispose(): void {
  listeners.abort();
  disposePermissions();
  close();
}
window.addEventListener('pagehide', dispose, { once: true, signal: listeners.signal });
document
  .querySelector('#disconnect')!
  .addEventListener('click', close, { signal: listeners.signal });
import.meta.hot?.dispose(dispose);
import.meta.hot?.accept();

try {
  const index = await sharedState.get<JsonRenderIndex>(JSON_RENDER_INDEX_KEY);
  viewLifetime.signal.throwIfAborted();
  unsubscribeViews = index.on('updated', (snapshot) => {
    void updateViews(snapshot).catch(reportViewFailure);
  });
  await updateViews(index.value());
  providerConnection = await createRpcProviderConnection({
    rpc: { call: rpc.$call, client, events },
    providerId,
    realm,
  });
  if (backgroundClosed) {
    providerConnection.dispose();
    throw new Error('The native connection closed during startup');
  }
  routedClient.providers.attach({ connection: providerConnection });
  document.querySelector('#provider')!.textContent = JSON.stringify(providerConnection.provider);
  unsubscribeCatalog = providerConnection.catalog.subscribe((catalog) => {
    document.querySelector('#catalog')!.textContent =
      catalog?.capabilities[0]?.status ?? 'Disconnected';
  });
  status.textContent = 'Connected';
  mountInspectorRendererControl({
    signal: viewLifetime.signal,
    async replace() {
      const entry = Object.values(index.value()).find((view) => view.id === 'response-inspector');
      if (entry !== undefined) await mountedViews.get(entry.stateKey)?.dispose();
      if (!backgroundClosed) await updateViews(index.value());
    },
    reportFailure: reportViewFailure,
  });
} catch (error) {
  closeBackground();
  if (!listeners.signal.aborted)
    result.textContent = error instanceof Error ? error.message : String(error);
}

async function updateViews(index: JsonRenderIndex = {}): Promise<void> {
  for (const [stateKey, mounted] of mountedViews) {
    if (index[stateKey] !== undefined || mounted.signal.aborted) continue;
    void mounted
      .dispose()
      .finally(() => {
        if (mountedViews.get(stateKey) === mounted) mountedViews.delete(stateKey);
      })
      .catch(reportViewFailure);
  }
  for (const entry of Object.values(index)) {
    const previous = mountedViews.get(entry.stateKey);
    if (previous !== undefined && !previous.signal.aborted) continue;
    if (entry.id !== 'counter' && entry.id !== 'management' && entry.id !== 'response-inspector')
      continue;
    const target = {
      counter: container,
      management: document.querySelector<HTMLElement>('#management')!,
      'response-inspector': document.querySelector<HTMLElement>('#inspector')!,
    }[entry.id];
    mountedViews.set(entry.stateKey, mountView(entry, target, previous));
  }
  await Promise.all(Array.from(mountedViews.values(), (mounted) => mounted.ready));
}

/** Native index removal ends this mount's actions even if its renderer is still loading. */
function mountView(
  entry: JsonRenderIndexEntry,
  target: HTMLElement,
  previous?: MountedView,
): MountedView {
  const lifetime = new AbortController();
  let mounted: Awaited<ReturnType<typeof renderer>> | undefined;
  let disposal: Promise<void> | undefined;
  const ready = render().catch((error: unknown) => {
    if (!lifetime.signal.aborted) throw error;
  });
  const release = (): Promise<void> => {
    lifetime.abort(new Error('View removed'));
    disposal ??= ready.then(cleanup, cleanup);
    return disposal;
  };
  async function render(): Promise<void> {
    await previous?.dispose();
    if (lifetime.signal.aborted) return;
    let renderView = renderer;
    if (entry.id === 'response-inspector') renderView = selectedInspectorRenderer();
    mounted = await renderView({
      entry: {
        id: entry.id,
        title: entry.title,
        icon: 'i-ph:plus',
        type: 'json-render',
        view: entry,
      },
      container: target,
      context: {
        rpc: createRendererRpc({
          rpc: { call: rpc.$call, sharedState },
          actions: routedClient.actions,
          signal: lifetime.signal,
        }),
      },
    });
  }
  /** A pending native get can cache its state after removal; evict only after it has settled. */
  function cleanup(): void {
    try {
      mounted?.dispose?.();
    } finally {
      sharedState.delete(entry.stateKey);
    }
  }
  return { signal: lifetime.signal, dispose: release, ready };
}

function reportViewFailure(error: unknown): void {
  if (backgroundClosed) return;
  result.textContent = error instanceof Error ? error.message : String(error);
}

async function run(operation: () => Promise<unknown>): Promise<void> {
  result.textContent = 'Pending';
  try {
    const value = await operation();
    if (!listeners.signal.aborted) result.textContent = JSON.stringify(value);
  } catch (error) {
    if (!listeners.signal.aborted)
      result.textContent = error instanceof Error ? error.message : String(error);
  }
}
function onClick(selector: string, operation: () => Promise<unknown>): void {
  document.querySelector(selector)!.addEventListener(
    'click',
    () => {
      void run(operation);
    },
    { signal: listeners.signal },
  );
}
onClick('#identity', () => rpc.$call('probe:identity'));
onClick('#wait', () => rpc.$call('probe:wait'));
onClick('#release', () => rpc.$call('probe:release'));
onClick('#executions', () => rpc.$call('devframe:rpc:server-state:get', 'probe:executions'));
onClick('#write', async () => {
  const state = await sharedState.get<{ value: number }>(counterStateKey);
  state.mutate((draft) => {
    draft.value = 10;
  });
  return 'Native write';
});
onClick('#rich', async () => {
  const value = await rpc.$call('probe:echo', new Map([['counter', 42n]]));
  return value instanceof Map && value.get('counter') === 42n;
});
onClick('#unsupported', () => rpc.$call('probe:echo', { callback: () => {} }));
onClick('#remote-close', () => rpc.$call('probe:disconnect'));
function scriptRunAt(): chrome.extensionTypes.RunAt {
  const value = document.querySelector<HTMLSelectElement>('#script-run-at')!.value;
  if (value === 'document_start' || value === 'document_end' || value === 'document_idle')
    return value;
  throw new TypeError(`Unknown script stage: ${value}`);
}
for (const world of ['MAIN', 'ISOLATED'] as const)
  onClick(`#script-${world.toLowerCase()}`, () =>
    rpc.$call('example:scripts:install', {
      world,
      allFrames: document.querySelector<HTMLInputElement>('#script-all-frames')?.checked ?? false,
      runAt: scriptRunAt(),
    }),
  );
onClick('#script-disable', () => rpc.$call('example:scripts:disable'));
onClick('#script-enable', () => rpc.$call('example:scripts:enable'));
onClick('#script-dispose', () => rpc.$call('example:scripts:dispose'));
for (const name of ['lower', 'higher'] as const)
  for (const operation of ['install', 'disable', 'enable', 'dispose'] as const)
    onClick(`#headers-${name}-${operation}`, () =>
      rpc.$call('example:headers:control', name, operation),
    );
onClick('#headers-duplicate', () => rpc.$call('example:headers:failure', 'duplicate'));
onClick('#headers-invalid', () => rpc.$call('example:headers:failure', 'invalid'));
for (const name of ['lower', 'higher'] as const)
  for (const operation of ['install', 'disable', 'enable', 'dispose'] as const)
    onClick(`#redirects-${name}-${operation}`, () =>
      rpc.$call('example:redirects:control', name, operation),
    );
onClick('#redirects-duplicate', () => rpc.$call('example:redirects:failure', 'duplicate'));
onClick('#redirects-invalid', () => rpc.$call('example:redirects:failure', 'invalid'));
onClick('#routed', () =>
  routedClient.actions.invoke({
    action: increaseCounterAction,
    input: { amount: 1 },
    routing: { realm: realm.id, provider: providerId },
  }),
);
onClick('#capability', async () => {
  const resolution = await routedClient.capabilities.resolve({ capability: counterCapability });
  if (resolution.status !== 'available') throw new Error(`Counter is ${resolution.reason}`);
  return resolution.binding.api.read({});
});
onClick('#capabilities', () =>
  routedClient.capabilities.broadcast({
    capability: counterCapability,
    operation: 'read',
    input: {},
    selection: recipients(document.querySelector<HTMLSelectElement>('#json-selection')!.value),
  }),
);
onClick('#broadcast', () =>
  routedClient.actions.broadcast({
    action: increaseCounterAction,
    input: { amount: 1 },
    selection: [{ realm: realm.id }],
  }),
);

for (const operation of ['install', 'disable', 'enable', 'dispose', 'snapshot'] as const)
  onClick(`#response-${operation}`, () => rpc.$call('example:response:control', operation));
