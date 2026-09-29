import assert from 'node:assert/strict';
import { isOperationError } from '@devkit/core';
import type { Page } from '@playwright/test';
import { publishedTargetSchema } from '@dvcol/cdb';
import { getTempAuthCode } from 'devframe/node/auth';
import { readPageTitleAction } from '../../src/contracts.ts';
import type { DebuggerTarget } from '../../src/contracts.ts';
import type { createNativeHost } from './host.ts';
import { agent } from './authentication.ts';
import { poll, send } from './driver.ts';
import { approveResponseSchema } from './protocol.ts';

type NativeHost = Awaited<ReturnType<typeof createNativeHost>>;

export async function checkRemoteContribution(host: NativeHost, control: Page, targetPage: Page) {
  await using cleanup = new AsyncDisposableStack();
  const page = await control.context().newPage();
  cleanup.defer(() => page.close());
  await page.goto(new URL('caller.html', control.url()).href);
  await connectCaller(page, host.baseURL);
  cleanup.defer(() => page.evaluate(() => window.caller.close()));
  assert.equal(host.sessions.size, 2);
  const hostTargets = await host.service.broker.invoke(
    agent,
    'browser.list_target_authorities',
    {},
  );
  const hostTarget = await readTarget(hostTargets);
  await assert.rejects(
    host.provider.invoke({ action: readPageTitleAction, input: hostTarget }),
    isMissingCaller,
  );
  await rejectedByNative(
    host,
    page.evaluate((input) => window.caller.readTitle(input), hostTarget),
    'CAPABILITY_DENIED',
  );
  const approval = await approveCaller(host, control, page);
  const target = await readTarget(await page.evaluate(() => window.caller.targets()));
  assert.deepEqual(target, hostTarget);
  const title = await page.evaluate((input) => window.caller.readTitle(input), target);
  assert.equal(title, 'Owned remote debugger target');
  assert.equal(host.service.broker.snapshot().leases.length, 0);
  await rejectedByNative(
    host,
    page.evaluate((input) => window.caller.readTitle(input), {
      ...target,
      generation: target.generation + 1,
    }),
    'TARGET_GENERATION_STALE',
  );
  const cancellation = await checkContributionLifetime({ host, page, targetPage, target });
  return {
    title,
    nativeCallerCount: 2,
    missingCaller: 'rejected',
    otherPrincipalGrant: 'rejected',
    callerApproval: approval,
    generationMismatch: 'rejected',
    leases: 0,
    cancellation,
    targetRetainedAfterContributionDisposal: true,
  };
}

async function connectCaller(page: Page, baseURL: string) {
  await page.waitForFunction(() => typeof window.connectCaller === 'function');
  await page.evaluate(
    async (request) => {
      window.caller = await window.connectCaller(request.baseURL, request.code);
      if (window.caller.trusted !== true)
        throw new Error('The separate native caller is not trusted');
    },
    { baseURL, code: getTempAuthCode() },
  );
}

async function approveCaller(host: NativeHost, control: Page, page: Page) {
  const access = page
    .evaluate(() => window.caller.requestAccess())
    .then(
      () => ({ accepted: true }),
      () => ({ accepted: false }),
    );
  const snapshot = await poll(
    () => host.service.broker.snapshot(),
    (state) => state.requests.some((request) => request.state === 'pending'),
    'the separate caller approval request',
  );
  const request = snapshot.requests.find((entry) => entry.state === 'pending');
  assert.ok(request);
  const response = await send(
    control,
    { kind: 'approve', requestId: request.id },
    approveResponseSchema,
  );
  assert.deepEqual(await access, { accepted: true });
  assert.equal(response.approvals.length, 2);
  assert.deepEqual(response.errors, []);
  const grants = host.service.broker.snapshot().grants;
  const principalCount = new Set(grants.map((grant) => grant.principalId)).size;
  const targetCount = new Set(grants.map((grant) => grant.targetId)).size;
  assert.equal(grants.length, 2);
  assert.equal(principalCount, 2);
  assert.equal(targetCount, 1);
  return { count: response.approvals.length, principalCount, targetCount };
}

interface CallerFixture {
  readonly host: NativeHost;
  readonly page: Page;
  readonly targetPage: Page;
  readonly target: DebuggerTarget;
}

