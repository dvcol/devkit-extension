import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { connectCaller, approveCaller, readTarget } from './caller-driver.ts';
import type { CallerFixture, NativeHost } from './caller-driver.ts';
import { poll } from './driver.ts';
import { holdPendingTitle } from './pending.ts';

type Disruption = 'disconnect' | 'revoke-grant';

export async function checkPendingAuthority(fixture: CallerFixture, control: Page) {
  const disconnect = await checkAuthorityChange(fixture, control, 'disconnect');
  const revocation = await checkAuthorityChange(fixture, control, 'revoke-grant');
  return { disconnect, revocation };
}

async function checkAuthorityChange(fixture: CallerFixture, control: Page, disruption: Disruption) {
  const { host } = fixture;
  await using cleanup = new AsyncDisposableStack();
  const { previous, page, grant } = await createApprovedCaller(fixture, control, cleanup);
  const result = await interruptPendingTitle(
    { ...fixture, page },
    {
      disruption,
      grantId: grant.id,
      principalId: grant.principalId,
    },
  );
  const grants = host.service.broker.snapshot().grants;
  assert.deepEqual(
    grants.filter((entry) => entry.id !== grant.id),
    previous.grants,
  );
  assert.equal(
    grants.some((entry) => entry.id === grant.id),
    disruption === 'disconnect',
  );
  assert.deepEqual(
    await readTarget(await fixture.page.evaluate(() => window.caller.targets())),
    fixture.target,
  );
  assert.equal(
    await fixture.page.evaluate((target) => window.caller.readTitle(target), fixture.target),
    'Owned remote debugger target',
  );
  await cleanup.disposeAsync();
  await poll(
    () => host.sessions.size,
    (size) => size === 2,
    'scenario caller disconnect',
  );
  await host.settled();
  assert.deepEqual(host.service.broker.snapshot().grants, previous.grants);
  assert.deepEqual(host.service.broker.snapshot().scopes, previous.scopes);
  return {
    ...result,
    otherCallersRetained: true,
    grantRetainedBeforeCleanup: disruption === 'disconnect',
  };
}

async function interruptPendingTitle(
  fixture: CallerFixture,
  authority: {
    readonly disruption: Disruption;
    readonly grantId: string;
    readonly principalId: string;
  },
) {
  const { host, page, targetPage, target } = fixture;
  await using cleanup = new AsyncDisposableStack();
  await holdPendingTitle(fixture, cleanup);
  const previous = host.diagnostics.length;
  const invocation = page
    .evaluate((input) => window.caller.readTitle(input), target)
    .then(
      () => 'fulfilled',
      () => 'rejected',
    );
  await poll(host.titleReads.pending, (count) => count === 1, 'actual pending Chrome title read');
  const leases = host.service.broker.snapshot().leases;
  assert.equal(leases.length, 1);
  const lease = leases[0];
  assert.ok(lease);
  assert.equal(lease.principalId, authority.principalId);
  assert.equal(lease.targetId, target.id);
  assert.equal(lease.targetGeneration, target.generation);
  await disruptCaller(fixture, authority);
  await poll(
    () => host.service.broker.snapshot().leases.length,
    (count) => count === 0,
    'native lease cleanup',
  );
  const code = authority.disruption === 'disconnect' ? 'ACCESS_DENIED' : 'CAPABILITY_DENIED';
  await checkReleaseFailure(host, previous, code);
  assert.equal(await invocation, 'rejected');
  assert.equal(host.titleReads.pending(), 1);
  host.titleReads.release();
  assert.equal(await targetPage.locator('html').getAttribute('data-title-read-finished'), 'true');
  return {
    nativeCommandWasPending: true,
    nativeReleaseError: code,
    leases: 0,
    chromeCompletedAfterRejection: true,
  };
}

async function disruptCaller(
  { host, page }: CallerFixture,
  { disruption, grantId }: { readonly disruption: Disruption; readonly grantId: string },
) {
  if (disruption === 'revoke-grant') {
    assert.equal(await host.service.broker.revokeGrant(grantId), true);
    assert.deepEqual(await page.evaluate(() => window.caller.targets()), []);
    assert.deepEqual(await page.evaluate(() => window.caller.echo()), {
      value: 'ordinary-after-contribution',
      trusted: true,
    });
    return;
  }
  await page.evaluate(() => window.caller.disconnect());
  await poll(
    () => host.sessions.size,
    (size) => size === 2,
    'native caller disconnect',
  );
  await host.settled();
}

async function createApprovedCaller(
  fixture: CallerFixture,
  control: Page,
  cleanup: AsyncDisposableStack,
) {
  const { host } = fixture;
  const previous = host.service.broker.snapshot();
  const page = await control.context().newPage();
  cleanup.defer(() => page.close());
  await page.goto(new URL('caller.html', control.url()).href);
  await connectCaller(page, host.baseURL);
  cleanup.defer(() => page.evaluate(() => window.caller.close()));
  await approveCaller(host, control, page);
  const added = host.service.broker
    .snapshot()
    .grants.filter((grant) => !previous.grants.some((original) => original.id === grant.id));
  assert.equal(added.length, 1);
  const grant = added[0];
  assert.ok(grant);
  cleanup.defer(() => host.service.broker.revokeScope(grant.requestId));
  assert.deepEqual(
    await readTarget(await page.evaluate(() => window.caller.targets())),
    fixture.target,
  );
  return { previous, page, grant };
}

async function checkReleaseFailure(host: NativeHost, previous: number, code: string) {
  const diagnostics = await poll(
    () => host.diagnostics.slice(previous),
    (entries) =>
      entries.some(
        ({ cause }) =>
          typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === code,
      ),
    'native release authorization failure',
  );
  assert.ok(diagnostics.every(({ diagnostic }) => diagnostic.code === 'operation-failed'));
}
