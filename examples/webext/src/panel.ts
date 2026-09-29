import { createExampleConnection } from './connection';
import { mountServerControls } from './servers';
import type { DevframeJsonRenderSpec } from '@devframes/json-render';
import renderer from '@devframes/json-render-ui/renderer';
import { createClient } from '@devkit/client';
import { createRpcProviderConnection } from '@devkit/devframe/client';
import type { RpcProviderConnection } from '@devkit/devframe/client';
import { counterCapability, increaseCounterAction, providerId, realm } from './contracts';

const { port, client, events, rpc, sharedState } = createExampleConnection(close);
const container = document.querySelector<HTMLElement>('#renderer')!;
const status = document.querySelector<HTMLElement>('#status')!;
const result = document.querySelector<HTMLElement>('#result')!;
let mounted: { dispose?: () => void } | undefined;
let closed = false;
const routedClient = createClient();
const disposeServers = mountServerControls(routedClient);
let providerConnection: RpcProviderConnection | undefined;
let unsubscribeCatalog: (() => void) | undefined;
function close(): void {
  if (closed) return;
  closed = true;
  rpc.$close();
  events.emit('connection:status', 'disconnected', 'connected');
  unsubscribeCatalog?.();
  disposeServers();
  routedClient.dispose();
  providerConnection?.dispose();
  for (const key of sharedState.keys()) sharedState.delete(key);
  mounted?.dispose?.();
  port.disconnect();
  status.textContent = 'Disconnected';
}
window.addEventListener('pagehide', close, { once: true });
document.querySelector('#disconnect')!.addEventListener('click', close);

const nativeContext = { rpc: { call: rpc.$call, sharedState } };
try {
  mounted = await renderer({
    entry: {
      id: 'counter',
      title: 'Counter',
      icon: 'i-ph:plus',
      type: 'json-render',
      view: { stateKey: 'devframe:json-render:global:counter' },
    },
    container,
    context: nativeContext,
  });
  providerConnection = await createRpcProviderConnection({
    rpc: { call: rpc.$call, client, events },
    providerId,
    realm,
  });
  if (closed) {
    providerConnection.dispose();
    mounted.dispose?.();
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
  result.textContent = error instanceof Error ? error.message : String(error);
}

async function run(operation: () => Promise<unknown>): Promise<void> {
  result.textContent = 'Pending';
  try {
    result.textContent = JSON.stringify(await operation());
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : String(error);
  }
}
document.querySelector('#identity')!.addEventListener('click', () => {
  void run(() => rpc.$call('probe:identity'));
});
document.querySelector('#wait')!.addEventListener('click', () => {
  void run(() => rpc.$call('probe:wait'));
});
document.querySelector('#release')!.addEventListener('click', () => {
  void run(() => rpc.$call('probe:release'));
});
document.querySelector('#executions')!.addEventListener('click', () => {
  void run(() => rpc.$call('devframe:rpc:server-state:get', 'probe:executions'));
});
document.querySelector('#write')!.addEventListener('click', () => {
  void run(async () => {
    const state = await sharedState.get<DevframeJsonRenderSpec>(
      'devframe:json-render:global:counter',
    );
    state.mutate((draft) => {
      draft.state = { value: 10 };
    });
    return 'Native write';
  });
});
document.querySelector('#rich')!.addEventListener('click', () => {
  void run(async () => {
    const value = await rpc.$call('probe:echo', new Map([['counter', 42n]]));
    return value instanceof Map && value.get('counter') === 42n;
  });
});
document.querySelector('#unsupported')!.addEventListener('click', () => {
  void run(() => rpc.$call('probe:echo', { callback: () => {} }));
});

document.querySelector('#remote-close')!.addEventListener('click', () => {
  void run(() => rpc.$call('probe:disconnect'));
});

document.querySelector('#routed')!.addEventListener('click', () => {
  void run(() =>
    routedClient.actions.invoke({
      action: increaseCounterAction,
      input: { amount: 1 },
      routing: { realm: realm.id, provider: providerId },
    }),
  );
});
document.querySelector('#capability')!.addEventListener('click', () => {
  void run(async () => {
    const resolution = await routedClient.capabilities.resolve({ capability: counterCapability });
    if (resolution.status !== 'available') throw new Error(`Counter is ${resolution.reason}`);
    return resolution.binding.api.read({});
  });
});
document.querySelector('#broadcast')!.addEventListener('click', () => {
  void run(() =>
    routedClient.actions.broadcast({
      action: increaseCounterAction,
      input: { amount: 1 },
      selection: [{ realm: realm.id }],
    }),
  );
});
document.querySelector('#disable-service')!.addEventListener('click', () => {
  void run(() => rpc.$call('probe:disable-service'));
});
document.querySelector('#enable-service')!.addEventListener('click', () => {
  void run(() => rpc.$call('probe:enable-service'));
});
