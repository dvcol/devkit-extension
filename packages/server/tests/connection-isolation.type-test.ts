import type { DevframeRpcClientOptions, SetupDevframeConnectionOptions } from 'devframe/client';

export const setup: SetupDevframeConnectionOptions = {
  isolateConnection: true,
};
export const connection: DevframeRpcClientOptions = {
  isolateConnection: true,
  connection: {
    connectionMeta: { backend: 'static' },
    metaBaseUrl: 'https://example.test/__connection.json',
  },
};
export const invalidSetup: SetupDevframeConnectionOptions = {
  // @ts-expect-error The isolation option is boolean, not an identifier.
  isolateConnection: 'provider',
};
export const invalidConnection: DevframeRpcClientOptions = {
  // @ts-expect-error Complete RPC options inherit the boolean constraint.
  isolateConnection: 1,
};
