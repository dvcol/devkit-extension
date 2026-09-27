import { connectRemoteCounter } from './remote-client.js';
import { createRemoteHost } from './remote-host.js';

type RemoteHost = Awaited<ReturnType<typeof createRemoteHost>>;
type CounterConnection = ReturnType<typeof connectRemoteCounter>;

/** Exercise actual native auth, WebSocket RPC and contribution lifetime on a loopback host. */
export async function runRemoteDemo(mode: 'devframe' | 'devtools') {
  await using cleanup = new AsyncDisposableStack();
  const host = await createRemoteHost(mode);
  cleanup.defer(host.close);
  const denied = connectRemoteCounter(host.url, 'intentionally-invalid-example-token');
  cleanup.defer(denied.close);
  const trusted = connectRemoteCounter(host.url, host.token);
  cleanup.defer(trusted.close);
  cleanup.defer(host.counter.finish);
  const calls = await exerciseNativeCalls(host, trusted, denied);
  const pending = rejection(trusted.client.$call('example:counter:pending'));
  await host.counter.started;
  await host.hub.close();
  const disconnected = await pending;
  host.counter.finish();
  await host.counter.completed;
  return {
    mode,
    ...calls,
    disconnected,
    clientClosed: trusted.client.$closed,
    serverCompletedAfterDisconnect: true,
    nativeMethodCount: host.context.rpc.list().filter((name) => name.startsWith('example:counter:'))
      .length,
  };
}

async function exerciseNativeCalls(
  host: RemoteHost,
  trusted: CounterConnection,
  denied: CounterConnection,
) {
  const incarnation = host.provider.provider.incarnation;
  const unauthorized = await rejection(
    denied.client.$call('example:counter:increase', incarnation, { amount: 100 }),
  );
  const accepted = await trusted.client.$call('example:counter:increase', incarnation, {
    amount: 3,
  });
  const invalidInput = await rejection(
    trusted.client.$call('example:counter:increase', incarnation, { amount: Number.NaN }),
  );
  await host.provider.dispose();
  const disposed = await rejection(
    trusted.client.$call('example:counter:increase', incarnation, { amount: 100 }),
  );
  const hostAlive = await fetch(host.origin).then((response) => response.text());
  const successor = await host.replace();
  const stale = await rejection(
    trusted.client.$call('example:counter:increase', incarnation, { amount: 100 }),
  );
  const replaced = await trusted.client.$call(
    'example:counter:increase',
    successor.provider.incarnation,
    { amount: 4 },
  );
  return { unauthorized, accepted, invalidInput, disposed, hostAlive, stale, replaced };
}

async function rejection(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error('Expected the native call to reject');
}
