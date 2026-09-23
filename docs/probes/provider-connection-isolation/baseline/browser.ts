import { getDevToolsRpcClient } from '@vitejs/devtools-kit/client';
import { connectDevframe, DevframeConnectionError } from 'devframe/client';
import type { DevframeRpcClient } from 'devframe/client';
import type { CounterState } from './contracts.js';
import { readConnectionMeta, readCredentials } from './validation.js';
import {
  clients,
  closeClient,
  observeState,
  options,
  trusted,
  unsubscribeFunctions,
  verify,
  verifyReceipt,
} from './browser-helpers.js';
import { proveAuthBroadcast } from './auth-probe.js';
const observations: Record<string, unknown> = {};
const sharedStateValues: Record<string, number[]> = { endpointA: [], endpointB: [] };
const expectedBackgroundErrors: string[] = [];
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason instanceof DevframeConnectionError && event.reason.kind === 'auth') {
    expectedBackgroundErrors.push(event.reason.kind);
    event.preventDefault();
  }
});
function show(value: unknown): void {
  const output = document.querySelector('pre');
  if (output) output.textContent = JSON.stringify(value, null, 2);
}
async function report(value: unknown): Promise<void> {
  const response = await fetch('/__probe-control/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  verify(response.ok, 'Result delivery failed');
}
async function proveBaseReuse(credential: string): Promise<void> {
  const firstClient = await trusted(
    await connectDevframe({ ...options, baseURL: '/__endpoint-a/', authToken: credential }),
  );
  const firstReceipt = await firstClient.call('probe:increment', 1);
  verifyReceipt(firstReceipt, 'endpointA', 1);
  const inheritedClient = await trusted(
    await connectDevframe({ ...options, baseURL: '/__endpoint-b/', authToken: credential }),
  );
  const inheritedReceipt = await inheritedClient.call('probe:increment', 2);
  verifyReceipt(inheritedReceipt, 'endpointA', 3);
  observations.baseOnly = {
    requestedSecondBase: '/__endpoint-b/',
    firstMetadataPath: new URL(firstClient.connection.metaBaseUrl).pathname,
    secondMetadataPath: new URL(inheritedClient.connection.metaBaseUrl).pathname,
    firstReceipt,
    inheritedReceipt,
  };
  await closeClient(firstClient);
  await closeClient(inheritedClient);
}
async function explicitClients(credentials: Awaited<ReturnType<typeof readCredentials>>) {
  const clientA = await trusted(
    await connectDevframe({
      ...options,
      connection: {
        connectionMeta: await readConnectionMeta('/__endpoint-a/'),
        metaBaseUrl: new URL('/__endpoint-a/__connection.json', location.href).href,
        authToken: credentials.endpointA,
      },
    }),
  );
  const clientB = await trusted(
    await getDevToolsRpcClient({
      ...options,
      baseURL: '/__endpoint-b/',
      connectionMeta: await readConnectionMeta('/__endpoint-b/'),
      authToken: credentials.endpointB,
    }),
  );
  for (const [endpoint, client] of [
    ['endpointA', clientA],
    ['endpointB', clientB],
  ] as const) {
    const state = await client.sharedState.get<CounterState>('probe:counter');
    sharedStateValues[endpoint]?.push(state.value().value);
    unsubscribeFunctions.push(
      state.on('updated', (value) => {
        sharedStateValues[endpoint]?.push(value.value);
      }),
    );
  }
  return { clientA, clientB };
}
async function proveExplicitIsolation(
  clientA: DevframeRpcClient,
  clientB: DevframeRpcClient,
  distinctCredentials: boolean,
): Promise<void> {
  const receiptA = await clientA.call('probe:increment', 4);
  const receiptB = await clientB.call('probe:increment', 10);
  verifyReceipt(receiptA, 'endpointA', 7);
  verifyReceipt(receiptB, 'endpointB', 10);
  await observeState(clientA, 'endpointA', 7);
  await observeState(clientB, 'endpointB', 10);
  const afterCredentialB = await clientA.call('probe:receipt');
  verifyReceipt(afterCredentialB, 'endpointA', 7);
  observations.explicit = {
    distinctCredentials,
    metadataA: new URL(clientA.connection.metaBaseUrl).pathname,
    metadataB: new URL(clientB.connection.metaBaseUrl).pathname,
    receiptA,
    receiptB,
    afterCredentialB,
  };
}
async function proveCloseIsolation(
  clientA: DevframeRpcClient,
  clientB: DevframeRpcClient,
): Promise<void> {
  await closeClient(clientA);
  let closedCallRejected = false;
  try {
    await clientA.call('probe:receipt');
  } catch (error) {
    closedCallRejected = error instanceof DevframeConnectionError && error.kind === 'connection';
  }
  verify(closedCallRejected, 'Closed A connection unexpectedly remained callable');
  const survivingReceipt = await clientB.call('probe:increment', 5);
  verifyReceipt(survivingReceipt, 'endpointB', 15);
  await observeState(clientB, 'endpointB', 15);
  observations.closeIsolation = {
    closedCallRejected,
    statusA: clientA.status,
    statusB: clientB.status,
    survivingReceipt,
  };
  await closeClient(clientB);
  observations.finalClientStatuses = [clientA.status, clientB.status];
}
try {
  const credentials = await readCredentials();
  await proveBaseReuse(credentials.endpointA);
  const { clientA, clientB } = await explicitClients(credentials);
  await proveExplicitIsolation(clientA, clientB, credentials.endpointA !== credentials.endpointB);
  const authentication = await proveAuthBroadcast(clientA, clientB, credentials.endpointB);
  observations.authentication = authentication.observations;
  await proveCloseIsolation(clientA, authentication.restoredClient);
  const result = {
    passed: true,
    userAgent: navigator.userAgent,
    observations,
    sharedStateValues,
    expectedBackgroundErrors,
  };
  show(result);
  await report(result);
} catch (error) {
  const result = {
    passed: false,
    errorName: error instanceof Error ? error.name : 'Non-Error failure',
    error: error instanceof Error ? error.message : 'Unexpected non-Error failure',
    observations,
    sharedStateValues,
  };
  show(result);
  await report(result);
} finally {
  for (const unsubscribe of unsubscribeFunctions) unsubscribe();
  for (const client of clients) client.close?.();
}
