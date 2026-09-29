import type { DevframeRpcClient } from 'devframe/client';
import type { RpcFunctionsCollectorBase } from 'devframe/rpc';
import type { DevframeRpcClientFunctions } from 'devframe/types';

/** Native members shared by the authenticated server client and raw Port composition. */
export type ProviderRpcClient<Context = never> = Pick<DevframeRpcClient, 'call' | 'events'> & {
  readonly client: Pick<
    RpcFunctionsCollectorBase<DevframeRpcClientFunctions, Context>,
    'register' | 'definitions'
  >;
  readonly connectionError?: Error | null;
  readonly cacheManager?: Pick<DevframeRpcClient['cacheManager'], 'validate'>;
};
