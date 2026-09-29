import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import type { CallerFixture } from './caller-driver.ts';
import { poll } from './driver.ts';

/** Hold an actual synchronous page read on the fixture server; no native command is mocked. */
async function holdTitleRead(targetPage: Page): Promise<void> {
  await targetPage.evaluate(() => {
    const title = document.title;
    Reflect.deleteProperty(document.documentElement.dataset, 'titleReadFinished');
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

export async function holdPendingTitle(fixture: CallerFixture, cleanup: AsyncDisposableStack) {
  const { host, targetPage } = fixture;
  await holdTitleRead(targetPage);
  cleanup.defer(async () => {
    await targetPage.evaluate(() => {
      Reflect.deleteProperty(document, 'title');
    });
  });
  cleanup.defer(() => {
    host.titleReads.release();
  });
}

export async function checkCancellation(fixture: CallerFixture) {
  await using cleanup = new AsyncDisposableStack();
  await holdPendingTitle(fixture, cleanup);
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
