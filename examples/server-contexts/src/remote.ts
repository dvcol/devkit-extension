import {
  connectRemoteCounter,
  counterActionMethod,
  counterIncreaseMethod,
  counterReadMethod,
} from './remote-client.js';
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
  cleanup.defer(host.probes.finish);
  const calls = await exerciseNativeCalls(host, trusted, denied);
  const pending = rejection(trusted.client.$call('example:counter:pending'));
  await Promise.race([
    host.probes.started,
    pending.then((message) => {
      throw new Error(`Native pending probe failed before dispatch: ${message}`);
    }),
  ]);
  await host.hub.close();
  const disconnected = await pending;
  host.probes.finish();
  await host.probes.completed;
  return {
    mode,
    ...calls,
    disconnected,
    clientClosed: trusted.client.$closed,
    serverCompletedAfterDisconnect: true,
    nativeMethodCount: host.context.rpc.list().filter((name) => name.startsWith('devkit:')).length,
  };
}

async function exerciseNativeCalls(
  host: RemoteHost,
  trusted: CounterConnection,
  denied: CounterConnection,
) {
  const incarnation = host.provider.provider.incarnation;
  const unauthorized = await rejection(
    denied.client.$call(counterActionMethod, incarnation, { amount: 100 }),
  );
  const accepted = {
    value: await trusted.client.$call(counterActionMethod, incarnation, { amount: 3 }),
    trusted: await trusted.client.$call('example:counter:trusted'),
  };
  const readValue = await trusted.client.$call(counterReadMethod, incarnation, {});
  const capabilityValue = await trusted.client.$call(counterIncreaseMethod, incarnation, {
    amount: 2,
  });
  const invalidInput = await rejection(
    trusted.client.$call(counterActionMethod, incarnation, { amount: Number.NaN }),
  );
  await host.provider.dispose();
  const disposed = await rejection(
    trusted.client.$call(counterActionMethod, incarnation, { amount: 100 }),
  );
  const hostAlive = await fetch(host.origin).then((response) => response.text());
  const successor = await host.replace();
  const stale = await rejection(
    trusted.client.$call(counterActionMethod, incarnation, { amount: 100 }),
  );
  const replacementValue = await trusted.client.$call(
    counterActionMethod,
    successor.provider.incarnation,
    { amount: 4 },
  );
  const replaced = {
    value: replacementValue,
    trusted: await trusted.client.$call('example:counter:trusted'),
  };
  return {
    unauthorized,
    accepted,
    readValue,
    capabilityValue,
    invalidInput,
    disposed,
    hostAlive,
    stale,
    replaced,
  };
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
