import { connectDevframe } from 'devframe/client';
import type { DevframeConnection, DevframeRpcClient } from 'devframe/client';
import {
  clients,
  closeClient,
  trusted,
  verify,
  verifyReceipt,
  waitFor,
} from './browser-helpers.js';
import { readCode, readHandlerCount } from './validation.js';
import {
  connectionOptions,
  expectedCounterA,
  expectedCounterB,
  isolatedEndpointB,
} from './browser-modes.js';
async function proveRejectedReconnection(connection: DevframeConnection) {
  if (isolatedEndpointB) return proveTrustedReconnection(connection);
  const before = await readHandlerCount();
  const inheritedClient = await connectDevframe({
    ...connectionOptions('endpointB'),
    connection: connection,
  });
  clients.push(inheritedClient);
  await waitFor(() => inheritedClient.status === 'unauthorized', 'fresh B rejects A credential');
  let protectedCallRejected = false;
  try {
    await inheritedClient.call('probe:increment', 100);
  } catch {
    protectedCallRejected = true;
  }
  verify(protectedCallRejected, 'Fresh unauthorized B accepted protected action');
  const after = await readHandlerCount();
  verify(before === after, 'Rejected protected action reached B handler');
  await closeClient(inheritedClient);
  return { protectedCallRejected, before, after, freshConnectionUnauthorized: true };
}

async function proveTrustedReconnection(connection: DevframeConnection) {
  const before = await readHandlerCount();
  const inheritedClient = await trusted(
    await connectDevframe({ ...connectionOptions('endpointB'), connection }),
  );
  verifyReceipt(await inheritedClient.call('probe:receipt'), 'endpointB', expectedCounterB);
  const after = await readHandlerCount();
  verify(after === before + 1, 'Trusted recreated B did not execute exactly one receipt handler');
  await closeClient(inheritedClient);
  return { protectedCallRejected: false, before, after, freshConnectionUnauthorized: false };
}
async function observeAuthBroadcast(
  clientA: DevframeRpcClient,
  clientB: DevframeRpcClient,
): Promise<void> {
  if (isolatedEndpointB) {
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
    return;
  }
  await waitFor(
    () => clientB.connection.authToken === clientA.connection.authToken,
    'B receives A authorization update',
  );
}
export async function proveAuthBroadcast(
  clientA: DevframeRpcClient,
  clientB: DevframeRpcClient,
  originalCredentialB: string,
) {
  await clientA.requestAuthCode({ reissue: true });
  verify(await clientA.requestTrustWithCode(await readCode()), 'A code exchange failed');
  await observeAuthBroadcast(clientA, clientB);
  const inheritedConnection = clientB.connection;
  const contaminated = inheritedConnection.authToken !== originalCredentialB;
  verify(contaminated !== isolatedEndpointB, 'Unexpected authorization isolation outcome');
  const existingReceiptB = await clientB.call('probe:receipt');
  verifyReceipt(existingReceiptB, 'endpointB', expectedCounterB);
  const receiptA = await clientA.call('probe:receipt');
  verifyReceipt(receiptA, 'endpointA', expectedCounterA);
  await closeClient(clientB);
  const { protectedCallRejected, before, after, freshConnectionUnauthorized } =
    await proveRejectedReconnection(inheritedConnection);
  const restoredClient = await trusted(
    await connectDevframe({
      ...connectionOptions('endpointB'),
      connection: inheritedConnection,
      authToken: originalCredentialB,
    }),
  );
  const restoredReceipt = await restoredClient.call('probe:receipt');
  verifyReceipt(restoredReceipt, 'endpointB', expectedCounterB);
  return {
    restoredClient,
    observations: {
      codeExchangeSucceeded: true,
      isolatedEndpointB,
      broadcastObservationMilliseconds: isolatedEndpointB ? 250 : 0,
      otherConnectionTokenChanged: contaminated,
      sharedTokenEqual: inheritedConnection.authToken === clientA.connection.authToken,
      existingReceiptB,
      receiptA,
      freshConnectionUnauthorized,
      protectedCallRejected,
      handlerCountBefore: before,
      handlerCountAfter: after,
      restoredReceipt,
    },
  };
}
