import assert from 'node:assert/strict';
import { defineRealm, isOperationError } from '@devkit/core';
import type { NativeContextAccess, NativeContextDescriptor, RuntimeDiagnostic } from '@devkit/core';
import { createProviderLifecycle } from '@devkit/runtime';
import { publishedTargetSchema } from '@dvcol/cdb';
import type { CdbDevframeService } from '@dvcol/cdb-devframe';
import { readPageTitleAction } from '../../src/contracts.ts';
import {
  remoteDebuggerAgent,
  remoteDebuggerContext,
  remoteDebuggerExecution,
  remotePageTitlePlugin,
  remotePageTitleService,
} from '../../src/remote-service.ts';

type NativeBroker = CdbDevframeService['broker'];

export async function checkRemoteContribution(broker: NativeBroker) {
  const target = await readTarget(broker);
  const input = { id: target.id, generation: target.generation };
  const diagnostics: RuntimeDiagnostic[] = [];
  const provider = createProviderLifecycle({
    provider: {
      id: 'example.remote-debugger',
      incarnation: crypto.randomUUID(),
      realm: defineRealm({ id: 'devserver' }),
    },
    execution: remoteDebuggerExecution,
    native: nativeBrokerAccess(broker),
    report: (diagnostic) => {
      diagnostics.push(diagnostic);
    },
  });
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => provider.dispose());
  await provider.startup({ services: [remotePageTitleService], plugins: [remotePageTitlePlugin] });
  const title = await provider.invoke({ action: readPageTitleAction, input });
  assert.equal(title, 'Owned remote debugger target');
  assert.equal(broker.snapshot().leases.length, 0);
  await assert.rejects(
    provider.invoke({
      action: readPageTitleAction,
      input: { ...input, generation: input.generation + 1 },
    }),
    hasStaleGenerationCause,
  );
  assert.equal(broker.snapshot().leases.length, 0);
  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.every((diagnostic) => diagnostic.code === 'operation-failed'));
  await provider.dispose();
  const remainingTargets = await broker.invoke(
    remoteDebuggerAgent,
    'browser.list_target_authorities',
    {},
  );
  assert.deepEqual(remainingTargets, [target]);
  assert.equal(broker.snapshot().scopes.length, 1);
  return {
    title,
    generationMismatch: 'rejected',
    leases: 0,
    targetRetainedAfterContributionDisposal: true,
  };
}

function hasStaleGenerationCause(error: unknown): boolean {
  assert.ok(isOperationError(error));
  assert.equal(error.code, 'operation-failed');
  const cause = error.cause;
  assert.ok(typeof cause === 'object' && cause !== null && 'code' in cause);
  assert.equal(cause.code, 'TARGET_GENERATION_STALE');
  return true;
}

async function readTarget(broker: NativeBroker) {
  const targets = await broker.invoke(remoteDebuggerAgent, 'browser.list_target_authorities', {});
  assert.ok(Array.isArray(targets));
  assert.equal(targets.length, 1);
  const target = await publishedTargetSchema['~standard'].validate(targets[0]);
  assert.equal(target.issues, undefined);
  if (target.issues !== undefined) throw new Error('Native target did not pass its public schema');
  return target.value;
}

function nativeBrokerAccess(broker: NativeBroker): NativeContextAccess {
  function get<Value>(descriptor: NativeContextDescriptor<Value>): Value | undefined;
  function get(descriptor: NativeContextDescriptor<unknown>): unknown {
    return descriptor.id === remoteDebuggerContext.id ? broker : undefined;
  }
  return { get };
}
