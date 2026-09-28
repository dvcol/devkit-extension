import type {
  DevframeNodeRpcSessionMeta,
  DevframeRpcClientFunctions,
  DevframeRpcServerFunctions,
  RpcFunctionsHost,
} from 'devframe/types';
import { createJsonRenderView } from '@devframes/json-render/view';
import { RpcFunctionsCollectorBase } from 'devframe/rpc';
import { createRpcServer } from 'devframe/rpc/server';
import { createRpcSharedStateServerHost } from 'devframe/rpc/shared-state';
import { createSharedState } from 'devframe/utils/shared-state';
import { portChannel } from './channel';
import { spec } from './spec';

const collector = new RpcFunctionsCollectorBase<DevframeRpcServerFunctions, undefined>(undefined);
const group = createRpcServer<DevframeRpcClientFunctions, DevframeRpcServerFunctions>(
  collector.functions,
);
const broadcast: RpcFunctionsHost['broadcast'] = async (options) => {
  const { filter } = options;
  await Promise.allSettled(
    group.clients
      .filter((client) => filter?.(client) !== false)
      .map((client) => client.$callRaw({ ...options, optional: true, event: true })),
  );
};
const sharedState = createRpcSharedStateServerHost({
  register: (definition) => {
    collector.register(definition);
  },
  broadcast,
});
const view = createJsonRenderView({ rpc: { sharedState } }, { id: 'counter', spec });
const executions = createSharedState({ initialValue: { started: 0, completed: 0 } });
void sharedState.get('probe:executions', { sharedState: executions });
let release: (() => void) | undefined;

collector.register({
  name: 'probe:increase',
  type: 'action',
  handler: () => {
    const value = Number(view.value().state?.value) + 1;
    view.patchState([{ op: 'replace', path: '/value', value }]);
    return value;
  },
});
collector.register({ name: 'probe:echo', type: 'query', handler: (value: unknown) => value });
collector.register({
  name: 'probe:wait',
  type: 'action',
  handler: async () => {
    executions.mutate((state) => {
      state.started += 1;
    });
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    executions.mutate((state) => {
      state.completed += 1;
    });
  },
});
collector.register({ name: 'probe:release', type: 'action', handler: () => release?.() });
collector.register({
  name: 'probe:identity',
  type: 'query',
  async handler(this: {
    $meta: DevframeNodeRpcSessionMeta & { sender: chrome.runtime.MessageSender };
  }) {
    await Promise.resolve();
    return { id: this.$meta.id, url: this.$meta.sender.url ?? '' };
  },
});

collector.register({
  name: 'probe:disconnect',
  type: 'action',
  handler(this: { $meta: { port: chrome.runtime.Port; close: () => void } }) {
    this.$meta.close();
    this.$meta.port.disconnect();
  },
});

let nextSessionId = 0;
chrome.runtime.onConnect.addListener((port) => {
  /** Only packaged extension pages are admitted by this fixture. */
  if (
    port.name !== 'native-port-probe' ||
    port.sender?.id !== chrome.runtime.id ||
    port.sender.url !== chrome.runtime.getURL('panel.html')
  ) {
    port.disconnect();
    return;
  }
  const meta = {
    id: nextSessionId++,
    subscribedStates: new Set<string>(),
    sender: port.sender,
    port,
    close: disconnect,
  };
  const channel = { ...portChannel(port), meta };
  group.updateChannels((channels) => {
    channels.push(channel);
  });
  function disconnect(): void {
    port.onDisconnect.removeListener(disconnect);
    group.clients.find((client) => client.$meta === meta)?.$close();
    group.updateChannels((channels) => {
      channels.splice(channels.indexOf(channel), 1);
    });
  }
  port.onDisconnect.addListener(disconnect);
});
