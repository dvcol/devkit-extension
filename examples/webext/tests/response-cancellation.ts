import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import type { ResponseServer } from './response-server.ts';

export const responseCancellationChecks = [
  'native Firefox reader cancellation ends page consumption while the admitted input remains open during a bounded observation and finishes after listener disposal',
  'native Firefox Fetch abort rejects reads with AbortError and closes the held response and socket through StreamFilter onstop without onerror',
];

/** Run in the source page; observe native consumption cancellation separately from Fetch abort. */
export async function cancelNativeResponse(mode: 'reader' | 'fetch') {
  const pending = window.responseFixture;
  if (pending === undefined) throw new Error('Start the native response fixture first');
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- WebDriver serializes this page function without its module scope.
  function rejected(error: unknown) {
    if (typeof error === 'object' && error !== null && 'name' in error && 'message' in error)
      return { outcome: 'rejected', name: String(error.name), message: String(error.message) };
    return { outcome: 'rejected', name: null, message: String(error) };
  }
  function observeRead(operation: Promise<ReadableStreamReadResult<Uint8Array>>) {
    return operation.then(
      ({ done, value }) => ({
        outcome: 'fulfilled',
        done,
        bytes: value === undefined ? null : Array.from(value),
      }),
      rejected,
    );
  }
  const pendingRead = observeRead(pending.reader.read());
  const readerClosed = pending.reader.closed.then(() => ({ outcome: 'fulfilled' }), rejected);
  let cancellation: { outcome: string; name?: string | null; message?: string };
  try {
    if (mode === 'reader') await pending.reader.cancel('owned response consumption cancellation');
    else {
      if (pending.controller === undefined)
        throw new Error('Start an abortable native Fetch first');
      pending.controller.abort();
    }
    cancellation = { outcome: 'fulfilled' };
  } catch (error) {
    cancellation = rejected(error);
  }
  const afterRead = await observeRead(pending.reader.read());
  pending.reader.releaseLock();
  delete window.responseFixture;
  return {
    mode,
    firstText: pending.text,
    signalAborted: pending.controller?.signal.aborted ?? false,
    cancellation,
    pendingRead: await pendingRead,
    readerClosed: await readerClosed,
    afterRead,
  };
}

interface CancellationBrowser {
  control(operation: 'install' | 'dispose' | 'snapshot'): Promise<unknown>;
  read(path: string): Promise<unknown>;
  start(path: string, expected: string): Promise<unknown>;
  startAbortable(path: string, expected: string): Promise<unknown>;
  cancel(mode: 'reader' | 'fetch'): Promise<unknown>;
  waitForCompleted(completed: number): Promise<unknown>;
}

function checkSnapshot(snapshot: unknown, status: 'active' | 'disposed', completed: number) {
  assert.partialDeepStrictEqual(snapshot, {
    admitted: 1,
    completed,
    errors: [],
    installation: {
      id: 'example.response-body',
      contributions: [{ kind: 'transform', status, generation: 1 }],
    },
  });
}

function checkHeldInput(fixture: ResponseServer) {
  const observed = fixture.streamSnapshot();
  assert.deepEqual(observed, {
    responseEnded: false,
    responseDestroyed: false,
    socketDestroyed: false,
    requestAborted: false,
    responseClosed: false,
    socketClosed: false,
  });
  return observed;
}

