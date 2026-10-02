import assert from 'node:assert/strict';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** This test attaches only to pages; attaching to a worker inhibits its native idle shutdown. */
export async function connectBrowser(endpoint: string) {
  const socket = new WebSocket(endpoint);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener(
      'open',
      () => {
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        reject(new Error('Browser CDP connection failed'));
      },
      { once: true },
    );
  });
  const events = new EventTarget();
  const pending = new Map<number, PendingRequest>();
  let nextRequestId = 0;
  socket.addEventListener('message', (event) => {
    receiveMessage(String(event.data), pending, events);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values())
      request.reject(new Error('Browser CDP connection closed'));
    pending.clear();
  });
  function command(method: string, params: object = {}, sessionId?: string): Promise<unknown> {
    return sendCommand(socket, pending, nextRequestId++, method, params, sessionId);
  }
  function close(): void {
    socket.close();
  }
  return { command, on: subscribe.bind(null, events), close };
}

function subscribe(events: EventTarget, method: string, listener: (value: unknown) => void): void {
  events.addEventListener(method, (event) => {
    assert.ok(event instanceof CustomEvent);
    listener(event.detail);
  });
}

export type BrowserConnection = Awaited<ReturnType<typeof connectBrowser>>;

async function sendCommand(
  socket: WebSocket,
  pending: Map<number, PendingRequest>,
  id: number,
  method: string,
  params: object,
  sessionId: string | undefined,
): Promise<unknown> {
  const result = new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  const timeout = setTimeout(() => {
    pending.get(id)?.reject(new Error(`CDP command timed out: ${method}`));
    pending.delete(id);
  }, 10_000);
  socket.send(JSON.stringify({ id, method, params, sessionId }));
  try {
    return await result;
  } finally {
    clearTimeout(timeout);
  }
}

function receiveMessage(
  text: string,
  pending: Map<number, PendingRequest>,
  events: EventTarget,
): void {
  const value: unknown = JSON.parse(text);
  const message = readObject(value);
  if (message.id === undefined) {
    if (typeof message.method === 'string')
      events.dispatchEvent(new CustomEvent(message.method, { detail: message.params }));
    return;
  }
  assert.equal(typeof message.id, 'number');
  const request = pending.get(Number(message.id));
  if (request === undefined) return;
  pending.delete(Number(message.id));
  if (message.error === undefined) {
    request.resolve(message.result);
    return;
  }
  request.reject(new Error(readString(readObject(message.error).message)));
}

export async function evaluate(
  control: BrowserConnection,
  sessionId: string,
  expression: string,
): Promise<unknown> {
  const response = readObject(
    await control.command(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    ),
  );
  assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
  return readObject(response.result).value;
}

export function readObject(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return { ...value };
}

export function readString(value: unknown): string {
  assert.ok(typeof value === 'string');
  return value;
}

export function readNumber(value: unknown): number {
  assert.ok(typeof value === 'number');
  return value;
}

export function readArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

/** Polls the browser controller or page DOM, never an extension API during the idle interval. */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  description: string,
  timeoutMilliseconds = 30_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMilliseconds;
  while (performance.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  throw new Error(`Timed out waiting for ${description}`);
}
