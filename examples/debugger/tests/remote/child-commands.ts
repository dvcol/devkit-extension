import type { JsonObject, ReleaseLeaseRequest } from '@dvcol/cdb';
import { z } from 'zod';
import { agent } from './authentication.ts';
import type { createNativeHost } from './host.ts';

export interface CommandFixture {
  host: Awaited<ReturnType<typeof createNativeHost>>;
  reference: ReleaseLeaseRequest;
}

const evaluationSchema = z.object({
  value: z.object({
    result: z.object({ value: z.object({ title: z.string(), origin: z.string() }) }),
  }),
});
export async function evaluateChild(fixture: CommandFixture, sessionId: string) {
  return evaluationSchema.parse(
    await command(fixture, {
      method: 'Runtime.evaluate',
      sessionId,
      parameters: {
        expression:
          'document.title="Owned child debugger frame";({title:document.title,origin:location.origin})',
        returnByValue: true,
      },
    }),
  ).value.result.value;
}

export function command(
  { host, reference }: CommandFixture,
  request: { method: string; sessionId?: string; parameters?: JsonObject },
) {
  return host.service.broker.invoke(agent, 'browser.raw_cdp', {
    ...reference,
    parameters: {},
    ...request,
  });
}

export async function readRoot(fixture: CommandFixture) {
  return evaluationSchema.parse(
    await command(fixture, {
      method: 'Runtime.evaluate',
      parameters: {
        expression: '({title:document.title,origin:location.origin})',
        returnByValue: true,
      },
    }),
  ).value.result.value;
}
