import { defineService } from '@devkit/core';
import type {
  ActivationScope,
  CapabilityImplementation,
  ExecutionDescriptor,
  NativeContextDescriptor,
  OperationContext,
} from '@devkit/core';
import type { JsonRenderViewContext } from '@devframes/json-render/view';
import {
  inspectorCapability,
  inspectorStateKey,
  inspectorStateSchema,
} from '@devkit/example-contribution/inspector';
import type { InspectorState } from '@devkit/example-contribution/inspector';
import { browser } from '@wxt-dev/browser';
import type { WebRequest } from 'webextension-polyfill';
import type { SharedState } from 'devframe/utils/shared-state';

const fixtureMatch = 'http://127.0.0.1/inspector-fixture';
const markerId = 'example-response-inspector-marker';
const unsupportedReason = 'Native Firefox response filtering is unavailable in this browser';

function supportsResponseFiltering(
  value: unknown,
): value is Pick<WebRequest.Static, 'filterResponseData'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'filterResponseData' in value &&
    typeof value.filterResponseData === 'function'
  );
}

async function selectedFixture() {
  const tabs = await browser.tabs.query({ url: fixtureMatch });
  if (tabs.length !== 1)
    throw new Error(`Expected exactly one owned /inspector-fixture tab; found ${tabs.length}`);
  const tab = tabs[0];
  if (tab?.id === undefined || tab.url === undefined)
    throw new Error('The owned inspector fixture tab has no accessible identity or URL');
  return { id: tab.id, url: tab.url };
}

/** Serialized by the native scripting API; all inputs and the request path remain fixed. */
async function readFixtureResponse() {
  if (
    location.protocol !== 'http:' ||
    location.hostname !== '127.0.0.1' ||
    location.pathname !== '/inspector-fixture'
  )
    throw new Error('The selected document is no longer the owned inspector fixture');
  const response = await fetch('/inspector-response', { cache: 'no-store' });
  return { url: response.url, status: response.status, body: await response.text() };
}

function initialState(): InspectorState {
  const modification: InspectorState['modification'] = { status: 'available' };
  if (!supportsResponseFiltering(browser.webRequest)) {
    modification.status = 'unavailable';
    modification.reason = unsupportedReason;
  }
  return {
    target: null,
    configuration: { enabled: false },
    modification,
    latest: null,
    marker: false,
  };
}

/** Native resource selection belongs to this example capability, not to transport routing. */
export function createInspectorFeature(options: {
  readonly execution: ExecutionDescriptor;
  readonly nativeContext: NativeContextDescriptor<JsonRenderViewContext>;
}) {
  const service = defineService({
    id: 'example.extension.response-inspector',
    capability: inspectorCapability,
    execution: options.execution,
    async setup({ native, scope }) {
      const context = native.get(options.nativeContext);
      if (context === undefined) throw new Error('The native shared-state context is required');
      const state = await context.rpc.sharedState.get<InspectorState>(inspectorStateKey, {
        initialValue: initialState(),
      });
      inspectorStateSchema.parse(state.value());
      return new NativeInspector(state, scope);
    },
  });
  return { service };
}

class NativeInspector implements CapabilityImplementation<typeof inspectorCapability> {
  private selectedTabId: number | undefined;
  private registered = false;

  constructor(
    private readonly state: SharedState<InspectorState>,
    scope: ActivationScope,
  ) {
    scope.onDispose(() => this.unregisterMarker());
    this.installResponseFilter(scope);
  }

  async read(_input: Record<string, never>, { signal }: OperationContext) {
    this.snapshot();
    signal.throwIfAborted();
    const selected = await this.select();
    signal.throwIfAborted();
    const results = await browser.scripting.executeScript({
      target: { tabId: selected.id },
      world: 'MAIN',
      func: readFixtureResponse,
    });
    signal.throwIfAborted();
    const result = results[0];
    if (result !== undefined && 'error' in result && result.error !== undefined) {
      if (result.error instanceof Error) throw result.error;
      throw new Error('Native page execution failed', { cause: result.error });
    }
    const latest = inspectorStateSchema.shape.latest.unwrap().parse(result?.result);
    this.state.mutate((current) => {
      current.latest = latest;
    });
    return this.snapshot();
  }

  async configure({ enabled }: { enabled: boolean }, { signal }: OperationContext) {
    this.snapshot();
    signal.throwIfAborted();
    if (enabled && !supportsResponseFiltering(browser.webRequest))
      throw new Error(unsupportedReason);
    if (enabled) await this.select();
    signal.throwIfAborted();
    this.state.mutate((current) => {
      current.configuration.enabled = enabled;
    });
    return this.snapshot();
  }

  async marker(_input: Record<string, never>, { signal }: OperationContext) {
    this.snapshot();
    signal.throwIfAborted();
    await this.select();
    signal.throwIfAborted();
    if (!this.registered) {
      await browser.scripting.registerContentScripts([
        {
          id: markerId,
          js: ['inspector-marker.js'],
          matches: [fixtureMatch],
          runAt: 'document_start',
          world: 'MAIN',
          persistAcrossSessions: false,
        },
      ]);
      this.registered = true;
    }
    this.state.mutate((current) => {
      current.marker = true;
    });
    return this.snapshot();
  }

  async reset(_input: Record<string, never>, { signal }: OperationContext) {
    signal.throwIfAborted();
    await this.unregisterMarker();
    signal.throwIfAborted();
    this.selectedTabId = undefined;
    this.state.mutate((current) => {
      current.target = null;
      current.configuration.enabled = false;
      current.latest = null;
      current.marker = false;
    });
    return this.snapshot();
  }

  private snapshot() {
    return inspectorStateSchema.parse(this.state.value());
  }

  private async select() {
    const selected = await selectedFixture();
    this.selectedTabId = selected.id;
    this.state.mutate((current) => {
      current.target = selected.url;
    });
    return selected;
  }

  private async unregisterMarker() {
    if (!this.registered) return;
    await browser.scripting.unregisterContentScripts({ ids: [markerId] });
    this.registered = false;
    this.state.mutate((current) => {
      current.marker = false;
    });
  }

  private installResponseFilter(scope: ActivationScope) {
    const nativeRequests = browser.webRequest;
    if (!supportsResponseFiltering(nativeRequests)) return;
    const prefix = new TextEncoder().encode('native:');
    const listener = (
      details: Pick<
        WebRequest.OnBeforeRequestDetailsType,
        'tabId' | 'frameId' | 'documentUrl' | 'requestId' | 'url'
      >,
    ) => {
      const current = this.snapshot();
      /** A retained tab ID does not identify the document that initiated this request. */
      if (
        !current.configuration.enabled ||
        current.target === null ||
        details.tabId !== this.selectedTabId ||
        details.frameId !== 0 ||
        details.documentUrl !== current.target ||
        details.url !== new URL('/inspector-response', current.target).href
      )
        return {};
      const filter = nativeRequests.filterResponseData(details.requestId);
      filter.onstart = () => {
        filter.write(prefix);
      };
      filter.ondata = ({ data }) => {
        filter.write(data);
      };
      filter.onstop = () => {
        filter.close();
      };
      return {};
    };
    nativeRequests.onBeforeRequest.addListener(
      listener,
      { urls: ['http://127.0.0.1/inspector-response'], types: ['xmlhttprequest'] },
      ['blocking'],
    );
    /** Removing admission does not roll back responses already owned by native filters. */
    scope.onDispose(() => {
      nativeRequests.onBeforeRequest.removeListener(listener);
    });
  }
}
