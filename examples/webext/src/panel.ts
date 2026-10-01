import { createExampleConnection } from './connection';
import { mountServerControls } from './servers';
import { createRendererRpc } from './renderer-actions';
import { mountPermissionControls } from './permissions';
import type { DevframeJsonRenderSpec } from '@devframes/json-render';
import renderer from '@devframes/json-render-ui/renderer';
import { createClient } from '@devkit/client';
import { createRpcProviderConnection } from '@devkit/devframe/client';
import type { RpcProviderConnection } from '@devkit/devframe/client';
import { counterCapability, increaseCounterAction, providerId, realm } from './contracts';

/** Only popups need an intrinsic minimum width; Firefox omits getViews in DevTools contexts. */
if (chrome.extension.getViews?.({ type: 'popup' }).includes(window))
  document.documentElement.classList.add('popup');

const listeners = new AbortController();
const viewLifetime = new AbortController();
const { port, client, events, rpc, sharedState } = createExampleConnection(close);
const container = document.querySelector<HTMLElement>('#renderer')!;
const status = document.querySelector<HTMLElement>('#status')!;
const result = document.querySelector<HTMLElement>('#result')!;
const mountedViews: Array<{ dispose?: () => void }> = [];
let closed = false;
const routedClient = createClient();
const disposeServers = mountServerControls(routedClient);
const disposePermissions = mountPermissionControls();
let providerConnection: RpcProviderConnection | undefined;
let unsubscribeCatalog: (() => void) | undefined;
function close(): void {
  if (closed) return;
  closed = true;
  viewLifetime.abort(new Error('Renderer connection closed'));
  rpc.$close();
  events.emit('connection:status', 'disconnected', 'connected');
  unsubscribeCatalog?.();
  disposeServers();
  routedClient.dispose();
  providerConnection?.dispose();
  for (const key of sharedState.keys()) sharedState.delete(key);
  for (const mounted of mountedViews) mounted.dispose?.();
  mountedViews.splice(0);
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

const nativeContext = {
  rpc: createRendererRpc({
    rpc: { call: rpc.$call, sharedState },
    actions: routedClient.actions,
    signal: viewLifetime.signal,
  }),
};
try {
  await mountView('counter', container);
  await mountView('management', document.querySelector<HTMLElement>('#management')!);
  providerConnection = await createRpcProviderConnection({
    rpc: { call: rpc.$call, client, events },
    providerId,
    realm,
  });
  if (closed) {
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
} catch (error) {
  close();
  if (!listeners.signal.aborted)
    result.textContent = error instanceof Error ? error.message : String(error);
}

async function mountView(id: string, target: HTMLElement): Promise<void> {
  const mounted = await renderer({
    entry: {
      id,
      title: id,
      icon: 'i-ph:plus',
      type: 'json-render',
      view: { stateKey: `devframe:json-render:global:${id}` },
    },
    container: target,
    context: nativeContext,
  });
  if (closed) {
    mounted.dispose?.();
    throw new Error('The native connection closed during renderer startup');
  }
  mountedViews.push(mounted);
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
  const state = await sharedState.get<DevframeJsonRenderSpec>(
    'devframe:json-render:global:counter',
  );
  state.mutate((draft) => {
    draft.state = { value: 10 };
  });
  return 'Native write';
});
onClick('#rich', async () => {
  const value = await rpc.$call('probe:echo', new Map([['counter', 42n]]));
  return value instanceof Map && value.get('counter') === 42n;
});
onClick('#unsupported', () => rpc.$call('probe:echo', { callback: () => {} }));
onClick('#remote-close', () => rpc.$call('probe:disconnect'));
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
onClick('#broadcast', () =>
  routedClient.actions.broadcast({
    action: increaseCounterAction,
    input: { amount: 1 },
    selection: [{ realm: realm.id }],
  }),
);
