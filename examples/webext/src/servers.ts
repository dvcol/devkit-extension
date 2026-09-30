import type { Client, ProviderAttachment } from '@devkit/client';
import { createDevframeProviderConnection } from '@devkit/server/client';
import type { DevframeProviderConnection } from '@devkit/server/client';
import { connectDevframe } from 'devframe/client';
import type { SetupDevframeConnectionOptions } from 'devframe/client';
import { increaseCounterAction } from './contracts';
import { mountPageConnections } from './pages';
import { mountServerViews } from './server-views';

interface ConfiguredServer extends SetupDevframeConnectionOptions {
  readonly providerId: string;
}

/** The server must allow this extension's origin through its native allowedOrigins option. */
function connectServer(options: SetupDevframeConnectionOptions) {
  return connectDevframe({
    ...options,
    connection: { ...options.connection, isolated: true },
    simpleAuth: false,
    otpParam: false,
    webmcp: false,
    callTimeout: 3000,
  });
}

function createServerAttachments(client: Client) {
  const cleanup = new Set<() => void>();
  let disposed = false;
  async function attach({ providerId, ...options }: ConfiguredServer): Promise<string> {
    const rpc = await connectServer(options);
    let connection: DevframeProviderConnection | undefined;
    let attachment: ProviderAttachment | undefined;
    let releaseViews: (() => void) | undefined;
    const dispose = () => {
      cleanup.delete(dispose);
      releaseViews?.();
      attachment?.detach();
      connection?.dispose();
      rpc.close?.();
    };
    cleanup.add(dispose);
    try {
      if (disposed) throw new Error('The page connection is closed');
      connection = await createDevframeProviderConnection({
        rpc,
        providerId,
      });
      if (disposed) throw new Error('The page connection is closed');
      attachment = client.providers.attach({ connection });
      releaseViews = await mountServerViews({ providerId, rpc, actions: client.actions });
      if (disposed) throw new Error('The page connection is closed');
      return `Connected ${providerId}`;
    } catch (error) {
      dispose();
      throw error;
    }
  }
  return {
    attach,
    dispose: () => {
      disposed = true;
      for (const dispose of cleanup) dispose();
    },
  };
}

export function mountServerControls(client: Client) {
  const lifetime = new AbortController();
  const attachments = createServerAttachments(client);
  const form = document.querySelector<HTMLFormElement>('#server-form')!;
  const result = document.querySelector<HTMLOutputElement>('#server-result')!;
  const providers = document.querySelector<HTMLOutputElement>('#providers')!;
  const report = (operation: () => Promise<unknown>) => show(result, operation, lifetime.signal);
  const unsubscribe = client.providers.subscribe((snapshot) => {
    providers.textContent = JSON.stringify(snapshot);
  });
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const configured = {
      baseURL: document.querySelector<HTMLInputElement>('#server-url')!.value,
      providerId: document.querySelector<HTMLInputElement>('#server-id')!.value,
      authToken: document.querySelector<HTMLInputElement>('#server-token')!.value,
    };
    document.querySelector<HTMLInputElement>('#server-token')!.value = '';
    void report(() => attachments.attach(configured));
  };
  form.addEventListener('submit', submit);
  const releaseButtons = mountRoutingButtons(client, report);
  const releasePages = mountPageConnections((connection) =>
    report(() =>
      attachments.attach({
        providerId: document.querySelector<HTMLInputElement>('#server-id')!.value,
        connection,
      }),
    ),
  );
  return () => {
    lifetime.abort();
    form.removeEventListener('submit', submit);
    unsubscribe();
    releaseButtons();
    releasePages();
    attachments.dispose();
  };
}

function mountRoutingButtons(
  client: Client,
  report: (operation: () => Promise<unknown>) => Promise<void>,
): () => void {
  const servers = document.querySelector<HTMLButtonElement>('#servers-increase')!;
  const all = document.querySelector<HTMLButtonElement>('#all-increase')!;
  const fallback = document.querySelector<HTMLButtonElement>('#fallback-increase')!;
  const serverHandler = () => {
    void report(() =>
      client.actions.broadcast({
        action: increaseCounterAction,
        input: { amount: 1 },
        selection: [{ realm: 'devserver' }],
      }),
    );
  };
  const allHandler = () => {
    void report(() =>
      client.actions.broadcast({
        action: increaseCounterAction,
        input: { amount: 1 },
        selection: [{ realm: 'devserver' }, { realm: 'webext' }],
      }),
    );
  };
  const fallbackHandler = () => {
    const provider = document.querySelector<HTMLInputElement>('#preferred-server')!.value;
    void report(() =>
      client.actions.invoke({
        action: increaseCounterAction,
        input: { amount: 1 },
        routing: [{ realm: 'devserver', provider }, { realm: 'webext' }],
      }),
    );
  };
  servers.addEventListener('click', serverHandler);
  all.addEventListener('click', allHandler);
  fallback.addEventListener('click', fallbackHandler);
  return () => {
    servers.removeEventListener('click', serverHandler);
    all.removeEventListener('click', allHandler);
    fallback.removeEventListener('click', fallbackHandler);
  };
}

async function show(
  result: HTMLOutputElement,
  operation: () => Promise<unknown>,
  signal: AbortSignal,
): Promise<void> {
  result.textContent = 'Pending';
  try {
    const value = await operation();
    if (!signal.aborted) result.textContent = JSON.stringify(value);
  } catch (error) {
    if (!signal.aborted)
      result.textContent = error instanceof Error ? error.message : String(error);
  }
}
