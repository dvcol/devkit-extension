import { defineTransform } from '@devkit/core';
import { serverExecution } from '@devkit/server';
import type { IndexHtmlTransformContext, Plugin } from 'vite';

function isApplicationHtml(context: IndexHtmlTransformContext): boolean {
  return context.path === '/' || context.path === '/index.html';
}

function firstHtmlTransform(html: string, context: IndexHtmlTransformContext) {
  if (!isApplicationHtml(context)) return html;
  return html.replace('data-native-transforms=""', 'data-native-transforms="first"');
}

function secondHtmlTransform(html: string, context: IndexHtmlTransformContext) {
  if (!isApplicationHtml(context)) return html;
  /** This bounded fixture exposes Vite's own request failure and subsequent recovery. */
  if (
    new URL(context.originalUrl ?? context.path, 'http://example.test').searchParams.has(
      'transform-error',
    )
  )
    throw new Error('Example second native HTML transform failed');
  return html.replace(/data-native-transforms="([^"]*)"/u, (_attribute, previous: string) => {
    const marker = previous === '' ? 'second' : `${previous},second`;
    return `data-native-transforms="${marker}"`;
  });
}

/** Native hook order controls composition even though configuration lists the post hook first. */
export function htmlTransformPlugins(): Plugin[] {
  return [
    {
      name: 'devkit:example-html-second',
      transformIndexHtml: { order: 'post', handler: secondHtmlTransform },
    },
    {
      name: 'devkit:example-html-first',
      transformIndexHtml: { order: 'pre', handler: firstHtmlTransform },
    },
  ];
}

function firstHtmlFeature() {
  let enabled = false;
  const plugin: Plugin = {
    name: 'devkit:example-html-first',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (!enabled) return html;
        return firstHtmlTransform(html, context);
      },
    },
  };
  const transform = defineTransform({
    id: 'example.html-first',
    execution: serverExecution,
    setup({ scope }) {
      enabled = true;
      scope.onDispose(() => {
        enabled = false;
      });
    },
  });
  return { plugin, transform };
}

function secondHtmlFeature() {
  let enabled = false;
  const plugin: Plugin = {
    name: 'devkit:example-html-second',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (!enabled) return html;
        return secondHtmlTransform(html, context);
      },
    },
  };
  const transform = defineTransform({
    id: 'example.html-second',
    execution: serverExecution,
    setup({ scope }) {
      enabled = true;
      scope.onDispose(() => {
        enabled = false;
      });
    },
  });
  return { plugin, transform };
}

/** Each recipe owns its configured native hook independently, without a response pipeline. */
export function createHtmlTransformFeatures() {
  return { first: firstHtmlFeature(), second: secondHtmlFeature() };
}
