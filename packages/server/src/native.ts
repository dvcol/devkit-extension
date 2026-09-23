import { defineExecution, defineNativeContext, defineRealm } from '@devkit/core';
import type { NativeContextAccess, NativeContextDescriptor } from '@devkit/core';
import type { DevframeHubContext } from '@devframes/hub/node';
import type { KitNodeContext } from '@vitejs/devtools-kit/node';
import type { DevframeNodeContext } from 'devframe';

export const serverRealm = defineRealm({ id: 'devserver' });
export const serverExecution = defineExecution({ id: 'devkit.server' });

export const devframeContext = defineNativeContext<DevframeNodeContext>({
  id: 'devkit.server.devframe',
});
export const devframeHubContext = defineNativeContext<DevframeHubContext>({
  id: 'devkit.server.hub',
});
export const devToolsContext = defineNativeContext<KitNodeContext>({
  id: 'devkit.server.devtools',
});

/** Kit's public context extends the hub context, which extends the base Devframe context. */
export function nativeAccess(
  context: DevframeHubContext,
  kitContext?: KitNodeContext,
): NativeContextAccess {
  function get<Value>(descriptor: NativeContextDescriptor<Value>): Value | undefined;
  function get(descriptor: NativeContextDescriptor<unknown>): unknown {
    if (descriptor.id === devframeContext.id || descriptor.id === devframeHubContext.id)
      return context;
    if (descriptor.id === devToolsContext.id) return kitContext;
    return undefined;
  }
  return { get };
}
