import assert from 'node:assert/strict';
import { leaseSchema } from '@dvcol/cdb';
import type { JsonObject, ReleaseLeaseRequest } from '@dvcol/cdb';
import { z } from 'zod';
import { agent, approveTarget, checkTrust } from './authentication.ts';
import { createNativeBrowser } from './browser.ts';
import { poll, send } from './driver.ts';
import type { createNativeHost } from './host.ts';
import {
  attachmentOwnershipResponseSchema,
  closePeerResponseSchema,
  disposeClientResponseSchema,
  stopProviderResponseSchema,
} from './protocol.ts';

type NativeHost = Awaited<ReturnType<typeof createNativeHost>>;
type NativeBrowser = Awaited<ReturnType<typeof createNativeBrowser>>;
const childSchema = z.object({
  id: z.uuid(),
  generation: z.number().int().positive(),
  type: z.literal('iframe'),
});
const sessionsSchema = z.object({ value: z.object({ sessions: z.array(childSchema) }) });
const evaluationSchema = z.object({
  value: z.object({
    result: z.object({ value: z.object({ title: z.string(), origin: z.string() }) }),
  }),
});
const eventSchema = z.object({
  method: z.literal('Runtime.consoleAPICalled'),
  parameters: z.object({ args: z.array(z.object({ value: z.string() })) }),
});

interface CommandFixture {
  host: NativeHost;
  reference: ReleaseLeaseRequest;
}

interface SessionFixture extends CommandFixture {
  browser: NativeBrowser;
  targetRef: string;
}

declare global {
  interface Window {
    childSessionObservation: { sessions: string[]; stop(): void };
  }
}

export async function checkChildSessions(host: NativeHost) {
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(host.close);
  const browser = await createNativeBrowser(host);
  cleanup.defer(browser.close);
  await checkTrust(browser.control, host);
  cleanup.defer(async () => {
    await send(browser.control, { kind: 'stop-provider' }, stopProviderResponseSchema);
    await send(browser.control, { kind: 'dispose-client' }, disposeClientResponseSchema);
    await send(browser.control, { kind: 'close-peer' }, closePeerResponseSchema);
  });
  const { targetRef } = await approveTarget(browser.control, host);
  await using leases = new AsyncDisposableStack();
  const reference = await acquireLease(host);
  leases.defer(async () => {
    await host.service.broker.invoke(agent, 'browser.release', reference);
  });
  const result = await exerciseChildSession({ host, browser, targetRef, reference });
  await leases.disposeAsync();
  assert.equal(host.service.broker.snapshot().leases.length, 0);
  const stopped = await send(
    browser.control,
    { kind: 'stop-provider' },
    stopProviderResponseSchema,
  );
  assert.deepEqual(stopped.errors, []);
  const ownership = await send(
    browser.control,
    { kind: 'attachment-ownership' },
    attachmentOwnershipResponseSchema,
  );
  assert.deepEqual(ownership, { ownsAttachment: false, error: 'native-not-attached' });
  assert.equal(host.service.broker.snapshot().leases.length, 0);
  return {
    browserVersion: browser.version,
    ...result,
    ownership,
    leasesAfterDisposal: 0,
    hostErrors: host.errors,
    pageErrors: browser.errors,
  };
}

async function exerciseChildSession({ host, browser, targetRef, reference }: SessionFixture) {
  const fixture = { host, reference };
  assert.deepEqual(await listChildren(fixture), []);
  const childUrl = await createChildFrame({ host, browser });
  const children = await poll(
    () => listChildren(fixture),
    (sessions) => sessions.length === 1,
    'one native CDB child session',
  );
  const child = childSchema.parse(children[0]);
  const event = await checkChildEvent({ ...fixture, browser, targetRef, sessionId: child.id });
  const result = await evaluateChild(fixture, child.id);
  assert.deepEqual(result, { title: 'Owned child debugger frame', origin: childUrl.origin });
  const root = await readRoot(fixture);
  assert.deepEqual(root, {
    title: 'Owned remote debugger target',
    origin: new URL(host.fixtureUrl).origin,
  });
  await browser.target.locator('#owned-child').evaluate((frame) => {
    frame.remove();
  });
  await poll(
    () => listChildren(fixture),
    (sessions) => sessions.length === 0,
    'native child removal',
  );
  await assert.rejects(
    command(fixture, {
      method: 'Runtime.evaluate',
      sessionId: child.id,
      parameters: { expression: 'document.title', returnByValue: true },
    }),
    { code: 'CDP_COMMAND_FAILED', message: 'The requested child session is not available.' },
  );
  assert.deepEqual(await readRoot(fixture), root);
  return {
    child: { type: child.type, generation: child.generation, ...result },
    root,
    event,
    childRemoved: true,
    staleChild: 'CDP_COMMAND_FAILED',
    rootPreserved: true,
  };
}

