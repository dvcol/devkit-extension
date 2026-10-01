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
import { createPortChannel } from '@devkit/webext';
import { spec } from './spec';
import { managementSpec } from './management-spec';
import { createExampleProvider } from './provider';

/** Initialize once during the native background entrypoint's synchronous startup. */
export function startExampleBackground(): void {
  const background = createBackground();
  registerProbeActions(background);
  registerPendingActions(background);
  connectPorts(background);
}

function createBackground() {
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
  const context = { rpc: { sharedState } };
  const view = createJsonRenderView(context, { id: 'counter', spec });
  const management = createJsonRenderView(context, { id: 'management', spec: managementSpec });
  const provider = createExampleProvider({
    rpc: {
      register: collector.register.bind(collector),
      has: collector.has.bind(collector),
      broadcast,
    },
    view,
  });
  void provider.then(
    ({ catalog }) => {
      return catalog.subscribe((snapshot) => {
        const status = snapshot.capabilities[0]?.status ?? 'unavailable';
        management.patchState([{ op: 'replace', path: '/status', value: status }]);
      });
    },
    (error: unknown) => {
      console.error('Provider startup failed', error);
    },
  );
  return { collector, group, provider, sharedState };
}

type Background = ReturnType<typeof createBackground>;

function registerProbeActions({ collector, provider }: Background): void {
  collector.register({
    name: 'probe:disable-service',
    type: 'action',
    handler: async () => (await provider).startup.services[0]!.disable(),
  });
  collector.register({
    name: 'probe:enable-service',
    type: 'action',
    handler: async () => (await provider).startup.services[0]!.enable(),
  });
  collector.register({ name: 'probe:echo', type: 'query', handler: (value: unknown) => value });
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
}

function registerPendingActions({ collector, sharedState }: Background): void {
  const executions = createSharedState({ initialValue: { started: 0, completed: 0 } });
  void sharedState.get('probe:executions', { sharedState: executions });
  let release: (() => void) | undefined;
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
}

function connectPorts({ group }: Background): void {
  let nextSessionId = 0;
  chrome.runtime.onConnect.addListener((port) => {
    /** Only packaged extension pages are admitted by this fixture. */
    if (
      port.name !== 'devkit-native-port-example' ||
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
    const channel = { ...createPortChannel({ port, onDisconnect: disconnect }), meta };
    group.updateChannels((channels) => {
      channels.push(channel);
    });
    function disconnect(): void {
      group.clients.find((client) => client.$meta === meta)?.$close();
      group.updateChannels((channels) => {
        const index = channels.indexOf(channel);
        if (index !== -1) channels.splice(index, 1);
      });
    }
  });
}
