import assert from 'node:assert/strict';
import { readArray, readObject, readString, waitFor } from './chromium-idle-cdp.ts';
import type { BrowserConnection } from './chromium-idle-cdp.ts';
import { createPage } from './chromium-idle-panel.ts';

export interface NativeTarget {
  targetId: string;
  type: string;
  url: string;
  attached: boolean;
}
interface NativeVersion {
  versionId: string;
  scriptURL: string;
  runningStatus: string;
  targetId: string | undefined;
}

export async function targets(control: BrowserConnection): Promise<NativeTarget[]> {
  return readArray(readObject(await control.command('Target.getTargets')).targetInfos).map(
    (target) => readTarget(target),
  );
}

function readTarget(value: unknown): NativeTarget {
  const target = readObject(value);
  assert.ok(typeof target.attached === 'boolean');
  return {
    targetId: readString(target.targetId),
    type: readString(target.type),
    url: readString(target.url),
    attached: target.attached,
  };
}

function readVersion(value: unknown): NativeVersion {
  const version = readObject(value);
  return {
    versionId: readString(version.versionId),
    scriptURL: readString(version.scriptURL),
    runningStatus: readString(version.runningStatus),
    targetId: typeof version.targetId === 'string' ? version.targetId : undefined,
  };
}

export async function observeWorker(control: BrowserConnection) {
  const attachedWorkers: string[] = [];
  const destroyedTargets: Array<{ targetId: string; observedAt: number }> = [];
  const versions: Array<NativeVersion & { observedAt: number }> = [];
  const failures: unknown[] = [];
  const pageErrors: string[] = [];
  control.on('Runtime.exceptionThrown', (value) => {
    pageErrors.push(JSON.stringify(value));
  });
  control.on('Target.targetInfoChanged', (value) => {
    const targetInfo = readTarget(readObject(value).targetInfo);
    if (targetInfo.type === 'service_worker' && targetInfo.attached)
      attachedWorkers.push(targetInfo.targetId);
  });
  control.on('Target.targetDestroyed', (value) => {
    destroyedTargets.push({
      targetId: readString(readObject(value).targetId),
      observedAt: Date.now(),
    });
  });
  control.on('ServiceWorker.workerVersionUpdated', (value) => {
    for (const version of readArray(readObject(value).versions))
      versions.push({ ...readVersion(version), observedAt: Date.now() });
  });
  control.on('ServiceWorker.workerErrorReported', (value) => {
    failures.push(value);
  });
  await control.command('Target.setDiscoverTargets', { discover: true });
  const observer = await createPage(control, 'about:blank');
  await control.command('ServiceWorker.enable', {}, observer.sessionId);
  return { attachedWorkers, destroyedTargets, versions, failures, pageErrors };
}

export async function runningWorker(
  control: BrowserConnection,
  scriptURL?: string,
): Promise<NativeTarget> {
  let worker: NativeTarget | undefined;
  await waitFor(async () => {
    const candidates = (await targets(control)).filter(
      (target) =>
        target.type === 'service_worker' &&
        target.url.endsWith('/background.js') &&
        (scriptURL === undefined || target.url === scriptURL),
    );
    assert.ok(
      candidates.length <= 1,
      `Ambiguous native fixture workers: ${JSON.stringify(candidates)}`,
    );
    worker = candidates[0];
    return worker !== undefined;
  }, 'the extension worker target');
  assert.ok(worker !== undefined && !worker.attached);
  return worker;
}

/** Only native browser events are inspected while both production Port clients remain quiet. */
export async function waitForNativeIdle(
  control: BrowserConnection,
  observation: Awaited<ReturnType<typeof observeWorker>>,
  worker: NativeTarget,
) {
  const idleStartedAt = Date.now();
  await waitFor(
    () => observation.destroyedTargets.some((target) => target.targetId === worker.targetId),
    'natural destruction of the unattached extension worker target',
    120_000,
  );
  await waitFor(
    () =>
      observation.versions.some(
        (version) =>
          version.scriptURL === worker.url &&
          version.runningStatus === 'stopped' &&
          version.observedAt >= idleStartedAt,
      ),
    'the native service-worker stopped status',
  );
  assert.equal(
    (await targets(control)).some((target) => target.targetId === worker.targetId),
    false,
  );
  assert.deepEqual(observation.attachedWorkers, []);
  const idleStoppedAt = observation.destroyedTargets.find(
    (target) => target.targetId === worker.targetId,
  )!.observedAt;
  return { idleStartedAt, idleStoppedAt, elapsedMilliseconds: idleStoppedAt - idleStartedAt };
}
