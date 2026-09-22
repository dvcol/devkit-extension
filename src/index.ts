// @ts-expect-error chrome issue
import type { chrome } from 'chrome';

import type { DefineComponent, WebComponents } from '~/web/define-component';

export const baseUrl = 'web-extension-template';

interface WebExtensionTemplate {
  WebComponents: WebComponents;
  defineComponent: DefineComponent;
  default: DefineComponent;
}

declare global {
  interface Window {
    chrome: typeof chrome;
  }
}

export type { DefineComponent, WebComponents, WebExtensionTemplate };
