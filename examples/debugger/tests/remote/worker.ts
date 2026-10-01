import { createCdbClient } from '@dvcol/cdb-devframe/client';
import type { CdbClient } from '@dvcol/cdb-devframe/client';
import { createIndexedDbPairingStore } from '@dvcol/cdb-extension';
import type { TabScopeSelector } from '@dvcol/cdb-extension';
import { createChromeProvider, getChromeProviderIdentity } from '@dvcol/cdb-extension/chrome';
import type { ChromeProvider } from '@dvcol/cdb-extension/chrome';
import { connectDevframe } from 'devframe/client';
import type { DevframeRpcClient } from 'devframe/client';
import { z } from 'zod';

import { remoteRequestSchema } from './protocol.js';
import type {
  ApprovalReceipt,
  AttachmentOwnershipReceipt,
  PrepareReceipt,
  RemoteRequest,
  RemoteState,
} from './protocol.js';

const controlURL = chrome.runtime.getURL('control.html');
const approvals: ApprovalReceipt[] = [];
const errors: string[] = [];
let nativePeer: DevframeRpcClient | undefined;
let browserClient: CdbClient | undefined;
let chromeProvider: ChromeProvider<chrome.runtime.MessageSender> | undefined;
let stopStatus: (() => void) | undefined;
let targetTabId: number | undefined;
let fixtureURL: string | undefined;
let providerDisposed = false;
let clientDisposed = false;
let closed = false;
let initialized = false;
let requestRunning = false;
let pairingConfirmations = 0;

function trustedSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.url === controlURL;
}

function readState(): RemoteState {
  return {
    status: nativePeer?.status ?? null,
    isTrusted: nativePeer?.isTrusted ?? null,
    isolated: nativePeer?.connection.isolated ?? null,
    targetTabId: targetTabId ?? null,
    pairingConfirmations,
    providerDisposed,
    clientDisposed,
    closed,
    approvals: [...approvals],
    errors: [...errors],
  };
}

async function verifyUnauthenticated(
  client: CdbClient,
): Promise<Pick<PrepareReceipt, 'unauthenticatedRejected' | 'unauthenticatedReason'>> {
  try {
    await client.snapshot();
    return { unauthenticatedRejected: false, unauthenticatedReason: null };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'DevframeConnectionError' &&
      error.message === '[devframe] Not authorized by the devframe server'
    ) {
      return { unauthenticatedRejected: true, unauthenticatedReason: 'native-unauthorized' };
    }
    return { unauthenticatedRejected: true, unauthenticatedReason: 'unexpected-native-error' };
  }
}

async function findOwnedTarget(url: string): Promise<number> {
  const matches = (await chrome.tabs.query({})).filter((tab) => tab.url === url);
  const target = matches[0];
  if (matches.length !== 1 || target?.id === undefined) {
    throw new Error('The fixture requires exactly one owned target tab.');
  }
  return target.id;
}

async function authorizeApproval(
  request: { readonly id: string },
  selector: TabScopeSelector,
  sender: chrome.runtime.MessageSender,
): Promise<boolean> {
  if (targetTabId === undefined || selector.kind !== 'explicit-tabs') return false;
  const selected = await chrome.tabs.get(targetTabId);
  const accepted =
    trustedSender(sender) &&
    selected.url === fixtureURL &&
    selector.tabIds.length === 1 &&
    selector.tabIds[0] === targetTabId;
  approvals.push({
    requestId: request.id,
    selector: { kind: 'explicit-tabs', tabIds: [...selector.tabIds] },
    accepted,
    senderURL: sender.url ?? null,
  });
  return accepted;
}

async function startProvider(client: CdbClient, baseURL: string) {
  const instanceId = await getChromeProviderIdentity('owned-native-provider-installation');
  chromeProvider = createChromeProvider<chrome.runtime.MessageSender>({
    connect: () =>
      client.connectProvider({
        registration: {
          id: 'owned-native-provider',
          instanceId,
          maximumLevel: 'debug',
          name: 'Owned native provider',
          version: '0.0.1',
        },
        pairingKey: baseURL,
        pairingStore: createIndexedDbPairingStore(),
        confirmPairing: () => {
          pairingConfirmations += 1;
          return true;
        },
      }),
    maximumLevel: 'debug',
    isExposureAllowed: (tab) => tab.url === fixtureURL,
    authorizeApproval,
    onError(error) {
      errors.push(error instanceof Error ? error.message : String(error));
    },
    recoveryStorageKey: 'owned-native-provider-recovery',
  });
  chromeProvider.start();
}

async function echo(value: string): Promise<string> {
  if (nativePeer === undefined || closed) throw new Error('The owning native peer is unavailable.');
  const returned: unknown = await nativePeer.scope('fixture').rpc.call('echo', value);
  return z.object({ value: z.string(), trusted: z.literal(true) }).parse(returned).value;
}

