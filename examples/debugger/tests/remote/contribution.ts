import assert from 'node:assert/strict';
import { isOperationError } from '@devkit/core';
import type { Page } from '@playwright/test';
import { readPageTitleAction } from '../../src/contracts.ts';
import { agent } from './authentication.ts';
import { poll } from './driver.ts';
import { connectCaller, approveCaller, readTarget, rejectedByNative } from './caller-driver.ts';
import type { CallerFixture, NativeHost } from './caller-driver.ts';
import { checkCancellation } from './pending.ts';
import { checkPendingAuthority } from './pending-authority.ts';
import { checkWorkerRestart } from './restart.ts';

export async function checkRemoteContribution(host: NativeHost, control: Page, targetPage: Page) {
  const workerRestart = await checkWorkerRestart(control, host);
  await using cleanup = new AsyncDisposableStack();
  const page = await control.context().newPage();
  cleanup.defer(() => page.close());
  await page.goto(new URL('caller.html', control.url()).href);
  await connectCaller(page, host.baseURL);
  cleanup.defer(() => page.evaluate(() => window.caller.close()));
  assert.equal(host.sessions.size, 2);
  const hostTarget = await readTarget(
    await host.service.broker.invoke(agent, 'browser.list_target_authorities', {}),
  );
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
      generation: target.generation - 1,
    }),
    'TARGET_GENERATION_STALE',
  );
  const lifetime = await checkContributionLifetime({ host, page, targetPage, target }, control);
  return {
    title,
    workerRestart,
    nativeCallerCount: 2,
    missingCaller: 'rejected',
    otherPrincipalGrant: 'rejected',
    callerApproval: approval,
    generationMismatch: 'rejected',
    leases: 0,
    ...lifetime,
    targetRetainedAfterContributionDisposal: true,
  };
}

async function checkContributionLifetime(fixture: CallerFixture, control: Page) {
  const { host, page, target } = fixture;
  const authorityChanges = await checkPendingAuthority(fixture, control);
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
  return { cancellation, authorityChanges };
}

function isMissingCaller(error: unknown): boolean {
  assert.ok(isOperationError(error));
  assert.equal(error.code, 'operation-failed');
  assert.ok(error.cause instanceof Error);
  assert.equal(error.cause.message, 'A current Devframe RPC caller is required');
  return true;
}