async function checkReaderCancellation(browser: CancellationBrowser, fixture: ResponseServer) {
  const installed = await browser.control('install');
  const firstBytes = await browser.start('/transform-response/stream', 'native:first-caf');
  assert.deepEqual(firstBytes, { status: 200, text: 'native:first-caf' });
  const before = await browser.control('snapshot');
  checkSnapshot(before, 'active', 0);
  const heldBefore = checkHeldInput(fixture);
  const page = await browser.cancel('reader');
  assert.deepEqual(page, {
    mode: 'reader',
    firstText: 'native:first-caf',
    signalAborted: false,
    cancellation: { outcome: 'fulfilled' },
    pendingRead: { outcome: 'fulfilled', done: true, bytes: null },
    readerClosed: { outcome: 'fulfilled' },
    afterRead: { outcome: 'fulfilled', done: true, bytes: null },
  });
  const observationMilliseconds = 1000;
  await setTimeout(observationMilliseconds);
  const after = await browser.control('snapshot');
  checkSnapshot(after, 'active', 0);
  const heldAfter = checkHeldInput(fixture);
  const disposed = await browser.control('dispose');
  checkSnapshot(disposed, 'disposed', 0);
  assert.deepEqual(await browser.read('/transform-response/plain'), {
    status: 200,
    text: 'original-世界',
  });
  checkHeldInput(fixture);
  return {
    installed,
    firstBytes,
    before,
    heldBefore,
    page,
    observationMilliseconds,
    after,
    heldAfter,
    disposed,
    ...(await finishReaderInput(browser, fixture)),
  };
}

async function finishReaderInput(browser: CancellationBrowser, fixture: ResponseServer) {
  fixture.releaseStream();
  await fixture.waitForStreamClose();
  const terminal = await browser.waitForCompleted(1);
  checkSnapshot(terminal, 'disposed', 1);
  const released = fixture.streamSnapshot();
  assert.deepEqual(released, {
    responseEnded: true,
    responseDestroyed: true,
    socketDestroyed: true,
    requestAborted: false,
    responseClosed: true,
    socketClosed: true,
  });
  return { terminal, released };
}

async function checkFetchAbort(browser: CancellationBrowser, fixture: ResponseServer) {
  const installed = await browser.control('install');
  const firstBytes = await browser.startAbortable('/transform-response/stream', 'native:first-caf');
  assert.deepEqual(firstBytes, { status: 200, text: 'native:first-caf' });
  const before = await browser.control('snapshot');
  checkSnapshot(before, 'active', 0);
  const heldBefore = checkHeldInput(fixture);
  const page = await browser.cancel('fetch');
  assert.partialDeepStrictEqual(page, {
    mode: 'fetch',
    firstText: 'native:first-caf',
    signalAborted: true,
    cancellation: { outcome: 'fulfilled' },
    pendingRead: { outcome: 'rejected', name: 'AbortError' },
    readerClosed: { outcome: 'rejected', name: 'AbortError' },
    afterRead: { outcome: 'rejected', name: 'AbortError' },
  });
  await fixture.waitForStreamClose();
  const terminal = await browser.waitForCompleted(1);
  checkSnapshot(terminal, 'active', 1);
  const aborted = fixture.streamSnapshot();
  assert.deepEqual(aborted, {
    responseEnded: false,
    responseDestroyed: true,
    socketDestroyed: true,
    requestAborted: true,
    responseClosed: true,
    socketClosed: true,
  });
  return {
    installed,
    firstBytes,
    before,
    heldBefore,
    page,
    terminal,
    aborted,
    ...(await checkLaterAdmissions(browser)),
  };
}

async function checkLaterAdmissions(browser: CancellationBrowser) {
  const laterTransformed = await browser.read('/transform-response/plain');
  assert.deepEqual(laterTransformed, { status: 200, text: 'native:original-世界' });
  const afterLater = await browser.control('snapshot');
  assert.partialDeepStrictEqual(afterLater, { admitted: 2, completed: 2, errors: [] });
  const disposed = await browser.control('dispose');
  assert.deepEqual(await browser.read('/transform-response/plain'), {
    status: 200,
    text: 'original-世界',
  });
  const final = await browser.control('snapshot');
  assert.deepEqual(final, disposed);
  return {
    laterTransformed,
    afterLater,
    disposed,
    final,
  };
}

export async function checkNativeResponseCancellation(
  browser: CancellationBrowser,
  fixture: ResponseServer,
) {
  try {
    return {
      checks: responseCancellationChecks,
      reader: await checkReaderCancellation(browser, fixture),
      fetch: await checkFetchAbort(browser, fixture),
    };
  } finally {
    await browser.control('dispose');
  }
}
