import { defineExecution, definePlugin, defineTransform } from '@devkit/core';
import type { InstallationHandle } from '@devkit/core';
import type { ProviderRpc, RpcProviderHandle } from '@devkit/devframe';
import { browser } from '@wxt-dev/browser';
import type { Browser } from '@wxt-dev/browser';
import type { WebRequest } from 'webextension-polyfill';

type FirefoxResponseFiltering = Pick<WebRequest.Static, 'filterResponseData'>;
type ResponseOperation = 'install' | 'disable' | 'enable' | 'dispose' | 'snapshot';

function supportsResponseFiltering(value: unknown): value is FirefoxResponseFiltering {
  return (
    typeof value === 'object' &&
    value !== null &&
    'filterResponseData' in value &&
    typeof value.filterResponseData === 'function'
  );
}

declare module 'devframe/types' {
  interface DevframeRpcServerFunctions {
    'example:response:control': (operation: ResponseOperation) => ResponseSnapshot;
  }
}

interface ResponseSnapshot {
  readonly filteringMethodPresent: boolean;
  readonly installation: ReturnType<InstallationHandle['snapshot']> | null;
  readonly admitted: number;
  readonly chunks: number;
  readonly completed: number;
  readonly errors: readonly string[];
}

/** The fixed prefix changes only the owned loopback UTF-8 fixture, without decoding its chunks. */
function createResponseTransform() {
  let admitted = 0;
  let chunks = 0;
  let completed = 0;
  const errors: string[] = [];
  const prefix = new TextEncoder().encode('native:');
  const definition = defineTransform({
    id: 'example.response-body',
    execution: defineExecution({ id: 'example.background' }),
    setup({ scope }) {
      const nativeRequests = browser.webRequest;
      if (!supportsResponseFiltering(nativeRequests))
        throw new Error('Native Firefox response filtering is unavailable in this browser');
      const listener = (details: Browser.webRequest.OnBeforeRequestDetails) => {
        const filter: WebRequest.StreamFilter = nativeRequests.filterResponseData(
          details.requestId,
        );
        admitted += 1;
        filter.onstart = () => {
          filter.write(prefix);
        };
        filter.ondata = ({ data }) => {
          chunks += 1;
          filter.write(data);
        };
        filter.onstop = () => {
          filter.close();
          completed += 1;
        };
        // oxlint-disable-next-line unicorn/prefer-add-event-listener -- Published StreamFilter declarations omit inherited addEventListener.
        filter.onerror = () => {
          errors.push(filter.error);
        };
        return {};
      };
      nativeRequests.onBeforeRequest.addListener(
        listener,
        { urls: ['http://127.0.0.1/transform-response/*'], types: ['xmlhttprequest'] },
        ['blocking'],
      );
      /** Removal stops new admissions; admitted native streams finish their own handlers. */
      scope.onDispose(() => {
        nativeRequests.onBeforeRequest.removeListener(listener);
      });
    },
  });
  return { definition, snapshot: () => ({ admitted, chunks, completed, errors: [...errors] }) };
}

/** Existing admitted packaged pages control this one compiled native registration. */
export function registerResponseControls(options: {
  readonly rpc: Pick<ProviderRpc<undefined>, 'register'>;
  readonly provider: Promise<RpcProviderHandle>;
}): void {
  let installation: InstallationHandle | undefined;
  let transform = createResponseTransform();
  options.rpc.register({
    name: 'example:response:control',
    type: 'action',
    async handler(operation: string): Promise<ResponseSnapshot> {
      if (operation === 'install') {
        if (installation !== undefined && installation.snapshot().status !== 'disposed')
          throw new Error('Dispose the owned response contribution before reinstalling');
        transform = createResponseTransform();
        installation = await (
          await options.provider
        ).plugins.install(
          definePlugin({ id: transform.definition.id, transforms: [transform.definition] }),
        );
      } else if (operation !== 'snapshot') {
        if (operation !== 'disable' && operation !== 'enable' && operation !== 'dispose')
          throw new TypeError('Unknown native response contribution operation');
        if (installation === undefined) throw new Error('Install the response contribution first');
        await installation[operation]();
      }
      return {
        filteringMethodPresent: supportsResponseFiltering(browser.webRequest),
        installation: installation?.snapshot() ?? null,
        ...transform.snapshot(),
      };
    },
  });
}
