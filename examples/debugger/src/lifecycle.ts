import type { ChromeSelectedTabLifecyclePort } from '@dvcol/cdb-extension';
import { nativeMessage } from './chrome.js';

type UpdatedListener = Parameters<
  ChromeSelectedTabLifecyclePort['tabs']['onUpdated']['addListener']
>[0];
type NativeUpdatedListener = Parameters<typeof chrome.tabs.onUpdated.addListener>[0];

/** CDB's public declaration expects tabId; Chrome's Tab carries id instead. */
export function nativeLifecycle(onError: (error: unknown) => void): ChromeSelectedTabLifecyclePort {
  const updatedListeners = new Map<UpdatedListener, NativeUpdatedListener>();
  return {
    debugger: { onEvent: nativeEvents(onError), onDetach: chrome.debugger.onDetach },
    tabs: {
      onRemoved: chrome.tabs.onRemoved,
      onUpdated: {
        addListener(listener) {
          const wrapped: NativeUpdatedListener = (tabId, changeInfo, tab) => {
            listener(tabId, changeInfo, {
              tabId,
              incognito: tab.incognito,
              active: tab.active,
              groupId: tab.groupId,
              windowId: tab.windowId,
              ...(tab.title === undefined ? {} : { title: tab.title }),
              ...(tab.url === undefined ? {} : { url: tab.url }),
            });
          };
          updatedListeners.set(listener, wrapped);
          chrome.tabs.onUpdated.addListener(wrapped);
        },
        removeListener(listener) {
          const wrapped = updatedListeners.get(listener);
          if (wrapped === undefined) return;
          chrome.tabs.onUpdated.removeListener(wrapped);
          updatedListeners.delete(listener);
        },
      },
    },
  };
}

type EventListener = Parameters<
  ChromeSelectedTabLifecyclePort['debugger']['onEvent']['addListener']
>[0];
type NativeEventListener = Parameters<typeof chrome.debugger.onEvent.addListener>[0];

function nativeEvents(
  onError: (error: unknown) => void,
): ChromeSelectedTabLifecyclePort['debugger']['onEvent'] {
  const eventListeners = new Map<EventListener, NativeEventListener>();
  return {
    addListener(listener) {
      const wrapped: NativeEventListener = (source, method, parameters) => {
        const result = nativeMessage.safeParse(parameters ?? {});
        if (!result.success) {
          onError(result.error);
          return;
        }
        listener(source, method, result.data);
      };
      eventListeners.set(listener, wrapped);
      chrome.debugger.onEvent.addListener(wrapped);
    },
    removeListener(listener) {
      const wrapped = eventListeners.get(listener);
      if (wrapped === undefined) return;
      chrome.debugger.onEvent.removeListener(wrapped);
      eventListeners.delete(listener);
    },
  };
}
