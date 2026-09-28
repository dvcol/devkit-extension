import type { ChannelOptions } from 'birpc';
import {
  structuredCloneDeserialize,
  structuredCloneSerialize,
} from 'devframe/utils/structured-clone';

/** Native records survive Chrome's JSON messaging and Firefox's clone transport. */
export function portChannel(port: chrome.runtime.Port): ChannelOptions {
  return {
    post: (message) => {
      port.postMessage(message);
    },
    on: (handler) => {
      port.onMessage.addListener(handler);
    },
    off: (handler) => {
      port.onMessage.removeListener(handler);
    },
    serialize: structuredCloneSerialize,
    deserialize: (records: unknown[]): unknown => structuredCloneDeserialize(records),
  };
}
