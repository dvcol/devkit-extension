import { defineExecution, definePlugin, defineTransform } from '@devkit/core';
import type { InstallationHandle } from '@devkit/core';
import type { ProviderRpc, RpcProviderHandle } from '@devkit/devframe';

type RedirectRuleName = 'lower' | 'higher';
type RedirectOperation = 'install' | 'disable' | 'enable' | 'dispose';
type RedirectInstallations = Record<RedirectRuleName, InstallationHandle | undefined>;

declare module 'devframe/types' {
  interface DevframeRpcServerFunctions {
    'example:redirects:control': (
      name: RedirectRuleName,
      operation: RedirectOperation,
    ) => ReturnType<typeof redirectSnapshot>;
    'example:redirects:failure': (kind: 'duplicate' | 'invalid') => Promise<{
      failure: ReturnType<InstallationHandle['snapshot']>;
      current: Awaited<ReturnType<typeof redirectSnapshot>>;
    }>;
  }
}

/** Changing only the path preserves the fixture's granted loopback origin and port. */
function nativeRedirectRule(name: RedirectRuleName): chrome.declarativeNetRequest.Rule {
  return {
    id: name === 'lower' ? 1201 : 1202,
    priority: name === 'lower' ? 1 : 2,
    action: { type: 'redirect', redirect: { transform: { path: `/redirect-${name}` } } },
    condition: {
      urlFilter: '|http://127.0.0.1:*/transform-redirect|',
      resourceTypes: ['xmlhttprequest'],
    },
  };
}

function redirectTransform(id: string, rule: chrome.declarativeNetRequest.Rule) {
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

async function redirectSnapshot(installations: RedirectInstallations) {
  return {
    lower: installations.lower?.snapshot() ?? null,
    higher: installations.higher?.snapshot() ?? null,
    rules: await chrome.declarativeNetRequest.getSessionRules(),
  };
}

async function controlRedirect(
  provider: RpcProviderHandle,
  installations: RedirectInstallations,
  name: RedirectRuleName,
  operation: string,
) {
  const current = installations[name];
  if (operation === 'install') {
    if (current !== undefined && current.snapshot().status !== 'disposed')
      throw new Error('Dispose the owned redirect contribution before reinstalling');
    const id = `example.redirects-${name}`;
    installations[name] = await provider.plugins.install(
      definePlugin({ id, transforms: [redirectTransform(id, nativeRedirectRule(name))] }),
    );
    return;
  }
  if (current === undefined) throw new Error('Install the redirect contribution first');
  if (operation === 'disable' || operation === 'enable' || operation === 'dispose') {
    await current[operation]();
    return;
  }
  throw new TypeError('Unknown redirect contribution operation');
}

function invalidRedirectTransform() {
  return defineTransform({
    id: 'example.redirects-invalid',
    execution: defineExecution({ id: 'example.background' }),
    async setup({ scope }) {
      /** Native validation rejects the whole update, including its requested removal. */
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [1201],
        addRules: [{ ...nativeRedirectRule('lower'), id: 0 }],
      });
      scope.onDispose(() =>
        chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [0] }),
      );
    },
  });
}

async function nativeRedirectFailure(provider: RpcProviderHandle, kind: string) {
  if (kind !== 'duplicate' && kind !== 'invalid')
    throw new TypeError('Unknown native redirect failure fixture');
  let transform = invalidRedirectTransform();
  if (kind === 'duplicate')
    transform = redirectTransform('example.redirects-duplicate', nativeRedirectRule('higher'));
  const failure = await provider.plugins.install(
    definePlugin({ id: transform.id, transforms: [transform] }),
  );
  try {
    return failure.snapshot();
  } finally {
    await failure.dispose();
  }
}

/** Existing admitted packaged pages control only these compiled native declarations. */
export function registerRedirectControls(options: {
  readonly rpc: Pick<ProviderRpc<undefined>, 'register'>;
  readonly provider: Promise<RpcProviderHandle>;
}): void {
  const installations: RedirectInstallations = { lower: undefined, higher: undefined };
  options.rpc.register({
    name: 'example:redirects:control',
    type: 'action',
    async handler(name: string, operation: string) {
      if (name !== 'lower' && name !== 'higher')
        throw new TypeError('Unknown native redirect rule');
      await controlRedirect(await options.provider, installations, name, operation);
      return redirectSnapshot(installations);
    },
  });
  options.rpc.register({
    name: 'example:redirects:failure',
    type: 'action',
    async handler(kind: string) {
      return {
        failure: await nativeRedirectFailure(await options.provider, kind),
        current: await redirectSnapshot(installations),
      };
    },
  });
}
