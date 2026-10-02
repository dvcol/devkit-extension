import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';

export const responseBodyChecks = [
  'native Firefox filters prefix the owned response bytes and leave unmatched bytes unchanged',
  'disable removes future response admissions and enable registers a fresh activation',
  'native HTTP redirection reports the StreamFilter error while unmatched redirected bytes and later responses remain correct',
  'native output arrives before the input stream finishes, preserving split UTF-8 bytes',
  'disposal removes future admissions while an admitted native stream completes normally',
];

export async function startResponseServer() {
  let streaming: ServerResponse | undefined;
  const server = createServer((request, response) => {
    const path = request.url ?? '/';
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(
        '<!doctype html><title>Native response fixture</title><h1>Native response fixture</h1>',
      );
      return;
    }
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (path === '/transform-response/stream') {
      streaming = response;
      response.write(Buffer.concat([Buffer.from('first-caf'), Buffer.from([0xc3])]));
      return;
    }
    if (path === '/transform-response/redirect') {
      response.writeHead(302, { Location: '/unmatched-response' });
      response.end();
      return;
    }
    /** Keep the fixture's ordinary body chunked so the prefix has no Content-Length assumption. */
    response.write('original-世界');
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing native response fixture port');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    releaseStream() {
      assert.ok(streaming !== undefined);
      streaming.end(Buffer.concat([Buffer.from([0xa9]), Buffer.from('-second-世界')]));
    },
    close: () => closeResponseServer(server),
  };
}

function closeResponseServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server.closeAllConnections();
  });
}

declare global {
  interface Window {
    responseFixture?: {
      readonly reader: ReadableStreamDefaultReader<Uint8Array>;
      readonly decoder: TextDecoder;
      text: string;
    };
  }
}

export async function readNativeResponse(path: string) {
  const response = await fetch(new URL(path, location.href), { cache: 'no-store' });
  return { status: response.status, text: await response.text() };
}

/** Observe downstream bytes while the fixture deliberately holds the remaining input open. */
export async function startNativeResponse(path: string, expected: string) {
  const response = await fetch(new URL(path, location.href), { cache: 'no-store' });
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

export async function checkFirefoxResponseBody(
  browser: ResponseBrowser,
  fixture: Awaited<ReturnType<typeof startResponseServer>>,
) {
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
  const firstBytes = await browser.start('/transform-response/stream', 'native:first-caf');
  assert.deepEqual(firstBytes, { status: 200, text: 'native:first-caf' });
  const disposed = await browser.control('dispose');
  installation(disposed, 'disposed', 2);
  assert.partialDeepStrictEqual(disposed, { admitted: 5, completed: 3 });
  assert.deepEqual(await browser.read('/transform-response/plain'), original);
  fixture.releaseStream();
  const completed = await browser.finish();
  assert.deepEqual(completed, { text: 'native:first-café-second-世界', error: null });
  const final = await browser.control('snapshot');
  installation(final, 'disposed', 2);
  assert.partialDeepStrictEqual(final, { admitted: 5, completed: 4 });
  return {
    checks: responseBodyChecks,
    original,
    transformed,
    unmatched,
    installed,
    disabled,
    enabled,
    ...failure,
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
