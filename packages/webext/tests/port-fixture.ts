import { MessageChannel } from 'node:worker_threads';
import type { MessagePort } from 'node:worker_threads';
import type { RuntimePort } from '../src/index';

function createEndpoint(messagePort: MessagePort, encoding: 'json' | 'clone') {
  const messages = new Set<(message: unknown) => void>();
  const disconnects = new Set<() => void>();
  messagePort.on('message', (message: unknown) => {
    for (const listener of messages) listener(message);
  });
  const port: RuntimePort = {
    postMessage: (message) => {
      if (encoding === 'json') {
        const decoded: unknown = JSON.parse(JSON.stringify(message));
        messagePort.postMessage(decoded);
        return;
      }
      messagePort.postMessage(message);
    },
    onMessage: {
      addListener: (listener) => {
        messages.add(listener);
      },
      removeListener: (listener) => {
        messages.delete(listener);
      },
    },
    onDisconnect: {
      addListener: (listener) => {
        disconnects.add(listener);
      },
      removeListener: (listener) => {
        disconnects.delete(listener);
      },
    },
  };
  return {
    port,
    listenerCount: () => messages.size + disconnects.size,
    disconnect: () => {
      for (const listener of disconnects) listener();
      messagePort.close();
    },
  };
}

export function createPortPair(encoding: 'json' | 'clone') {
  const channel = new MessageChannel();
  const first = createEndpoint(channel.port1, encoding);
  const second = createEndpoint(channel.port2, encoding);
  return {
    first,
    second,
    disconnect: () => {
      first.disconnect();
      second.disconnect();
    },
  };
}
