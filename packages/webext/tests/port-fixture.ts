import { MessageChannel } from 'node:worker_threads';
import type { MessagePort } from 'node:worker_threads';
import type { RuntimePort } from '../src/index';

function postMessage(messagePort: MessagePort, encoding: 'json' | 'clone', message: unknown) {
  if (encoding === 'json') {
    const decoded: unknown = JSON.parse(JSON.stringify(message));
    messagePort.postMessage(decoded);
    return;
  }
  messagePort.postMessage(message);
}

function observeDelivery(delivery: unknown, deliveries: Promise<unknown>[], errors: unknown[]) {
  if (!(delivery instanceof Promise)) return;
  deliveries.push(delivery.catch((error: unknown) => errors.push(error)));
}

function createEndpoint(messagePort: MessagePort, encoding: 'json' | 'clone') {
  const messages = new Set<(message: unknown) => unknown>();
  const disconnects = new Set<() => void>();
  const deliveries: Promise<unknown>[] = [];
  const errors: unknown[] = [];
  let disconnected = false;
  let postsAfterDisconnect = 0;
  messagePort.on('message', (message: unknown) => {
    for (const listener of messages) observeDelivery(listener(message), deliveries, errors);
  });
  const port: RuntimePort = {
    postMessage: (message) => {
      if (disconnected) {
        postsAfterDisconnect += 1;
        throw new Error('Attempting to use a disconnected port object');
      }
      postMessage(messagePort, encoding, message);
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
    errors,
    postsAfterDisconnect: () => postsAfterDisconnect,
    completeDeliveries: () => Promise.all(deliveries),
    listenerCount: () => messages.size + disconnects.size,
    disconnect: () => {
      disconnected = true;
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
