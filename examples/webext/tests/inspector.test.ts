import { defineExecution, defineNativeContext, defineRealm } from '@devkit/core';
import type { NativeContextDescriptor } from '@devkit/core';
import { createRpcProvider } from '@devkit/devframe';
import type { JsonRenderViewContext } from '@devframes/json-render/view';
import {
  configureInspectorAction,
  createInspectorActions,
  inspectorStateKey,
  markInspectorAction,
  readInspectorAction,
  resetInspectorAction,
} from '@devkit/example-contribution/inspector';
import type { InspectorState } from '@devkit/example-contribution/inspector';
import { RpcFunctionsCollectorBase } from 'devframe/rpc';
import { createRpcSharedStateServerHost } from 'devframe/rpc/shared-state';
import type { DevframeRpcServerFunctions } from 'devframe/types';
import type { WebRequest } from 'webextension-polyfill';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInspectorFeature } from '../src/inspector';

interface NativeFilter {
  onstart?: () => void;
  ondata?: (event: { data: ArrayBuffer }) => void;
  onstop?: () => void;
  write: (data: ArrayBuffer | Uint8Array) => void;
  close: () => void;
}

type NativeRequest = Pick<
  WebRequest.OnBeforeRequestDetailsType,
  'tabId' | 'frameId' | 'documentUrl' | 'originUrl' | 'requestId' | 'url'
>;

const native = vi.hoisted(() => ({
  query: vi.fn<() => Promise<{ id: number; url: string }[]>>(),
  executeScript: vi.fn<() => Promise<{ result?: InspectorState['latest']; error?: Error }[]>>(),
  register: vi.fn<() => Promise<void>>(),
  unregister: vi.fn<() => Promise<void>>(),
  addListener: vi.fn<(listener: (details: NativeRequest) => object) => void>(),
  removeListener: vi.fn<(listener: unknown) => void>(),
  filterResponseData: vi.fn<() => NativeFilter>(),
}));
const requests = vi.hoisted(() => ({
  onBeforeRequest: {
    addListener: native.addListener,
    removeListener: native.removeListener,
  },
  filterResponseData: native.filterResponseData,
}));
vi.mock('@wxt-dev/browser', () => ({
  browser: {
    tabs: { query: native.query },
    scripting: {
      executeScript: native.executeScript,
      registerContentScripts: native.register,
      unregisterContentScripts: native.unregister,
    },
    webRequest: requests,
  },
}));

const fixtureUrl = 'http://127.0.0.1:4321/inspector-fixture';
const response = { url: 'http://127.0.0.1:4321/inspector-response', status: 200, body: 'original' };
const cleanup: (() => Promise<void>)[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  requests.filterResponseData = native.filterResponseData;
  native.query.mockResolvedValue([{ id: 7, url: fixtureUrl }]);
  native.executeScript.mockResolvedValue([{ result: response }]);
  native.register.mockResolvedValue();
  native.unregister.mockResolvedValue();
});

afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
});

async function inspector() {
  const execution = defineExecution({ id: 'example.background' });
  const descriptor = defineNativeContext<JsonRenderViewContext>({ id: 'test.inspector-context' });
  const collector = new RpcFunctionsCollectorBase<DevframeRpcServerFunctions, undefined>(undefined);
  const rpc = {
    register: collector.register.bind(collector),
    has: collector.has.bind(collector),
    async broadcast() {},
  };
  const context = { rpc: { sharedState: createRpcSharedStateServerHost(rpc) } };
  function get<Value>(requested: NativeContextDescriptor<Value>): Value | undefined;
  function get(requested: NativeContextDescriptor<unknown>): unknown {
    return requested.id === descriptor.id ? context : undefined;
  }
  const feature = createInspectorFeature({ execution, nativeContext: descriptor });
  const provider = await createRpcProvider({
    context: { rpc, execution, realm: defineRealm({ id: 'webext' }), native: { get } },
    providerId: 'test.inspector',
    services: [feature.service],
    plugins: [createInspectorActions({ execution })],
    report() {},
  });
  cleanup.push(() => provider.dispose());
  const state = await context.rpc.sharedState.get<InspectorState>(inspectorStateKey);
  return { provider, state };
}

it('rejects absent and ambiguous owned tabs before executing and preserves native read failures', async () => {
  expect.assertions(6);
  const { provider, state } = await inspector();
  native.query.mockResolvedValueOnce([]);
  await expect(provider.invoke({ action: readInspectorAction, input: {} })).rejects.toHaveProperty(
    'cause.message',
    'Expected exactly one owned /inspector-fixture tab; found 0',
  );
  native.query.mockResolvedValueOnce([
    { id: 7, url: fixtureUrl },
    { id: 8, url: fixtureUrl },
  ]);
  await expect(provider.invoke({ action: readInspectorAction, input: {} })).rejects.toHaveProperty(
    'cause.message',
    'Expected exactly one owned /inspector-fixture tab; found 2',
  );
  expect(native.executeScript).not.toHaveBeenCalled();
  native.executeScript.mockRejectedValueOnce(new Error('Native scripting permission denied'));
  await expect(provider.invoke({ action: readInspectorAction, input: {} })).rejects.toHaveProperty(
    'cause.message',
    'Native scripting permission denied',
  );
  native.executeScript.mockResolvedValueOnce([{ error: new Error('Native page fetch failed') }]);
  await expect(provider.invoke({ action: readInspectorAction, input: {} })).rejects.toHaveProperty(
    'cause.message',
    'Native page fetch failed',
  );
  expect(state.value().latest).toBeNull();
});

