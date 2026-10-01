import assert from 'node:assert/strict';
import { leaseSchema } from '@dvcol/cdb';
import { z } from 'zod';
import { agent, approveTarget, checkTrust } from './authentication.ts';
import { createNativeBrowser } from './browser.ts';
import { approveCaller, connectCaller, readTarget } from './caller-driver.ts';
import { openNativeDevTools } from './devtools-frontend.ts';
import { poll, send } from './driver.ts';
import { createNativeHost } from './host.ts';
import {
  attachmentOwnershipResponseSchema,
  closePeerResponseSchema,
  disposeClientResponseSchema,
  stopProviderResponseSchema,
} from './protocol.ts';

type NativeBrowser = Awaited<ReturnType<typeof createNativeBrowser>>;
type NativeHost = Awaited<ReturnType<typeof createNativeHost>>;
type Order = 'devtools-first' | 'extension-first';
const eventSchema = z.object({
  method: z.literal('Runtime.consoleAPICalled'),
  parameters: z.object({ args: z.array(z.object({ value: z.string() })) }),
});

declare global {
  interface Window {
    debuggerObservation: { contexts: number; detaches: string[]; stop(): void };
  }
}

export async function checkNativeDevTools() {
  const results = [];
  for (const order of ['devtools-first', 'extension-first'] as const) {
    const result = await checkOrder(order);
    assert.deepEqual(result.pageErrors, []);
    assert.deepEqual(result.hostErrors, []);
    results.push(result);
  }
  return results;
}

async function checkOrder(order: Order) {
  await using cleanup = new AsyncDisposableStack();
  const host = await createNativeHost();
  cleanup.defer(host.close);
  const browser = await createNativeBrowser(host);
  cleanup.defer(browser.close);
  await checkTrust(browser.control, host);
  cleanup.defer(async () => {
    await send(browser.control, { kind: 'stop-provider' }, stopProviderResponseSchema);
    await send(browser.control, { kind: 'dispose-client' }, disposeClientResponseSchema);
    await send(browser.control, { kind: 'close-peer' }, closePeerResponseSchema);
  });
  await observeDebugger(browser);
  let frontend: Awaited<ReturnType<typeof openNativeDevTools>> | undefined;
  cleanup.defer(() => frontend?.close());
  if (order === 'devtools-first')
    frontend = await openNativeDevTools(browser.target, `artifacts/devtools-${order}.png`);
  const approved = await approveTarget(browser.control, host);
  const { page, target } = await connectTitleCaller(host, browser, cleanup);
  const event = await checkConsoleEvent({
    host,
    browser,
    targetRef: approved.targetRef,
    target,
    open: async () => {
      frontend ??= await openNativeDevTools(browser.target, `artifacts/devtools-${order}.png`);
    },
  });
  assert.ok(frontend);
  await checkTitle(page, target);
  await assertAttachment(browser, true);
  await frontend.close();
  assert.deepEqual(await readTarget(await page.evaluate(() => window.caller.targets())), target);
  const titleAfterOpenAndClose = await checkTitle(page, target);
  const detaches = await browser.control.evaluate(() => window.debuggerObservation.detaches);
  assert.deepEqual(detaches, []);
  await checkOwnerDisposal({ host, browser, page, target });
  return {
    order,
    browserVersion: browser.version,
    frontend: frontend.ready,
    event,
    titleAfterOpenAndClose,
    detaches,
    leasesAfterDisposal: host.service.broker.snapshot().leases.length,
    pageErrors: browser.errors,
    hostErrors: host.errors,
  };
}

async function checkTitle(
  page: NativeBrowser['target'],
  target: { id: string; generation: number },
) {
  const title = await page.evaluate((input) => window.caller.readTitle(input), target);
  assert.equal(title, 'Owned remote debugger target');
  return title;
}

async function connectTitleCaller(
  host: NativeHost,
  browser: NativeBrowser,
  cleanup: AsyncDisposableStack,
) {
  const page = await browser.control.context().newPage();
  cleanup.defer(() => page.close());
  await page.goto(new URL('caller.html', browser.control.url()).href);
  await connectCaller(page, host.baseURL);
  cleanup.defer(() => page.evaluate(() => window.caller.close()));
  await approveCaller(host, browser.control, page);
  const target = await readTarget(await page.evaluate(() => window.caller.targets()));
  return { page, target };
}

