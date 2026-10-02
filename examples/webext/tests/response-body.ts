import assert from 'node:assert/strict';
import { checkNativeResponseEncodings } from './response-encoding.ts';
import type { ResponseServer } from './response-server.ts';
export { startResponseServer } from './response-server.ts';

export const responseBodyChecks = [
  'native Firefox filters prefix the owned response bytes and leave unmatched bytes unchanged',
  'native decoding preserves gzip and deflate body bytes for fixed-length and chunked responses while original encoded headers remain visible',
  'disable removes future response admissions and enable registers a fresh activation',
  'native HTTP redirection reports the StreamFilter error while unmatched redirected bytes and later responses remain correct',
  'native output arrives before the input stream finishes, preserving split UTF-8 bytes',
  'disposal removes future admissions while an admitted native stream completes normally',
];

declare global {
  interface Window {
    responseFixture?: {
      readonly reader: ReadableStreamDefaultReader<Uint8Array>;
      readonly decoder: TextDecoder;
      controller?: AbortController;
      text: string;
    };
  }
}

export async function readNativeResponse(path: string) {
  const response = await fetch(new URL(path, location.href), { cache: 'no-store' });
  return { status: response.status, text: await response.text() };
}

/** Observe downstream bytes while the fixture deliberately holds the remaining input open. */
export async function startNativeResponse(path: string, expected: string, abortable = false) {
  const controller = abortable ? new AbortController() : undefined;
  const request: RequestInit = { cache: 'no-store' };
  if (controller !== undefined) request.signal = controller.signal;
  const response = await fetch(new URL(path, location.href), request);
  if (response.body === null) throw new Error('Missing native response stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (text !== expected) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('Native response ended before the held input was released');
    text += decoder.decode(chunk.value, { stream: true });
    if (!expected.startsWith(text)) throw new Error(`Unexpected native response prefix: ${text}`);
  }
  window.responseFixture = { reader, decoder, text };
  if (controller !== undefined) window.responseFixture.controller = controller;
  return { status: response.status, text };
}

export async function finishNativeResponse() {
  const pending = window.responseFixture;
  if (pending === undefined) throw new Error('Start the native response fixture first');
  try {
    for (;;) {
      const chunk = await pending.reader.read();
      if (chunk.done) break;
      pending.text += pending.decoder.decode(chunk.value, { stream: true });
    }
    pending.text += pending.decoder.decode();
    return { text: pending.text, error: null };
  } catch (error) {
    return { text: pending.text, error: error instanceof Error ? error.message : String(error) };
  } finally {
    pending.reader.releaseLock();
    delete window.responseFixture;
  }
}

interface ResponseBrowser {
  control(operation: 'install' | 'disable' | 'enable' | 'dispose' | 'snapshot'): Promise<unknown>;
  read(path: string): Promise<unknown>;
  readEncoded(path: string): Promise<unknown>;
  start(path: string, expected: string): Promise<unknown>;
  finish(): Promise<unknown>;
  waitForError(): Promise<unknown>;
}

function installation(snapshot: unknown, status: string, generation: number) {
  assert.partialDeepStrictEqual(snapshot, {
    filteringMethodPresent: true,
    installation: {
      id: 'example.response-body',
      contributions: [{ kind: 'transform', status, generation }],
    },
  });
}

export async function checkFirefoxResponseBody(browser: ResponseBrowser, fixture: ResponseServer) {
  const original = await browser.read('/transform-response/plain');
  assert.deepEqual(original, { status: 200, text: 'original-世界' });
  const installed = await browser.control('install');
  installation(installed, 'active', 1);
  const transformed = await browser.read('/transform-response/plain');
  assert.deepEqual(transformed, { status: 200, text: 'native:original-世界' });
  const unmatched = await browser.read('/unmatched-response');
  assert.deepEqual(unmatched, original);
  const disabled = await browser.control('disable');
  installation(disabled, 'disabled', 1);
  assert.deepEqual(await browser.read('/transform-response/plain'), original);
  const enabled = await browser.control('enable');
  installation(enabled, 'active', 2);
  assert.deepEqual(await browser.read('/transform-response/plain'), transformed);
  const failure = await checkRedirectedResponse(browser, original);
  assert.deepEqual(await browser.read('/transform-response/plain'), transformed);
  const encodings = await checkNativeResponseEncodings(browser);
  const firstBytes = await browser.start('/transform-response/stream', 'native:first-caf');
  assert.deepEqual(firstBytes, { status: 200, text: 'native:first-caf' });
  const disposed = await browser.control('dispose');
  installation(disposed, 'disposed', 2);
  assert.partialDeepStrictEqual(disposed, { admitted: 10, completed: 8 });
  assert.deepEqual(await browser.read('/transform-response/plain'), original);
  fixture.releaseStream();
  const completed = await browser.finish();
  assert.deepEqual(completed, { text: 'native:first-café-second-世界', error: null });
  const final = await browser.control('snapshot');
  installation(final, 'disposed', 2);
  assert.partialDeepStrictEqual(final, { errors: ['Channel redirected'] });
  assert.partialDeepStrictEqual(final, { admitted: 10, completed: 9 });
  return {
    checks: responseBodyChecks,
    original,
    transformed,
    unmatched,
    installed,
    disabled,
    enabled,
    ...failure,
    encodings,
    firstBytes,
    disposed,
    completed,
    final,
  };
}

/** A redirect replaces the native channel; network failures do not emit StreamFilter.onerror. */
async function checkRedirectedResponse(browser: ResponseBrowser, original: unknown) {
  const redirected = await browser.read('/transform-response/redirect');
  assert.deepEqual(redirected, original);
  const nativeError = await browser.waitForError();
  installation(nativeError, 'active', 2);
  assert.partialDeepStrictEqual(nativeError, {
    admitted: 3,
    completed: 2,
    errors: ['Channel redirected'],
  });
  return { redirected, nativeError };
}
