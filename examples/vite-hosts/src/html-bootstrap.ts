import type { Plugin } from 'vite';

/** Native HTML transformation for the example application in development and production builds. */
export function htmlBootstrapPlugin(): Plugin {
  return {
    name: 'devkit:example-html-bootstrap',
    transformIndexHtml(_html, context) {
      if (context.path !== '/' && context.path !== '/index.html') return [];
      return [
        {
          tag: 'script',
          children: 'Reflect.set(globalThis, "exampleHtmlBootstrap", document.readyState);',
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
