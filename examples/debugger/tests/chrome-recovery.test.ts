import { afterEach, expect, it, vi } from 'vitest';
import { attachmentConflict } from './recovery-fixture/definition.js';
import { createRecoveryFixture } from './recovery-fixture/index.js';

const fixtures: ReturnType<typeof createRecoveryFixture>[] = [];

function fixture(options?: Parameters<typeof createRecoveryFixture>[0]) {
  const value = createRecoveryFixture(options);
  fixtures.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((value) => value.provider.dispose()));
  vi.unstubAllGlobals();
});

async function ready(value: ReturnType<typeof createRecoveryFixture>) {
  await vi.waitFor(() => {
    if (value.provider.state !== 'ready') throw new Error('Provider is not ready.');
  });
}

it('preserves normal attachment without probing or detaching', async () => {
  expect.assertions(3);
  const value = fixture();
  await value.outcome;
  await ready(value);
  expect(value.calls).toEqual(['attach', 'Target.setAutoAttach']);
  expect(value.publications[0]).toMatchObject({ id: 'target', generation: 4 });
  expect(value.error()).toBeUndefined();
});

it('does not reset a conflicting tab absent from persisted target identities', async () => {
  expect.assertions(3);
  const value = fixture({ restored: false, attachError: attachmentConflict });
  expect((await value.outcome).error).toBe(attachmentConflict);
  expect(value.calls).toEqual(['attach']);
  expect(value.publications).toEqual([]);
});

it.each([
  new Error('Host access is restricted by policy.'),
  new Error('Requested protocol version is not supported: 1.3.'),
  new Error('Another debugger is already attached to the tab with id: 43.'),
  'Another debugger is already attached to the tab with id: 42.',
])('propagates unrelated attachment failure %s', async (error) => {
  expect.assertions(3);
  const value = fixture({ attachError: error });
  expect((await value.outcome).error).toBe(error);
  expect(value.calls).toEqual(['attach']);
  expect(value.publications).toEqual([]);
});

it('does not detach when the extension ownership probe fails', async () => {
  expect.assertions(3);
  const error = new Error('Debugger is not attached to the tab with id: 42.');
  const value = fixture({ attachError: attachmentConflict, probeError: error });
  expect((await value.outcome).error).toBe(error);
  expect(value.calls).toEqual(['attach', 'Runtime.getIsolateId']);
  expect(value.publications).toEqual([]);
});

it('resets a verified surviving attachment before publishing a fresh generation', async () => {
  expect.assertions(4);
  const value = fixture({ attachError: attachmentConflict });
  const result = await value.outcome;
  expect(result.error).toBeUndefined();
  await ready(value);
  expect(value.calls).toEqual([
    'attach',
    'Runtime.getIsolateId',
    'detach',
    'attach',
    'Target.setAutoAttach',
  ]);
  expect(value.publications).toHaveLength(1);
  expect(value.publications[0]).toMatchObject({ id: 'target', generation: 4 });
});

it('propagates owned reset failure without reattachment or publication', async () => {
  expect.assertions(3);
  const error = new Error('Detach failed.');
  const value = fixture({ attachError: attachmentConflict, detachError: error });
  expect((await value.outcome).error).toBe(error);
  expect(value.calls).toEqual(['attach', 'Runtime.getIsolateId', 'detach']);
  expect(value.publications).toEqual([]);
});

it('propagates fresh attachment failure without publication', async () => {
  expect.assertions(3);
  const error = new Error('Fresh attachment failed.');
  const value = fixture({ attachError: attachmentConflict, reattachError: error });
  expect((await value.outcome).error).toBe(error);
  expect(value.calls).toEqual(['attach', 'Runtime.getIsolateId', 'detach', 'attach']);
  expect(value.publications).toEqual([]);
});