it('reports missing response filtering while reads and owned marker reset remain usable', async () => {
  expect.assertions(9);
  Reflect.deleteProperty(requests, 'filterResponseData');
  const { provider, state } = await inspector();
  expect(state.value().modification).toEqual({
    status: 'unavailable',
    reason: 'Native Firefox response filtering is unavailable in this browser',
  });
  await expect(
    provider.invoke({ action: configureInspectorAction, input: { enabled: true } }),
  ).rejects.toHaveProperty(
    'cause.message',
    'Native Firefox response filtering is unavailable in this browser',
  );
  expect(state.value().configuration.enabled).toBe(false);
  await expect(provider.invoke({ action: readInspectorAction, input: {} })).resolves.toMatchObject({
    target: fixtureUrl,
    latest: response,
  });
  await provider.invoke({ action: markInspectorAction, input: {} });
  expect(native.register).toHaveBeenCalledExactlyOnceWith([
    {
      id: 'example-response-inspector-marker',
      js: ['inspector-marker.js'],
      matches: ['http://127.0.0.1/inspector-fixture'],
      runAt: 'document_start',
      world: 'MAIN',
      persistAcrossSessions: false,
    },
  ]);
  expect(state.value().marker).toBe(true);
  await expect(provider.invoke({ action: resetInspectorAction, input: {} })).resolves.toMatchObject(
    {
      target: null,
      latest: null,
      marker: false,
      configuration: { enabled: false },
    },
  );
  expect(native.unregister).toHaveBeenCalledExactlyOnceWith({
    ids: ['example-response-inspector-marker'],
  });
  expect(native.addListener).not.toHaveBeenCalled();
});

it('rejects malformed native configuration before selecting a tab and allows explicit reset', async () => {
  expect.assertions(3);
  const { provider, state } = await inspector();
  state.mutate((current) => {
    Reflect.set(current.configuration, 'enabled', 'invalid');
  });
  await expect(provider.invoke({ action: readInspectorAction, input: {} })).rejects.toHaveProperty(
    'cause.name',
    'ZodError',
  );
  expect(native.query).not.toHaveBeenCalled();
  await expect(provider.invoke({ action: resetInspectorAction, input: {} })).resolves.toMatchObject(
    {
      configuration: { enabled: false },
      latest: null,
    },
  );
});

it.each([
  {
    name: 'the same tab after navigating to another path',
    document: { frameId: 0, documentUrl: 'http://127.0.0.1:4321/another-document' },
  },
  {
    name: 'an unknown document even when originUrl names the fixture',
    document: { frameId: 0, originUrl: fixtureUrl },
  },
  {
    name: 'a child frame with the fixture URL',
    document: { frameId: 2, documentUrl: fixtureUrl },
  },
])('does not attach a response filter for $name', async ({ document }) => {
  expect.assertions(2);
  const { provider } = await inspector();
  await provider.invoke({ action: configureInspectorAction, input: { enabled: true } });
  const listener = native.addListener.mock.calls[0]![0];
  expect(
    listener({ tabId: 7, requestId: 'unowned-document', url: response.url, ...document }),
  ).toEqual({});
  expect(native.filterResponseData).not.toHaveBeenCalled();
});

it('admits only the configured top-level fixture and response URL and removes native resources on disposal', async () => {
  expect.assertions(8);
  const { provider } = await inspector();
  const listener = native.addListener.mock.calls[0]![0];
  const details = {
    tabId: 7,
    frameId: 0,
    documentUrl: fixtureUrl,
    requestId: 'owned-response',
    url: response.url,
  };
  listener(details);
  expect(native.filterResponseData).not.toHaveBeenCalled();
  await provider.invoke({ action: configureInspectorAction, input: { enabled: true } });
  listener({ ...details, tabId: 8 });
  listener({ ...details, url: 'http://127.0.0.1:4322/inspector-response' });
  expect(native.filterResponseData).not.toHaveBeenCalled();
  const write = vi.fn<(data: ArrayBuffer | Uint8Array) => void>();
  const close = vi.fn<() => void>();
  const filter: NativeFilter = { write, close };
  native.filterResponseData.mockReturnValue(filter);
  listener(details);
  expect(native.filterResponseData).toHaveBeenCalledExactlyOnceWith('owned-response');
  const chunk = new TextEncoder().encode('original').buffer;
  filter.onstart?.();
  filter.ondata?.({ data: chunk });
  filter.onstop?.();
  expect(write.mock.calls).toEqual([[new TextEncoder().encode('native:')], [chunk]]);
  expect(close).toHaveBeenCalledOnce();
  await provider.invoke({ action: markInspectorAction, input: {} });
  await provider.dispose();
  expect(native.removeListener).toHaveBeenCalledExactlyOnceWith(listener);
  expect(native.unregister).toHaveBeenCalledExactlyOnceWith({
    ids: ['example-response-inspector-marker'],
  });
  expect(provider.catalog.snapshot().capabilities).toEqual([]);
});
