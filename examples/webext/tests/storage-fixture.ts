import { MessageChannel } from 'node:worker_threads';
import type { MessagePort } from 'node:worker_threads';
import { vi } from 'vitest';
import { createRpcClient } from 'devframe/rpc/client';
import type { DevframeRpcServerFunctions } from 'devframe/types';
import { createPortChannel } from '@devkit/webext';
import { startExampleBackground } from '../src/background';

/** Resolve the current test's native API after its global fixture has been installed. */
vi.mock('@wxt-dev/browser', () => ({
  get browser() {
    return chrome;
  },
}));

/** Only native browser I/O is replaced; the background and RPC dispatch run unchanged. */
export function startStoredBackground() {
  const { port1, port2 } = new MessageChannel();
  const serving = endpoint(port1);
  const calling = endpoint(port2);
  const addListener = vi.fn<(listener: (port: unknown) => void) => void>();
  const get = vi.fn<(key: string) => Promise<Record<string, unknown>>>();
  const set = vi.fn<(value: Record<string, unknown>) => Promise<void>>().mockResolvedValue();
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'fixture',
      getURL: (path: string) => `chrome-extension://fixture/${path}`,
      onConnect: { addListener },
    },
    storage: { local: { get, set } },
  });
  const rpc = createRpcClient<DevframeRpcServerFunctions>(
    {},
    {
      channel: createPortChannel({ port: calling.port, onDisconnect() {} }),
      rpcOptions: { timeout: 1000 },
    },
  );
  return {
    get,
    set,
    rpc,
    serving: port1,
    start() {
      startExampleBackground();
      addListener.mock.calls[0]![0]({
        ...serving.port,
        name: 'devkit-native-port-example',
        sender: { id: 'fixture', url: 'chrome-extension://fixture/panel.html' },
        disconnect: serving.disconnect,
      });
    },
    [Symbol.dispose]() {
      rpc.$close();
      serving.disconnect();
      calling.disconnect();
    },
  };
}

function endpoint(port: MessagePort) {
  const disconnects = new Set<() => void>();
  return {
    port: {
      postMessage: (message: unknown) => {
        port.postMessage(message);
      },
      onMessage: {
        addListener: (listener: (message: unknown) => void) => {
          port.on('message', listener);
        },
        removeListener: (listener: (message: unknown) => void) => {
          port.off('message', listener);
        },
      },
      onDisconnect: {
        addListener: (listener: () => void) => {
          disconnects.add(listener);
        },
        removeListener: (listener: () => void) => {
          disconnects.delete(listener);
        },
      },
    },
    disconnect(this: void) {
      for (const listener of disconnects) listener();
      port.close();
    },
  };
}