async function prepare(
  request: Extract<RemoteRequest, { readonly kind: 'prepare' }>,
): Promise<PrepareReceipt> {
  if (initialized) throw new Error('The fixture can only be prepared once.');
  initialized = true;
  fixtureURL = request.fixtureUrl;
  targetTabId = await findOwnedTarget(fixtureURL);
  const peer = await connectDevframe({
    baseURL: request.baseURL,
    connection: { isolated: true },
    simpleAuth: false,
    otpParam: false,
    webmcp: false,
    callTimeout: 5_000,
  });
  nativePeer = peer;
  const client = createCdbClient(peer);
  browserClient = client;
  stopStatus = peer.events.on('connection:status', (status) => {
    if (status === 'disconnected' && !clientDisposed) client.disconnected();
  });
  const unauthenticated = await verifyUnauthenticated(client);
  const trustedBeforeCode = peer.isTrusted;
  const invalidCodeAccepted = await peer.requestTrustWithCode('not-the-fixture-auth-code');
  const validCodeAccepted = await peer.requestTrustWithCode(request.code);
  await peer.ensureTrusted(5_000);
  const echoed = await echo('authenticated-before-provider');
  await startProvider(client, request.baseURL);
  return {
    ...unauthenticated,
    trustedBeforeCode,
    invalidCodeAccepted,
    validCodeAccepted,
    currentTrusted: peer.isTrusted,
    echo: echoed,
    state: readState(),
  };
}

async function attachmentOwnership(): Promise<AttachmentOwnershipReceipt> {
  if (targetTabId === undefined) throw new Error('No owned target has been selected.');
  try {
    const result: unknown = await chrome.debugger.sendCommand(
      { tabId: targetTabId },
      'Runtime.evaluate',
      { expression: '1', returnByValue: true },
    );
    z.object({ result: z.object({ value: z.literal(1) }) }).parse(result);
    return { ownsAttachment: true, error: null };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === `Debugger is not attached to the tab with id: ${targetTabId}.`
    ) {
      return { ownsAttachment: false, error: 'native-not-attached' };
    }
    return { ownsAttachment: false, error: 'unexpected-native-error' };
  }
}

async function approve(
  requestId: string,
  sender: chrome.runtime.MessageSender,
): Promise<RemoteState> {
  if (chromeProvider === undefined || targetTabId === undefined || providerDisposed) {
    throw new Error('The native provider is unavailable.');
  }
  await chromeProvider.approve(requestId, { kind: 'explicit-tabs', tabIds: [targetTabId] }, sender);
  return readState();
}

async function stopProvider(): Promise<RemoteState> {
  await chromeProvider?.dispose();
  providerDisposed = true;
  return readState();
}

async function disposeClient() {
  if (!providerDisposed) throw new Error('Dispose the native provider before its CDB client.');
  await browserClient?.dispose();
  clientDisposed = true;
  return { state: readState(), echo: await echo('ordinary-after-cdb-client-disposal') };
}

function closePeer(): RemoteState {
  if (!clientDisposed) throw new Error('Dispose the CDB client before closing its owning peer.');
  if (nativePeer?.close === undefined) throw new Error('The owning native peer cannot be closed.');
  stopStatus?.();
  nativePeer.close();
  closed = true;
  return readState();
}

function handle(request: RemoteRequest, sender: chrome.runtime.MessageSender) {
  switch (request.kind) {
    case 'prepare':
      return prepare(request);
    case 'state':
      return readState();
    case 'approve':
      return approve(request.requestId, sender);
    case 'echo':
      return echo(request.value);
    case 'attachment-ownership':
      return attachmentOwnership();
    case 'stop-provider':
      return stopProvider();
    case 'dispose-client':
      return disposeClient();
    case 'close-peer':
      return closePeer();
    default:
      throw new Error('Unsupported fixture request.');
  }
}

/** Only the packaged acceptance controller may drive this fixture's native resources. */
function receive(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response: unknown) => void,
): boolean {
  if (!trustedSender(sender)) return false;
  const request = remoteRequestSchema.safeParse(message);
  if (!request.success || requestRunning) {
    respond({ ok: false, error: { message: 'Invalid or concurrent fixture control request.' } });
    return false;
  }
  requestRunning = true;
  void Promise.resolve()
    .then<Awaited<ReturnType<typeof handle>>>(() => handle(request.data, sender))
    .then(
      (value) => {
        requestRunning = false;
        respond({ ok: true, value });
        return true;
      },
      () => {
        requestRunning = false;
        respond({ ok: false, error: { message: `Fixture ${request.data.kind} request failed.` } });
        return false;
      },
    );
  return true;
}

// oxlint-disable-next-line typescript/strict-void-return -- Chrome requires true to retain the asynchronous response channel; @types/chrome declares void.
chrome.runtime.onMessage.addListener(receive);
