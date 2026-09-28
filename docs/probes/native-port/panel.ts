import type { DevframeJsonRenderSpec } from '@devframes/json-render';
import type { RpcClientEvents } from 'devframe/client';
import type { DevframeRpcClientFunctions, DevframeRpcServerFunctions } from 'devframe/types';
import renderer from '@devframes/json-render-ui/renderer';
import { RpcFunctionsCollectorBase } from 'devframe/rpc';
import { createRpcClient } from 'devframe/rpc/client';
import { createRpcSharedStateClientHost } from 'devframe/rpc/shared-state';
import { createEventEmitter } from 'devframe/utils/events';
import { portChannel } from './channel';

const port = chrome.runtime.connect({ name: 'native-port-probe' });
const client = new RpcFunctionsCollectorBase<DevframeRpcClientFunctions, undefined>(undefined);
const rpc = createRpcClient<DevframeRpcServerFunctions, DevframeRpcClientFunctions>(
  client.functions,
  { channel: portChannel(port) },
);
const sharedState = createRpcSharedStateClientHost({
  call: rpc.$call,
  callEvent: rpc.$callEvent,
  client,
  events: createEventEmitter<RpcClientEvents>(),
  isTrusted: true,
  connectionMeta: { backend: 'none' },
});
const container = document.querySelector<HTMLElement>('#renderer')!;
const status = document.querySelector<HTMLElement>('#status')!;
const result = document.querySelector<HTMLElement>('#result')!;
let mounted: { dispose?: () => void } | undefined;
let closed = false;
function close(): void {
  if (closed) return;
  closed = true;
  port.onDisconnect.removeListener(close);
  rpc.$close();
  for (const key of sharedState.keys()) sharedState.delete(key);
  mounted?.dispose?.();
  port.disconnect();
  status.textContent = 'Disconnected';
}
port.onDisconnect.addListener(close);
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
  if (closed) mounted.dispose?.();
  else status.textContent = 'Connected';
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
