import { defineExecution, definePlugin, defineTransform } from '@devkit/core';
import type { InstallationHandle } from '@devkit/core';
import type { ProviderRpc, RpcProviderHandle } from '@devkit/devframe';

type HeaderRuleName = 'lower' | 'higher';
type HeaderOperation = 'install' | 'disable' | 'enable' | 'dispose';
type HeaderInstallations = Record<HeaderRuleName, InstallationHandle | undefined>;

declare module 'devframe/types' {
  interface DevframeRpcServerFunctions {
    'example:headers:control': (
      name: HeaderRuleName,
      operation: HeaderOperation,
    ) => ReturnType<typeof headerSnapshot>;
    'example:headers:failure': (kind: 'duplicate' | 'invalid') => Promise<{
      failure: ReturnType<InstallationHandle['snapshot']>;
      current: Awaited<ReturnType<typeof headerSnapshot>>;
    }>;
  }
}

/** These two native IDs belong only to this fixed, loopback-scoped example. */
function nativeHeaderRule(name: HeaderRuleName): chrome.declarativeNetRequest.Rule {
  return {
    id: name === 'lower' ? 1101 : 1102,
    priority: name === 'lower' ? 1 : 2,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'X-Devkit-Request', operation: 'set', value: name }],
      responseHeaders: [{ header: 'X-Devkit-Response', operation: 'set', value: name }],
    },
    condition: {
      urlFilter: '|http://127.0.0.1:*/transform-headers|',
      resourceTypes: ['xmlhttprequest'],
    },
  };
}

function headerTransform(id: string, rule: chrome.declarativeNetRequest.Rule) {
  return defineTransform({
    id,
    execution: defineExecution({ id: 'example.background' }),
    async setup({ scope }) {
      await chrome.declarativeNetRequest.updateSessionRules({ addRules: [rule] });
      scope.onDispose(() =>
        chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [rule.id] }),
      );
    },
  });
}

async function headerSnapshot(installations: HeaderInstallations) {
  return {
    lower: installations.lower?.snapshot() ?? null,
    higher: installations.higher?.snapshot() ?? null,
    rules: await chrome.declarativeNetRequest.getSessionRules(),
  };
}

async function controlHeader(
  provider: RpcProviderHandle,
  installations: HeaderInstallations,
  name: HeaderRuleName,
  operation: string,
) {
  const current = installations[name];
  if (operation === 'install') {
    if (current !== undefined && current.snapshot().status !== 'disposed')
      throw new Error('Dispose the owned header contribution before reinstalling');
    const id = `example.headers-${name}`;
    installations[name] = await provider.plugins.install(
      definePlugin({ id, transforms: [headerTransform(id, nativeHeaderRule(name))] }),
    );
    return;
  }
  if (current === undefined) throw new Error('Install the header contribution first');
  if (operation === 'disable' || operation === 'enable' || operation === 'dispose') {
    await current[operation]();
    return;
  }
  throw new TypeError('Unknown header contribution operation');
}

function invalidHeaderTransform() {
  return defineTransform({
    id: 'example.headers-invalid',
    execution: defineExecution({ id: 'example.background' }),
    async setup({ scope }) {
      /** Native validation must reject the entire update, including its requested removal. */
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [1101],
        addRules: [{ ...nativeHeaderRule('lower'), id: 0 }],
      });
      scope.onDispose(() =>
        chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [0] }),
      );
    },
  });
}

async function nativeHeaderFailure(provider: RpcProviderHandle, kind: string) {
  if (kind !== 'duplicate' && kind !== 'invalid')
    throw new TypeError('Unknown native failure fixture');
  let transform = invalidHeaderTransform();
  if (kind === 'duplicate')
    transform = headerTransform('example.headers-duplicate', nativeHeaderRule('higher'));
  const failure = await provider.plugins.install(
    definePlugin({ id: transform.id, transforms: [transform] }),
  );
  try {
    return failure.snapshot();
  } finally {
    await failure.dispose();
  }
}

/** Only the example's admitted packaged pages can control these compiled native declarations. */
export function registerHeaderControls(options: {
  readonly rpc: Pick<ProviderRpc<undefined>, 'register'>;
  readonly provider: Promise<RpcProviderHandle>;
}): void {
  const installations: HeaderInstallations = { lower: undefined, higher: undefined };
  options.rpc.register({
    name: 'example:headers:control',
    type: 'action',
    async handler(name: string, operation: string) {
      if (name !== 'lower' && name !== 'higher') throw new TypeError('Unknown native header rule');
      await controlHeader(await options.provider, installations, name, operation);
      return headerSnapshot(installations);
    },
  });
  options.rpc.register({
    name: 'example:headers:failure',
    type: 'action',
    async handler(kind: string) {
      return {
        failure: await nativeHeaderFailure(await options.provider, kind),
        current: await headerSnapshot(installations),
      };
    },
  });
}
