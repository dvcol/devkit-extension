import { getDevToolsRpcClient } from '@vitejs/devtools-kit/client';
import { connectDevframe, DevframeConnectionError } from 'devframe/client';
import type { DevframeRpcClient } from 'devframe/client';
import type { ConnectionMeta } from 'devframe/types';
import type { CounterReceipt } from './contracts.js';

interface Bootstrap {
  credentials: { endpointA: string; endpointB: string };
}

const clients: DevframeRpcClient[] = [];
const unsubscribeFunctions: (() => void)[] = [];
const observations: Record<string, unknown> = {};
const sharedStateValues: Record<string, number[]> = { endpointA: [], endpointB: [] };
const options = { webmcp: false, simpleAuth: false, otpParam: false as const, callTimeout: 10000 };

function show(value: unknown): void {
  const output = document.querySelector('pre');
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function verify(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function report(value: unknown): Promise<void> {
  const response = await fetch('/__probe-control/result', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  verify(response.ok, 'Result delivery failed');
}

async function trusted(client: DevframeRpcClient): Promise<DevframeRpcClient> {
  clients.push(client);
  verify(await client.ensureTrusted(10000), 'Expected a trusted connection');
  return client;
}

function verifyReceipt(receipt: CounterReceipt, endpoint: string, value: number): void {
  verify(receipt.endpoint === endpoint && receipt.value === value && receipt.credentialMatched,
    `Receipt mismatch for ${endpoint} at ${value}`);
}

async function observeState(client: DevframeRpcClient, endpoint: string, expected: number): Promise<void> {
  const state = await client.sharedState.get('probe:counter');
  verify(state.value().endpoint === endpoint, 'State belongs to another endpoint');
  if (state.value().value === expected) return;
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`State ${endpoint} did not reach ${expected}`)), 10000);
    const unsubscribe = state.on('updated', (value) => {
      verify(value.endpoint === endpoint, 'Received another endpoint state');
      if (value.value === expected) { clearTimeout(deadline); unsubscribe(); resolve(); }
    });
    unsubscribeFunctions.push(() => { clearTimeout(deadline); unsubscribe(); });
  });
}

async function closeClient(client: DevframeRpcClient): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Connection did not close')), 10000);
    const unsubscribe = client.events.on('connection:status', (status) => {
      if (status !== 'disconnected') return;
      clearTimeout(deadline); unsubscribe(); resolve();
    });
    unsubscribeFunctions.push(() => { clearTimeout(deadline); unsubscribe(); });
    client.close?.();
  });
}

async function run(): Promise<void> {
  const bootstrap = await fetch('/__probe-control/bootstrap').then(response => response.json()) as Bootstrap;
  const firstClient = await trusted(await connectDevframe({ ...options, baseURL: '/__endpoint-a/', authToken: bootstrap.credentials.endpointA }));
  const firstReceipt = await firstClient.call('probe:increment', 1);
  verifyReceipt(firstReceipt, 'endpointA', 1);
  const inheritedClient = await trusted(await connectDevframe({ ...options, baseURL: '/__endpoint-b/', authToken: bootstrap.credentials.endpointA }));
  const inheritedReceipt = await inheritedClient.call('probe:increment', 2);
  verifyReceipt(inheritedReceipt, 'endpointA', 3);
  observations.baseOnly = {
    requestedSecondBase: '/__endpoint-b/',
    firstMetadataPath: new URL(firstClient.connection.metaBaseUrl).pathname,
    secondMetadataPath: new URL(inheritedClient.connection.metaBaseUrl).pathname,
    firstReceipt, inheritedReceipt,
  };
  await closeClient(firstClient);
  await closeClient(inheritedClient);

  const metadataA = await fetch('/__endpoint-a/__connection.json').then(response => response.json()) as ConnectionMeta;
  const metadataB = await fetch('/__endpoint-b/__connection.json').then(response => response.json()) as ConnectionMeta;
  const clientA = await trusted(await connectDevframe({ ...options, connection: {
    connectionMeta: metadataA,
    metaBaseUrl: new URL('/__endpoint-a/__connection.json', location.href).href,
    authToken: bootstrap.credentials.endpointA,
  } }));
  const clientB = await trusted(await getDevToolsRpcClient({ ...options, baseURL: '/__endpoint-b/', connectionMeta: metadataB, authToken: bootstrap.credentials.endpointB }));
  for (const [endpoint, client] of [['endpointA', clientA], ['endpointB', clientB]] as const) {
    const state = await client.sharedState.get('probe:counter');
    sharedStateValues[endpoint]?.push(state.value().value);
    unsubscribeFunctions.push(state.on('updated', value => { sharedStateValues[endpoint]?.push(value.value); }));
  }
  const receiptA = await clientA.call('probe:increment', 4);
  const receiptB = await clientB.call('probe:increment', 10);
  verifyReceipt(receiptA, 'endpointA', 7);
  verifyReceipt(receiptB, 'endpointB', 10);
  await observeState(clientA, 'endpointA', 7);
  await observeState(clientB, 'endpointB', 10);
  const afterCredentialB = await clientA.call('probe:receipt');
  verifyReceipt(afterCredentialB, 'endpointA', 7);
  observations.explicit = {
    distinctCredentials: bootstrap.credentials.endpointA !== bootstrap.credentials.endpointB,
    metadataA: new URL(clientA.connection.metaBaseUrl).pathname,
    metadataB: new URL(clientB.connection.metaBaseUrl).pathname,
    receiptA, receiptB, afterCredentialB,
  };
  await closeClient(clientA);
  let closedCallRejected = false;
  try { await clientA.call('probe:receipt'); }
  catch (error) { closedCallRejected = error instanceof DevframeConnectionError && error.kind === 'connection'; }
  verify(closedCallRejected, 'Closed A connection unexpectedly remained callable');
  const survivingReceipt = await clientB.call('probe:increment', 5);
  verifyReceipt(survivingReceipt, 'endpointB', 15);
  await observeState(clientB, 'endpointB', 15);
  observations.closeIsolation = { closedCallRejected, statusA: clientA.status, statusB: clientB.status, survivingReceipt };
  await closeClient(clientB);
  observations.finalClientStatuses = [clientA.status, clientB.status];
}

try {
  await run();
  const result = { passed: true, userAgent: navigator.userAgent, observations, sharedStateValues };
  show(result);
  await report(result);
} catch (error) {
  const result = { passed: false, error: error instanceof Error ? error.message : 'Non-Error failure', observations, sharedStateValues };
  show(result);
  await report(result);
} finally {
  for (const unsubscribe of unsubscribeFunctions) unsubscribe();
  for (const client of clients) client.close?.();
}
