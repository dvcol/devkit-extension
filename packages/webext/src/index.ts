import type { createRpcClient } from 'devframe/rpc/client';
import {
  structuredCloneDeserialize,
  structuredCloneSerialize,
} from 'devframe/utils/structured-clone';

/** The Port members used by a native channel, compatible with Chrome and Firefox. */
export interface RuntimePort {
  postMessage(message: unknown): void;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
    removeListener(listener: (message: unknown) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
    removeListener(listener: () => void): void;
  };
}

export interface PortChannelOptions {
  /** The caller owns admission and the lifetime of this Port. */
  port: RuntimePort;
  /** Close the native RPC connection so its pending calls reject on disconnection. */
  onDisconnect: () => void;
}

/** A native channel; RPC owns framing, correlation, errors and pending calls. */
export type PortChannel = Parameters<typeof createRpcClient>[1]['channel'];

/** Native records work through Chrome's JSON messaging and Firefox's structured clone. */
export function createPortChannel({ port, onDisconnect }: PortChannelOptions): PortChannel {
  return {
    post: (message: unknown) => {
      port.postMessage(message);
    },
    on: (listener) => {
      port.onMessage.addListener(listener);
      port.onDisconnect.addListener(onDisconnect);
    },
    off: (listener) => {
      port.onMessage.removeListener(listener);
      port.onDisconnect.removeListener(onDisconnect);
    },
    serialize: structuredCloneSerialize,
    deserialize: (records: unknown[]): unknown => structuredCloneDeserialize(records),
  };
}
