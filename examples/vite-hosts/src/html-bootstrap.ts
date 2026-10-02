import type { Plugin } from 'vite';
import { defineScript } from '@devkit/core';
import { serverExecution } from '@devkit/server';

function bootstrapTags(path: string) {
  if (path !== '/' && path !== '/index.html') return [];
  return [
    {
      tag: 'script',
      children: 'Reflect.set(globalThis, "exampleHtmlBootstrap", document.readyState);',
      injectTo: 'head-prepend' as const,
    },
  ];
}

/** Native HTML transformation for the example application in development and production builds. */
export function htmlBootstrapPlugin(): Plugin {
  return {
    name: 'devkit:example-html-bootstrap',
    transformIndexHtml(_html, context) {
      return bootstrapTags(context.path);
    },
  };
}

/** Native configuration installs the hook; the contribution owns its live registration. */
export function createHtmlBootstrapFeature() {
  let enabled = false;
  const plugin: Plugin = {
    name: 'devkit:example-html-bootstrap',
    transformIndexHtml(_html, context) {
      if (!enabled) return [];
      return bootstrapTags(context.path);
    },
  };
  const script = defineScript({
    id: 'example.bootstrap',
    execution: serverExecution,
    setup({ scope }) {
      enabled = true;
      scope.onDispose(() => {
        enabled = false;
      });
    },
  });
  return { plugin, script };
}
