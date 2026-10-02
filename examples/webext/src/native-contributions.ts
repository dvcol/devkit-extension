import type { ProviderRpc, RpcProviderHandle } from '@devkit/devframe';
import { registerScriptControls } from './script-contribution';
import { registerHeaderControls } from './header-contribution';
import { registerRedirectControls } from './redirect-contribution';
import { registerResponseControls } from './response-contribution';

/** Register the example's compiled native features on its existing admitted-page RPC boundary. */
export function registerNativeContributionControls(options: {
  readonly rpc: Pick<ProviderRpc<undefined>, 'register'>;
  readonly provider: Promise<RpcProviderHandle>;
}): void {
  registerScriptControls(options);
  registerHeaderControls(options);
  registerRedirectControls(options);
  registerResponseControls(options);
}
