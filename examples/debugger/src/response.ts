import type { CdpSubscription, ChromeDebuggerBridgeClient, ReleaseLeaseRequest } from '@dvcol/cdb';
import type { ChromeDebuggerPort } from '@dvcol/cdb-extension';
import { z } from 'zod';
import { nativeDebugger } from './chrome.js';

/** Fixed host policy. CDB remains the only caller of Fetch.enable and Fetch.disable. */
export function responseDebugger(urlPattern: string): ChromeDebuggerPort {
  const configuration = { patterns: [{ urlPattern, requestStage: 'Response' }] };
  return {
    ...nativeDebugger,
    sendCommand(target, method, parameters) {
      const configured = method === 'Fetch.enable' ? configuration : parameters;
      return nativeDebugger.sendCommand(target, method, configured);
    },
  };
}

const pausedResponse = z.object({
  requestId: z.string(),
  request: z.object({ url: z.url() }),
  responseStatusCode: z.literal(200),
});
const responseBody = z.object({ body: z.string(), base64Encoded: z.boolean() });

/** One bounded text fixture, not a general response pipeline or transform declaration API. */
export async function transformNextResponse({
  client,
  subscription,
  reference,
}: {
  readonly client: ChromeDebuggerBridgeClient;
  readonly subscription: CdpSubscription;
  readonly reference: ReleaseLeaseRequest;
}) {
  const event = await subscription[Symbol.asyncIterator]().next();
  if (event.done === true) throw new Error('Fetch subscription ended before the response');
  const paused = pausedResponse.parse(event.value.parameters);
  const session = event.value.sessionId === undefined ? {} : { sessionId: event.value.sessionId };
  const result = await client.executeCommand({
    ...reference,
    ...session,
    operationId: crypto.randomUUID(),
    method: 'Fetch.getResponseBody',
    parameters: { requestId: paused.requestId },
  });
  const body = responseBody.parse(result.value);
  const original = body.base64Encoded ? atob(body.body) : body.body;
  await client.executeCommand({
    ...reference,
    ...session,
    operationId: crypto.randomUUID(),
    method: 'Fetch.fulfillRequest',
    parameters: {
      requestId: paused.requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'Content-Type', value: 'text/plain; charset=utf-8' },
        { name: 'X-Probe', value: 'fulfilled' },
      ],
      body: btoa(`${original}:transformed`),
    },
  });
  return { original, url: paused.request.url, status: paused.responseStatusCode };
}
