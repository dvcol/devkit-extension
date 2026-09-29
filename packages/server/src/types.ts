import type { DevframeHubContext } from '@devframes/hub/node';
import type { KitNodeContext } from '@vitejs/devtools-kit/node';
import type {
  RpcProviderComposition,
  RpcProviderExposure,
  RpcProviderHandle,
} from '@devkit/devframe';

export interface ServerComposition<
  Strict extends boolean = true,
> extends RpcProviderComposition<Strict> {}
export interface ServerExposure extends RpcProviderExposure {}
export interface ServerProviderHandle<
  Strict extends boolean = true,
> extends RpcProviderHandle<Strict> {}

export interface DevframeProviderOptions<
  Strict extends boolean = true,
> extends ServerComposition<Strict> {
  readonly context: DevframeHubContext;
}
export interface DevToolsProviderOptions<
  Strict extends boolean = true,
> extends ServerComposition<Strict> {
  readonly context: KitNodeContext;
}