async function checkContributionLifetime(fixture: CallerFixture) {
  const { host, page, target } = fixture;
  const cancellation = await checkCancellation(fixture);
  const grants = host.service.broker.snapshot().grants;
  const installation = host.provider.startup.services[0];
  assert.ok(installation);
  const disabled = await installation.disable();
  assert.equal(disabled.status, 'inactive');
  await assert.rejects(page.evaluate((input) => window.caller.readTitle(input), target));
  await installation.enable();
  await poll(
    () => page.evaluate((input) => window.caller.readTitle(input), target).catch(() => null),
    (value) => value === 'Owned remote debugger target',
    'contribution reactivation in the remote catalog',
  );
  await host.provider.dispose();
  assert.deepEqual(await readTarget(await page.evaluate(() => window.caller.targets())), target);
  assert.deepEqual(host.service.broker.snapshot().grants, grants);
  assert.equal(host.service.broker.snapshot().leases.length, 0);
  assert.deepEqual(await page.evaluate(() => window.caller.echo()), {
    value: 'ordinary-after-contribution',
    trusted: true,
  });
  return cancellation;
}

async function readTarget(value: unknown) {
  assert.ok(Array.isArray(value));
  assert.equal(value.length, 1);
  const target = await publishedTargetSchema['~standard'].validate(value[0]);
  if (target.issues !== undefined) throw new Error('Native target did not pass its public schema');
  return { id: target.value.id, generation: target.value.generation };
}

async function rejectedByNative(host: NativeHost, invocation: Promise<unknown>, code: string) {
  const previous = host.diagnostics.length;
  await assert.rejects(invocation);
  assert.equal(host.service.broker.snapshot().leases.length, 0);
  const diagnostics = host.diagnostics.slice(previous);
  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.every(({ diagnostic }) => diagnostic.code === 'operation-failed'));
  assert.ok(
    diagnostics.some(
      ({ cause }) =>
        typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === code,
    ),
  );
}

function isMissingCaller(error: unknown): boolean {
  assert.ok(isOperationError(error));
  assert.equal(error.code, 'operation-failed');
  assert.ok(error.cause instanceof Error);
  assert.equal(error.cause.message, 'A current Devframe RPC caller is required');
  return true;
}

/** Hold an actual synchronous page read on the fixture server; no native command is mocked. */
async function holdTitleRead(targetPage: Page): Promise<void> {
  await targetPage.evaluate(() => {
    const title = document.title;
    Object.defineProperty(document, 'title', {
      configurable: true,
      get() {
        const request = new XMLHttpRequest();
        request.open('GET', '/hold-title', false);
        request.send();
        document.documentElement.dataset.titleReadFinished = 'true';
        return title;
      },
    });
  });
}

async function checkCancellation(fixture: CallerFixture) {
  const { host, targetPage } = fixture;
  await using cleanup = new AsyncDisposableStack();
  await holdTitleRead(targetPage);
  cleanup.defer(async () => {
    await targetPage.evaluate(() => {
      Reflect.deleteProperty(document, 'title');
    });
  });
  cleanup.defer(() => {
    host.titleReads.release();
  });
  return await cancelPendingTitle(fixture);
}

async function cancelPendingTitle({ host, page, targetPage, target }: CallerFixture) {
  const installation = host.provider.startup.services[0];
  assert.ok(installation);
  const status = { invocationSettled: false, disableSettled: false };
  const invocation = page
    .evaluate((input) => window.caller.readTitle(input), target)
    .then(
      () => {
        status.invocationSettled = true;
        return 'fulfilled';
      },
      () => {
        status.invocationSettled = true;
        return 'rejected';
      },
    );
  await poll(host.titleReads.pending, (count) => count === 1, 'actual pending Chrome title read');
  assert.equal(host.service.broker.snapshot().leases.length, 1);
  const previous = host.diagnostics.length;
  const stopped = installation.disable().then((snapshot) => {
    status.disableSettled = true;
    return snapshot;
  });
  await poll(
    () => installation.snapshot(),
    (snapshot) => snapshot.contributions.some((entry) => entry.status === 'stopping'),
    'contribution stopping while Chrome is pending',
  );
  assert.deepEqual(status, { invocationSettled: false, disableSettled: false });
  assert.equal(host.service.broker.snapshot().leases.length, 1);
  host.titleReads.release();
  assert.equal(await invocation, 'rejected');
  assert.equal((await stopped).status, 'inactive');
  assert.equal(host.service.broker.snapshot().leases.length, 0);
  const diagnostics = host.diagnostics.slice(previous);
  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.every(({ diagnostic }) => diagnostic.code === 'cancelled'));
  assert.equal(await targetPage.locator('html').getAttribute('data-title-read-finished'), 'true');
  await installation.enable();
  return { nativeCommandWasPending: true, disableWaited: true, lateResult: 'cancelled', leases: 0 };
}