async function observeDebugger({ control }: NativeBrowser) {
  await control.evaluate(() => {
    const observation = { contexts: 0, detaches: [] as string[], stop };
    const event: Parameters<typeof chrome.debugger.onEvent.addListener>[0] = (_source, method) => {
      if (method === 'Runtime.executionContextCreated') observation.contexts += 1;
    };
    const detached: Parameters<typeof chrome.debugger.onDetach.addListener>[0] = (
      _source,
      reason,
    ) => {
      observation.detaches.push(reason);
    };
    function stop() {
      chrome.debugger.onEvent.removeListener(event);
      chrome.debugger.onDetach.removeListener(detached);
    }
    chrome.debugger.onEvent.addListener(event);
    chrome.debugger.onDetach.addListener(detached);
    window.debuggerObservation = observation;
  });
}

interface ConsoleEventCheck {
  host: NativeHost;
  browser: NativeBrowser;
  targetRef: string;
  target: { id: string; generation: number };
  open: () => Promise<void>;
}

async function checkConsoleEvent({ host, browser, targetRef, target, open }: ConsoleEventCheck) {
  await browser.control.evaluate(() => {
    window.debuggerObservation.contexts = 0;
  });
  const reference = await acquireEventLease(host, target);
  const waiting = host.service.broker
    .invoke(agent, 'browser.console', {
      targetRef,
      leaseId: reference.leaseId,
      timeoutMilliseconds: 10_000,
    })
    .then(
      (value) => ({ ok: true, value }) as const,
      (error: unknown) => ({ ok: false, error }) as const,
    );
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(async () => {
    await waiting;
  });
  cleanup.defer(async () => {
    await host.service.broker.invoke(agent, 'browser.release', reference);
  });
  await poll(
    () => browser.control.evaluate(() => window.debuggerObservation.contexts),
    (count) => count > 0,
    'native Runtime subscription activation',
  );
  assert.equal(host.service.broker.snapshot().leases.length, 1);
  await open();
  assert.equal(host.service.broker.snapshot().leases.length, 1);
  await host.service.broker.invoke(agent, 'browser.raw_cdp', {
    ...reference,
    method: 'Runtime.evaluate',
    parameters: { expression: 'console.log("devkit-native-devtools"); 42', returnByValue: true },
  });
  const result = await waiting;
  if (!result.ok) throw result.error;
  const event = eventSchema.parse(result.value);
  assert.deepEqual(
    event.parameters.args.map((argument) => argument.value),
    ['devkit-native-devtools'],
  );
  return { method: event.method, value: 'devkit-native-devtools' };
}

async function acquireEventLease(host: NativeHost, target: { id: string; generation: number }) {
  const authority = { targetId: target.id, targetGeneration: target.generation };
  const lease = await leaseSchema['~standard'].validate(
    await host.service.broker.invoke(agent, 'browser.acquire', {
      ...authority,
      durationMilliseconds: 10_000,
      mode: 'exclusive-control',
      requestedMethods: ['Runtime.evaluate', 'Runtime.consoleAPICalled'],
    }),
  );
  if (lease.issues !== undefined) throw new Error('Expected the native event lease');
  return { ...authority, leaseId: lease.value.id };
}

async function assertAttachment(browser: NativeBrowser, ownsAttachment: boolean) {
  const ownership = await send(
    browser.control,
    { kind: 'attachment-ownership' },
    attachmentOwnershipResponseSchema,
  );
  assert.deepEqual(ownership, {
    ownsAttachment,
    error: ownsAttachment ? null : 'native-not-attached',
  });
}

async function checkOwnerDisposal({
  host,
  browser,
  page,
  target,
}: {
  host: NativeHost;
  browser: NativeBrowser;
  page: NativeBrowser['target'];
  target: { id: string; generation: number };
}) {
  await send(browser.control, { kind: 'stop-provider' }, stopProviderResponseSchema);
  await assertAttachment(browser, false);
  assert.equal(host.service.broker.snapshot().leases.length, 0);
  await assert.rejects(page.evaluate((input) => window.caller.readTitle(input), target));
  assert.deepEqual(await page.evaluate(() => window.caller.echo()), {
    value: 'ordinary-after-contribution',
    trusted: true,
  });
  await browser.control.evaluate(() => {
    window.debuggerObservation.stop();
  });
}
