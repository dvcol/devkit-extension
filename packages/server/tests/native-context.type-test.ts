import type { DevframeNodeContext } from 'devframe';
import type { DevframeHubContext } from '@devframes/hub/node';
import type { KitNodeContext } from '@vitejs/devtools-kit/node';
import type { NativeContextAccess } from '@devkit/core';
import { devframeContext, devframeHubContext, devToolsContext } from '../src/index.js';

export function nativeContextTypes(native: NativeContextAccess): void {
  native.get(devframeContext) satisfies DevframeNodeContext | undefined;
  native.get(devframeHubContext) satisfies DevframeHubContext | undefined;
  native.get(devToolsContext) satisfies KitNodeContext | undefined;
  // @ts-expect-error A native descriptor retains its actual context type.
  native.get(devframeContext) satisfies string | undefined;
  // @ts-expect-error The base Devframe context does not supply Hub-only APIs.
  native.get(devframeContext) satisfies DevframeHubContext | undefined;
  // @ts-expect-error Hub context does not supply the DevTools-specific context APIs.
  native.get(devframeHubContext) satisfies KitNodeContext | undefined;
}
