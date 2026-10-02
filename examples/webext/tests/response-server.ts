import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { writeEncodedResponse } from './response-encoding.ts';

function holdStream(request: IncomingMessage, response: ServerResponse) {
  const socket = request.socket;
  let requestAborted = false;
  let responseClosed = false;
  let socketClosed = false;
  request.once('aborted', () => {
    requestAborted = true;
  });
  const responseClose = new Promise<void>((resolve) => {
    response.once('close', () => {
      responseClosed = true;
      resolve();
    });
  });
  const socketClose = new Promise<void>((resolve) => {
    socket.once('close', () => {
      socketClosed = true;
      resolve();
    });
  });
  response.write(Buffer.concat([Buffer.from('first-caf'), Buffer.from([0xc3])]));
  return {
    release() {
      response.end(Buffer.concat([Buffer.from([0xa9]), Buffer.from('-second-世界')]));
    },
    snapshot: () => ({
      responseEnded: response.writableEnded,
      responseDestroyed: response.destroyed,
      socketDestroyed: socket.destroyed,
      requestAborted,
      responseClosed,
      socketClosed,
    }),
    closed: Promise.all([responseClose, socketClose]),
  };
}

export async function startResponseServer() {
  let streaming: ReturnType<typeof holdStream> | undefined;
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
    if (writeEncodedResponse(path, response)) return;
    if (path === '/transform-response/stream') {
      streaming = holdStream(request, response);
      return;
    }
    if (path === '/transform-response/redirect') {
      response.writeHead(302, { Location: '/unmatched-response' });
      response.end();
      return;
    }
    /** Keep ordinary bodies chunked so the prefix has no Content-Length assumption. */
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
  return responseFixture(server, address.port, () => streaming);
}

function responseFixture(
  server: Server,
  port: number,
  currentStream: () => ReturnType<typeof holdStream> | undefined,
) {
  return {
    url: `http://127.0.0.1:${port}/`,
    releaseStream() {
      const streaming = currentStream();
      assert.ok(streaming !== undefined);
      streaming.release();
    },
    streamSnapshot() {
      const streaming = currentStream();
      assert.ok(streaming !== undefined);
      return streaming.snapshot();
    },
    async waitForStreamClose() {
      const streaming = currentStream();
      assert.ok(streaming !== undefined);
      const cancellation = new AbortController();
      const deadline = setTimeout(10_000, undefined, { signal: cancellation.signal }).then(() => {
        throw new Error('Native response and socket did not close within 10 seconds');
      });
      try {
        await Promise.race([streaming.closed, deadline]);
      } finally {
        cancellation.abort();
      }
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      }),
  };
}

export type ResponseServer = Awaited<ReturnType<typeof startResponseServer>>;
