import { createRpcClient } from 'devframe/rpc/client';
import { structuredCloneSerialize } from 'devframe/utils/structured-clone';
import type { DevframeRpcServerFunctions } from 'devframe/types';

/** Produce actual native requests without duplicating Devframe's wire format. */
export async function createDeniedRequests(): Promise<unknown[]> {
  const messages: unknown[] = [];
  const client = createRpcClient<DevframeRpcServerFunctions>(
    {},
    {
      channel: {
        post: (message) => messages.push(message),
        on: () => {},
        serialize: structuredCloneSerialize,
      },
    },
  );
  const settled = Promise.allSettled([
    client.$call('probe:disable-service'),
    client.$call('devframe:rpc:server-state:get', 'devframe:json-render:global:counter'),
  ]);
  client.$close();
  await settled;
  return messages;
}

/** Runs in the packaged page, or injects the same attempt into an actual isolated content world. */
export async function probeCaller(options: { tabId?: number; name: string; messages: unknown[] }) {
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- WebDriver serializes the enclosing function; injected callbacks must be defined inside it.
  function attempt(input: { name: string; messages: unknown[] }): Promise<unknown[]> {
    return new Promise((resolve) => {
      const received: unknown[] = [];
      const port = chrome.runtime.connect({ name: input.name });
      port.onMessage.addListener((message: unknown) => {
        received.push(message);
      });
      port.onDisconnect.addListener(() => {
        /** Reading lastError acknowledges native disconnection errors without hiding received values. */
        void chrome.runtime.lastError;
        resolve(received);
      });
      port.postMessage({
        sender: { id: chrome.runtime.id, url: chrome.runtime.getURL('panel.html') },
      });
      for (const message of input.messages) port.postMessage(message);
    });
  }
  if (options.tabId === undefined) return attempt(options);
  const results = await chrome.scripting.executeScript({
    target: { tabId: options.tabId, frameIds: [0] },
    world: 'ISOLATED',
    func: attempt,
    args: [options],
  });
  return results[0]?.result;
}

/** These native targets are local to this browser operation, not portable router metadata. */
export async function readDocument(target: chrome.scripting.InjectionTarget) {
  const results = await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    func: () => ({
      title: document.title,
      runtime: typeof chrome === 'undefined' ? 'undefined' : typeof chrome.runtime?.connect,
    }),
  });
  const result = results[0];
  if (result?.result === undefined || result.documentId === undefined)
    throw new Error('The browser returned no readable document');
  return { documentId: result.documentId, ...result.result };
}

export async function findTab(url: string): Promise<number> {
  const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
  const tabId = tabs.find((tab) => tab.url === url)?.id;
  if (tabId === undefined) throw new Error('Missing permitted fixture tab');
  return tabId;
}
