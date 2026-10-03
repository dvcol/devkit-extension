import { defineScript, defineService, defineTransform } from '@devkit/core';
import type {
  CapabilityImplementation,
  ScriptDefinition,
  ServiceDefinition,
  TransformDefinition,
} from '@devkit/core';
import {
  inspectorCapability,
  inspectorStateKey,
  inspectorStateSchema,
} from '@devkit/example-contribution/inspector';
import type { InspectorState } from '@devkit/example-contribution/inspector';
import { devframeHubContext, serverExecution } from '@devkit/server';
import type { SharedState } from 'devframe/utils/shared-state';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

interface NativeFeature {
  server: ViteDevServer | PreviewServer | undefined;
  state: SharedState<InspectorState> | undefined;
  preview: boolean;
  scriptActive: boolean;
  transformActive: boolean;
}

function initialState(): InspectorState {
  return {
    target: null,
    configuration: { enabled: false },
    modification: { status: 'available' },
    latest: null,
    marker: false,
  };
}

function responseUrl(feature: NativeFeature): string {
  const address = feature.server?.httpServer?.address();
  if (address === undefined || address === null || typeof address === 'string')
    throw new Error('The owned Vite response is unavailable before its HTTP server is listening');
  return `http://127.0.0.1:${address.port}/inspector-response`;
}

function readState(state: SharedState<InspectorState>): InspectorState {
  const current = state.value();
  inspectorStateSchema.parse(current);
  return current;
}

function operations(
  feature: NativeFeature,
  state: SharedState<InspectorState>,
): CapabilityImplementation<typeof inspectorCapability> {
  return {
    async read(_input, { signal }) {
      readState(state);
      const response = await fetch(responseUrl(feature), { signal });
      const latest = { url: response.url, status: response.status, body: await response.text() };
      readState(state);
      state.mutate((current) => {
        current.target = latest.url;
        current.latest = latest;
      });
      return state.value();
    },
    configure({ enabled }) {
      readState(state);
      state.mutate((current) => {
        current.configuration.enabled = enabled;
      });
      return state.value();
    },
    marker() {
      readState(state);
      if (feature.preview)
        throw new Error(
          'Vite preview serves built HTML; page markers must be included during build',
        );
      state.mutate((current) => {
        current.marker = true;
      });
      return state.value();
    },
    reset() {
      /** Explicit reset replaces even malformed native state; ordinary operations never repair it. */
      state.patch([{ op: 'replace', path: [], value: initialState() }]);
      return state.value();
    },
  };
}

function createInspectorService(feature: NativeFeature) {
  return defineService({
    id: 'example.server-response-inspector',
    capability: inspectorCapability,
    execution: serverExecution,
    async setup({ native, scope }) {
      const context = native.get(devframeHubContext);
      if (context === undefined) throw new Error('A Devframe hub context is required');
      const state = await context.rpc.sharedState.get<InspectorState>(inspectorStateKey, {
        initialValue: initialState(),
      });
      feature.state = state;
      scope.onDispose(() => {
        feature.state = undefined;
      });
      return operations(feature, state);
    },
  });
}

function nativePlugin(feature: NativeFeature): Plugin {
  function configure(server: ViteDevServer | PreviewServer, preview: boolean): void {
    feature.server = server;
    feature.preview = preview;
    server.middlewares.use((request, response, next) => {
      if (request.url?.split('?')[0] !== '/inspector-response') {
        next();
        return;
      }
      /** This owns one fixture response; it does not intercept arbitrary server output. */
      const modified =
        feature.transformActive &&
        feature.state !== undefined &&
        readState(feature.state).configuration.enabled;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(modified ? 'native:fixture:original' : 'fixture:original');
    });
  }
  return {
    name: 'devkit:example-response-inspector',
    configureServer(server) {
      configure(server, false);
    },
    configurePreviewServer(server) {
      configure(server, true);
    },
    transformIndexHtml(_html, context) {
      if (context.path !== '/' && context.path !== '/index.html') return [];
      if (!feature.scriptActive || feature.state === undefined) return [];
      if (!readState(feature.state).marker) return [];
      return [
        {
          tag: 'script',
          children: 'Reflect.set(globalThis, "responseInspectorMarker", document.readyState);',
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

/** Native scopes gate future effects. Preview supports the owned endpoint but cannot inject built HTML. */
export function createInspectorFeature(): {
  service: ServiceDefinition<typeof inspectorCapability, Record<string, never>>;
  script: ScriptDefinition<{ inspector: typeof inspectorCapability }>;
  transform: TransformDefinition<{ inspector: typeof inspectorCapability }>;
  plugin: Plugin;
} {
  const feature: NativeFeature = {
    server: undefined,
    state: undefined,
    preview: false,
    scriptActive: false,
    transformActive: false,
  };
  return {
    service: createInspectorService(feature),
    script: defineScript({
      id: 'example.inspector-marker',
      execution: serverExecution,
      requires: { inspector: inspectorCapability },
      setup({ scope }) {
        feature.scriptActive = true;
        scope.onDispose(() => {
          feature.scriptActive = false;
        });
      },
    }),
    transform: defineTransform({
      id: 'example.inspector-response',
      execution: serverExecution,
      requires: { inspector: inspectorCapability },
      setup({ scope }) {
        feature.transformActive = true;
        scope.onDispose(() => {
          feature.transformActive = false;
        });
      },
    }),
    plugin: nativePlugin(feature),
  };
}
