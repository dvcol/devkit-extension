import type { DevframeConnection } from 'devframe/client';
import { DEVFRAME_CONNECTION_KEY } from 'devframe/constants';

/** Reads one selected top-level document; neither monitors tabs nor forwards page requests. */
async function readPageConnection(tabId: number): Promise<DevframeConnection> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: 'MAIN',
    args: [DEVFRAME_CONNECTION_KEY],
    func: (connectionKey) => {
      const connection: unknown = Reflect.get(globalThis, connectionKey);
      return connection;
    },
  });
  const connection: unknown = injection?.result;
  if (connection === undefined || connection === null)
    throw new Error('The selected document has no published Devframe connection');
  if (
    typeof connection !== 'object' ||
    !('connectionMeta' in connection) ||
    typeof connection.connectionMeta !== 'object' ||
    connection.connectionMeta === null ||
    !('metaBaseUrl' in connection) ||
    typeof connection.metaBaseUrl !== 'string'
  )
    throw new Error('The selected document published a malformed Devframe connection');
  /** Native metadata has no public validator. Preserve it after the upstream viewer's envelope check. */
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Browser handoff of the native descriptor; auth still belongs to the backend.
  return connection as DevframeConnection;
}

export function mountPageConnections(
  connect: (connection: DevframeConnection) => Promise<void>,
): () => void {
  const pages = document.querySelector<HTMLSelectElement>('#local-pages')!;
  const refresh = document.querySelector<HTMLButtonElement>('#refresh-pages')!;
  const attach = document.querySelector<HTMLButtonElement>('#connect-page')!;
  const result = document.querySelector<HTMLOutputElement>('#page-result')!;
  const lifetime = new AbortController();
  const refreshHandler = () => {
    void report(
      result,
      async () => {
        const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
        if (lifetime.signal.aborted) return;
        pages.replaceChildren();
        for (const tab of tabs) {
          if (tab.id !== undefined)
            pages.add(new Option(tab.url ?? String(tab.id), String(tab.id)));
        }
        result.textContent = `${pages.length} local pages`;
      },
      lifetime.signal,
    );
  };
  const attachHandler = () => {
    void report(
      result,
      async () => {
        if (!pages.value) throw new Error('Select a local page first');
        const connection = await readPageConnection(Number(pages.value));
        if (lifetime.signal.aborted) return;
        await connect(connection);
      },
      lifetime.signal,
    );
  };
  refresh.addEventListener('click', refreshHandler, { signal: lifetime.signal });
  attach.addEventListener('click', attachHandler, { signal: lifetime.signal });
  return () => {
    lifetime.abort();
  };
}

async function report(
  result: HTMLOutputElement,
  operation: () => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  result.textContent = '';
  try {
    await operation();
  } catch (error) {
    if (!signal.aborted)
      result.textContent = error instanceof Error ? error.message : String(error);
  }
}
