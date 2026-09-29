import { defineRealm } from '@devkit/core';
import type { NativeContextAccess, NativeContextDescriptor, RuntimeDiagnostic } from '@devkit/core';
import { createRpcProvider } from '@devkit/devframe';
import type { RpcProviderHandle } from '@devkit/devframe';
import { createCdbService, getCdbService } from '@dvcol/cdb-devframe';
import type { CdbDevframeService } from '@dvcol/cdb-devframe';
import { defineDevframe } from 'devframe';
import type { DevframeNodeContext } from 'devframe';
import { z } from 'zod';
import { readPageTitleAction } from '../../src/contracts.ts';
import {
  remoteDebuggerContext,
  remoteDebuggerExecution,
  remotePageTitlePlugin,
  remotePageTitleService,
} from '../../src/remote-service.ts';

export function createDefinition() {
  let service: CdbDevframeService | undefined;
  let provider: RpcProviderHandle | undefined;
  const diagnostics: { diagnostic: RuntimeDiagnostic; cause: unknown }[] = [];
  const cleanup = new AsyncDisposableStack();
  const definition = defineDevframe({
    id: 'example-cdb-auth',
    name: 'Authenticated CDB example',
    packageName: '@devkit/example-debugger',
    version: '0.0.0',
    description: 'Native browser provider over an authenticated Devframe connection.',
    homepage: 'https://github.com/dvcol/devkit-extension',
    services: [createCdbService()],
    async setup(context) {
      service = getCdbService(context);
      cleanup.defer(() => service?.dispose());
      registerEcho(context);
      provider = await createRpcProvider({
        context: {
          rpc: context.rpc,
          realm: defineRealm({ id: 'devserver' }),
          execution: remoteDebuggerExecution,
          native: nativeContextAccess(context),
        },
        providerId: 'example.remote-debugger',
        services: [remotePageTitleService],
        plugins: [remotePageTitlePlugin],
        expose: { actions: [readPageTitleAction] },
        report: (diagnostic, cause) => {
          diagnostics.push({ diagnostic, cause });
        },
      });
      cleanup.defer(() => provider?.dispose());
    },
  });
  return {
    definition,
    diagnostics,
    requireService: () => required(service),
    requireProvider: () => required(provider),
    dispose: () => cleanup.disposeAsync(),
  };
}

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error('Native CDB fixture is not ready');
  return value;
}

function registerEcho(context: DevframeNodeContext): void {
  context.rpc.register({
    name: 'fixture:echo',
    type: 'query',
    handler(value: unknown) {
      return {
        value: z.string().parse(value),
        trusted: context.rpc.getCurrentRpcSession()?.meta.isTrusted === true,
      };
    },
  });
}

function nativeContextAccess(context: DevframeNodeContext): NativeContextAccess {
  function get<Value>(descriptor: NativeContextDescriptor<Value>): Value | undefined;
  function get(descriptor: NativeContextDescriptor<unknown>): unknown {
    return descriptor.id === remoteDebuggerContext.id ? context : undefined;
  }
  return { get };
}
