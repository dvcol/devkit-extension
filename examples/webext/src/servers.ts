import type { Client, ProviderAttachment } from '@devkit/client';
import { createDevframeProviderConnection } from '@devkit/server/client';
import type { DevframeProviderConnection } from '@devkit/server/client';
import { connectDevframe } from 'devframe/client';
import { increaseCounterAction } from './contracts';

interface ConfiguredServer {
  readonly baseURL: string;
  readonly providerId: string;
  readonly authToken: string;
}

/** The server must allow this extension's origin through its native allowedOrigins option. */
function connectServer(configured: ConfiguredServer) {
  return connectDevframe({
    baseURL: configured.baseURL,
    authToken: configured.authToken,
    connection: { isolated: true },
    simpleAuth: false,
    otpParam: false,
    webmcp: false,
    callTimeout: 3000,
  });
}

function createServerAttachments(client: Client) {
  const cleanup = new Set<() => void>();
  let disposed = false;
  async function attach(configured: ConfiguredServer): Promise<string> {
    const rpc = await connectServer(configured);
    let connection: DevframeProviderConnection | undefined;
    let attachment: ProviderAttachment | undefined;
    const dispose = () => {
      cleanup.delete(dispose);
      attachment?.detach();
      connection?.dispose();
      rpc.close?.();
    };
    cleanup.add(dispose);
    try {
      if (disposed) throw new Error('The page connection is closed');
      connection = await createDevframeProviderConnection({
        rpc,
        providerId: configured.providerId,
      });
      if (disposed) throw new Error('The page connection is closed');
      attachment = client.providers.attach({ connection });
      return `Connected ${configured.providerId}`;
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
  const attachments = createServerAttachments(client);
  const form = document.querySelector<HTMLFormElement>('#server-form')!;
  const result = document.querySelector<HTMLOutputElement>('#server-result')!;
  const providers = document.querySelector<HTMLOutputElement>('#providers')!;
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
    void show(result, () => attachments.attach(configured));
  };
  form.addEventListener('submit', submit);
  const releaseButtons = mountRoutingButtons(client, result);
  return () => {
    form.removeEventListener('submit', submit);
    unsubscribe();
    releaseButtons();
    attachments.dispose();
  };
}

function mountRoutingButtons(client: Client, result: HTMLOutputElement): () => void {
  const servers = document.querySelector<HTMLButtonElement>('#servers-increase')!;
  const all = document.querySelector<HTMLButtonElement>('#all-increase')!;
  const fallback = document.querySelector<HTMLButtonElement>('#fallback-increase')!;
  const serverHandler = () => {
    void show(result, () =>
      client.actions.broadcast({
        action: increaseCounterAction,
        input: { amount: 1 },
        selection: [{ realm: 'devserver' }],
      }),
    );
  };
  const allHandler = () => {
    void show(result, () =>
      client.actions.broadcast({
        action: increaseCounterAction,
        input: { amount: 1 },
        selection: [{ realm: 'devserver' }, { realm: 'webext' }],
      }),
    );
  };
  const fallbackHandler = () => {
    const provider = document.querySelector<HTMLInputElement>('#preferred-server')!.value;
    void show(result, () =>
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

async function show(result: HTMLOutputElement, operation: () => Promise<unknown>): Promise<void> {
  result.textContent = 'Pending';
  try {
    result.textContent = JSON.stringify(await operation());
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : String(error);
  }
}