async function createChildFrame({ host, browser }: { host: NativeHost; browser: NativeBrowser }) {
  const childUrl = new URL(host.fixtureUrl);
  childUrl.hostname = 'localhost';
  await browser.target.evaluate((url) => {
    const frame = document.createElement('iframe');
    frame.id = 'owned-child';
    frame.src = url;
    document.body.append(frame);
  }, childUrl.href);
  return childUrl;
}

async function evaluateChild(fixture: CommandFixture, sessionId: string) {
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

async function acquireLease(host: NativeHost): Promise<ReleaseLeaseRequest> {
  const targets = z
    .array(z.object({ id: z.uuid(), generation: z.number().int().positive() }))
    .parse(await host.service.broker.invoke(agent, 'browser.list_target_authorities', {}));
  assert.equal(targets.length, 1);
  const target = targets[0];
  assert.ok(target);
  const authority = { targetId: target.id, targetGeneration: target.generation };
  const lease = await leaseSchema['~standard'].validate(
    await host.service.broker.invoke(agent, 'browser.acquire', {
      ...authority,
      durationMilliseconds: 10_000,
      mode: 'exclusive-control',
      requestedMethods: [
        'Bridge.listChildSessions',
        'Runtime.evaluate',
        'Runtime.consoleAPICalled',
      ],
    }),
  );
  if (lease.issues !== undefined) throw new Error('Expected the native child-session lease');
  assert.equal(host.service.broker.snapshot().leases.length, 1);
  return { ...authority, leaseId: lease.value.id };
}

function command(
  { host, reference }: CommandFixture,
  request: { method: string; sessionId?: string; parameters?: JsonObject },
) {
  return host.service.broker.invoke(agent, 'browser.raw_cdp', {
    ...reference,
    parameters: {},
    ...request,
  });
}

async function listChildren(fixture: CommandFixture) {
  return sessionsSchema.parse(await command(fixture, { method: 'Bridge.listChildSessions' })).value
    .sessions;
}

async function readRoot(fixture: CommandFixture) {
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

async function checkChildEvent({
  browser,
  targetRef,
  sessionId,
  ...fixture
}: CommandFixture & { browser: NativeBrowser; targetRef: string; sessionId: string }) {
  await using cleanup = new AsyncDisposableStack();
  await observeChildContexts(browser);
  cleanup.defer(() =>
    browser.control.evaluate(() => {
      window.childSessionObservation.stop();
    }),
  );
  const waiting = fixture.host.service.broker
    .invoke(agent, 'browser.console', {
      targetRef,
      sessionId,
      leaseId: fixture.reference.leaseId,
      timeoutMilliseconds: 5_000,
    })
    .then(
      (value) => ({ ok: true, value }) as const,
      (error: unknown) => ({ ok: false, error }) as const,
    );
  cleanup.defer(async () => {
    await waiting;
  });
  const nativeSessions = await poll(
    () => browser.control.evaluate(() => window.childSessionObservation.sessions),
    (sessions) => sessions.length === 1,
    'native child Runtime activation',
  );
  assert.notEqual(nativeSessions[0], sessionId);
  await logConsole(fixture, { value: 'root-only-event' });
  await logConsole(fixture, { sessionId, value: 'owned-child-event' });
  const outcome = await waiting;
  if (!outcome.ok) throw outcome.error;
  const event = eventSchema.parse(outcome.value);
  assert.deepEqual(
    event.parameters.args.map((argument) => argument.value),
    ['owned-child-event'],
  );
  return {
    method: event.method,
    value: 'owned-child-event',
    rootEventFiltered: true,
    publicSessionDiffersFromChrome: true,
  };
}

async function logConsole(
  fixture: CommandFixture,
  { value, sessionId }: { value: string; sessionId?: string },
) {
  await command(fixture, {
    method: 'Runtime.evaluate',
    parameters: { expression: `console.log(${JSON.stringify(value)})` },
    ...(sessionId === undefined ? {} : { sessionId }),
  });
}

async function observeChildContexts({ control }: NativeBrowser) {
  await control.evaluate(() => {
    const observation = { sessions: [] as string[], stop };
    const listener: Parameters<typeof chrome.debugger.onEvent.addListener>[0] = (
      source,
      method,
    ) => {
      if (method !== 'Runtime.executionContextCreated' || source.sessionId === undefined) return;
      if (!observation.sessions.includes(source.sessionId))
        observation.sessions.push(source.sessionId);
    };
    function stop() {
      chrome.debugger.onEvent.removeListener(listener);
    }
    chrome.debugger.onEvent.addListener(listener);
    window.childSessionObservation = observation;
  });
}
