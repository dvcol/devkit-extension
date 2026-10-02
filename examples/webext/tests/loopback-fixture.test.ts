import { once } from 'node:events';
import { Socket } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { startHeaderServer } from './header-rules';
import { startRedirectServer } from './redirect-rules';

async function withinDeadline<Value>(operation: Promise<Value>): Promise<Value> {
  const cancellation = new AbortController();
  const deadline = setTimeout(1000, undefined, { signal: cancellation.signal }).then(() => {
    throw new Error('Owned loopback fixture teardown did not settle');
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    cancellation.abort();
  }
}

function whenPeerCloses(socket: Socket): Promise<boolean> {
  return new Promise((resolve, reject) => {
    socket.once('error', (error: NodeJS.ErrnoException) => {
      /** Destroying the server's unused connection can reset its native TCP peer. */
      if (error.code !== 'ECONNRESET') reject(error);
    });
    socket.once('close', () => {
      resolve(socket.destroyed);
    });
  });
}

async function finishTeardown(
  socket: Socket,
  close: () => Promise<void>,
  closing: Promise<void> | undefined,
) {
  socket.destroy();
  await withinDeadline(closing ?? close());
}

it.each([
  { name: 'header', start: startHeaderServer },
  { name: 'redirect', start: startRedirectServer },
])('closes the $name fixture and its unused TCP peer during teardown', async ({ start }) => {
  expect.assertions(2);
  const fixture = await start();
  const socket = new Socket();
  let closing: Promise<void> | undefined;
  try {
    const connected = once(socket, 'connect');
    socket.connect({ host: '127.0.0.1', port: Number(new URL(fixture.url).port) });
    await withinDeadline(connected);
    /** A completed native request lets the server accept the earlier unused peer. */
    const response = await fetch(fixture.url, { signal: AbortSignal.timeout(1000) });
    await response.text();
    expect({
      bytesRead: socket.bytesRead,
      bytesWritten: socket.bytesWritten,
      destroyed: socket.destroyed,
    }).toEqual({ bytesRead: 0, bytesWritten: 0, destroyed: false });
    const peerClosed = whenPeerCloses(socket);
    closing = fixture.close();
    await expect(withinDeadline(Promise.all([closing, peerClosed]))).resolves.toEqual([
      undefined,
      true,
    ]);
  } finally {
    await finishTeardown(socket, fixture.close, closing);
  }
});
