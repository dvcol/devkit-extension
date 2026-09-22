import type { Component } from 'vue';

export enum WebComponents {
  WebExtensionTemplate = 'wc-web-extension-template',
}

export interface DefineOption {
  baseName?: string;
  baseUrl?: string;
  view?: { option?: boolean; popup?: boolean; panel?: boolean; web?: boolean };
}
export type DefineComponent = (options?: DefineOption, component?: WebComponents) => Promise<CustomElementConstructor>;

export async function defineComponent(options: DefineOption = {}, component: WebComponents = WebComponents.WebExtensionTemplate) {
  if (customElements.get(component)) {
    console.warn(`Custom element '${component}' is already defined.`);
  } else {
    const [{ createElementInstance }, { lazyComponent }] = await Promise.all([import('~/web/create-wc'), import('~/utils/lazy.utils')]);
    const ContainerComponent = lazyComponent(async () => import('~/components/container/ContainerComponent.ce.vue') as Promise<Component>);
    const WebComponent = createElementInstance(ContainerComponent, { name: component, ...options });
    customElements.define(component, WebComponent);
  }
  return customElements.whenDefined(component);
}

export default defineComponent;
