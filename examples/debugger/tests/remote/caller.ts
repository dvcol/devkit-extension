import { createClient } from '@devkit/client';
import { createRpcProviderConnection } from '@devkit/devframe/client';
import { createCdbClient } from '@dvcol/cdb-devframe/client';
import { connectDevframe } from 'devframe/client';
import { readPageTitleAction } from '../../src/contracts.ts';
import type { DebuggerTarget } from '../../src/contracts.ts';

declare global {
  interface Window {
    connectCaller: typeof connectCaller;
    caller: Awaited<ReturnType<typeof connectCaller>>;
  }
}

/** An extension-owned UI peer, separate from the background provider's native connection. */
async function connectCaller(baseURL: string, code: string) {
  await using cleanup = new AsyncDisposableStack();
  const peer = await connectDevframe({
    baseURL,
    connection: { isolated: true },
    simpleAuth: false,
    otpParam: false,
    webmcp: false,
    callTimeout: 5_000,
  });
  cleanup.defer(() => peer.close?.());
  if (!(await peer.requestTrustWithCode(code))) throw new Error('Native caller trust was rejected');
  await peer.ensureTrusted(5_000);
  const native = createCdbClient(peer);
  cleanup.defer(() => native.dispose());
  cleanup.defer(
    peer.events.on('connection:status', (status) => {
      if (status === 'disconnected') native.disconnected();
    }),
  );
  const connection = await createRpcProviderConnection({
    rpc: peer,
    providerId: 'example.remote-debugger',
    realm: { id: 'devserver' },
  });
  cleanup.defer(() => {
    connection.dispose();
  });
  const client = createClient({ connections: [connection] });
  cleanup.defer(() => {
    client.dispose();
  });
  const lifetime = cleanup.move();
  return {
    trusted: peer.isTrusted,
    requestAccess: () => native.invoke('browser.request_access', { level: 'debug' }),
    targets: () => native.invoke('browser.list_target_authorities', {}),
    readTitle: (input: DebuggerTarget) =>
      client.actions.invoke({ action: readPageTitleAction, input }),
    echo: () => peer.scope('fixture').rpc.call('echo', 'ordinary-after-contribution'),
    close: () => lifetime.disposeAsync(),
  };
}

window.connectCaller = connectCaller;
