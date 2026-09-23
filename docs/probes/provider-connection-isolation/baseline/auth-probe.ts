import { connectDevframe } from 'devframe/client';
import type { DevframeConnection, DevframeRpcClient } from 'devframe/client';
import {
  clients,
  closeClient,
  options,
  trusted,
  verify,
  verifyReceipt,
  waitFor,
} from './browser-helpers.js';
import { readCode, readHandlerCount } from './validation.js';
async function proveRejectedReconnection(connection: DevframeConnection) {
  const before = await readHandlerCount();
  const inheritedClient = await connectDevframe({ ...options, connection: connection });
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
  return { protectedCallRejected, before, after };
}

export async function proveAuthBroadcast(
  clientA: DevframeRpcClient,
  clientB: DevframeRpcClient,
  originalCredentialB: string,
) {
  await clientA.requestAuthCode({ reissue: true });
  verify(await clientA.requestTrustWithCode(await readCode()), 'A code exchange failed');
  await waitFor(
    () => clientB.connection.authToken === clientA.connection.authToken,
    'B receives A authorization update',
  );
  const inheritedConnection = clientB.connection;
  const contaminated = inheritedConnection.authToken !== originalCredentialB;
  verify(contaminated, 'Expected source-reviewed cross-connection token broadcast');
  const existingReceiptB = await clientB.call('probe:receipt');
  verifyReceipt(existingReceiptB, 'endpointB', 10);
  const receiptA = await clientA.call('probe:receipt');
  verifyReceipt(receiptA, 'endpointA', 7);
  await closeClient(clientB);
  const { protectedCallRejected, before, after } =
    await proveRejectedReconnection(inheritedConnection);
  const restoredClient = await trusted(
    await connectDevframe({
      ...options,
      connection: inheritedConnection,
      authToken: originalCredentialB,
    }),
  );
  const restoredReceipt = await restoredClient.call('probe:receipt');
  verifyReceipt(restoredReceipt, 'endpointB', 10);
  return {
    restoredClient,
    observations: {
      codeExchangeSucceeded: true,
      otherConnectionTokenChanged: contaminated,
      sharedTokenEqual: inheritedConnection.authToken === clientA.connection.authToken,
      existingReceiptB,
      receiptA,
      freshConnectionUnauthorized: true,
      protectedCallRejected,
      handlerCountBefore: before,
      handlerCountAfter: after,
      restoredReceipt,
    },
  };
}
