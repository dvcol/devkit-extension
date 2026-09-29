import type { DevframeHubContext } from '@devframes/hub/node';
import type { KitNodeContext } from '@vitejs/devtools-kit/node';
import type { RpcProviderComposition } from '@devkit/devframe';
export type {
  RpcProviderComposition as ServerComposition,
  RpcProviderExposure as ServerExposure,
  RpcProviderHandle as ServerProviderHandle,
} from '@devkit/devframe';

export interface DevframeProviderOptions<
  Strict extends boolean = true,
> extends RpcProviderComposition<Strict> {
  readonly context: DevframeHubContext;
}
export interface DevToolsProviderOptions<
  Strict extends boolean = true,
> extends RpcProviderComposition<Strict> {
  readonly context: KitNodeContext;
}
