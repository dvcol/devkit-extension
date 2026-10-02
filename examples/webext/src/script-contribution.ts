import { defineExecution, definePlugin, defineScript } from '@devkit/core';
import type { InstallationHandle } from '@devkit/core';
import type { ProviderRpc, RpcProviderHandle } from '@devkit/devframe';

declare module 'devframe/types' {
  interface DevframeRpcServerFunctions {
    'example:scripts:install': (
      world: `${chrome.scripting.ExecutionWorld}`,
    ) => ReturnType<typeof scriptSnapshot>;
    'example:scripts:disable': () => ReturnType<typeof scriptSnapshot>;
    'example:scripts:enable': () => ReturnType<typeof scriptSnapshot>;
    'example:scripts:dispose': () => ReturnType<typeof scriptSnapshot>;
  }
}

/** Packaged code stays in the native Vite/WXT graph; this recipe owns browser registration. */
function timingScript(world: `${chrome.scripting.ExecutionWorld}`) {
  return defineScript({
    id: 'example.bootstrap',
    execution: defineExecution({ id: 'example.background' }),
    async setup({ scope }) {
      await chrome.scripting.registerContentScripts([
        {
          id: 'example-script-timing',
          js: ['script-timing.js'],
          matches: ['http://127.0.0.1/index.html'],
          runAt: 'document_start',
          world,
          allFrames: false,
          persistAcrossSessions: false,
        },
      ]);
      scope.onDispose(() =>
        chrome.scripting.unregisterContentScripts({ ids: ['example-script-timing'] }),
      );
    },
  });
}

async function scriptSnapshot(installation: InstallationHandle | undefined) {
  return {
    installation: installation?.snapshot() ?? null,
    registrations: await chrome.scripting.getRegisteredContentScripts({
      ids: ['example-script-timing'],
    }),
  };
}

/** Only the example's admitted packaged pages can reach these native RPC controls. */
export function registerScriptControls(options: {
  readonly rpc: Pick<ProviderRpc<undefined>, 'register'>;
  readonly provider: Promise<RpcProviderHandle>;
}): void {
  let installation: InstallationHandle | undefined;

  function currentInstallation(): InstallationHandle {
    if (installation === undefined) throw new Error('Install the script contribution first');
    return installation;
  }

  options.rpc.register({
    name: 'example:scripts:install',
    type: 'action',
    async handler(world: string) {
      if (world !== 'MAIN' && world !== 'ISOLATED')
        throw new TypeError('Script world must be MAIN or ISOLATED');
      const provider = await options.provider;
      installation = await provider.plugins.install(
        definePlugin({ id: 'example.bootstrap', scripts: [timingScript(world)] }),
      );
      return scriptSnapshot(installation);
    },
  });
  for (const operation of ['disable', 'enable', 'dispose'] as const) {
    options.rpc.register({
      name: `example:scripts:${operation}`,
      type: 'action',
      async handler() {
        const current = currentInstallation();
        await current[operation]();
        return scriptSnapshot(current);
      },
    });
  }
}
