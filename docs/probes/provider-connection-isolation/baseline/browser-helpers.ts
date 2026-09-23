import type { DevframeRpcClient } from 'devframe/client';
import type { CounterReceipt, CounterState } from './contracts.js';
export const clients: DevframeRpcClient[] = [];
export const unsubscribeFunctions: (() => void)[] = [];
export const options = {
  webmcp: false,
  simpleAuth: false,
  otpParam: false as const,
  callTimeout: 10000,
};
export function verify(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
export function verifyReceipt(receipt: CounterReceipt, endpoint: string, value: number): void {
  verify(
    receipt.endpoint === endpoint &&
      receipt.value === value &&
      receipt.credentialKind !== 'unknown',
    `Receipt mismatch for ${endpoint} at ${value}`,
  );
}
export async function trusted(client: DevframeRpcClient): Promise<DevframeRpcClient> {
  clients.push(client);
  verify(await client.ensureTrusted(10000), 'Expected a trusted connection');
  return client;
}
export async function waitFor(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Observation deadline: ${label}`);
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}
export async function observeState(
  client: DevframeRpcClient,
  endpoint: string,
  expected: number,
): Promise<void> {
  const state = await client.sharedState.get<CounterState>('probe:counter');
  await waitFor(() => state.value().value === expected, `state ${endpoint} at ${expected}`);
  verify(state.value().endpoint === endpoint, 'State belongs to another endpoint');
}
export async function closeClient(client: DevframeRpcClient): Promise<void> {
  client.close?.();
  await waitFor(() => client.status === 'disconnected', 'connection closes');
}
