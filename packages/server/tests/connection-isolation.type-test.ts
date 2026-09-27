import type {
  DevframeConnection,
  DevframeConnectionDiscoveryOptions,
  DevframeRpcClientOptions,
  SetupDevframeConnectionOptions,
} from 'devframe/client';

export const discovery: DevframeConnectionDiscoveryOptions = { isolated: true };
export const setup: SetupDevframeConnectionOptions = {
  baseURL: 'https://example.test/',
  connection: discovery,
};
export const sharedDiscovery: SetupDevframeConnectionOptions = { connection: {} };
export const prepared: DevframeConnection = {
  connectionMeta: { backend: 'static' },
  metaBaseUrl: 'https://example.test/__connection.json',
  isolated: true,
};
export const connection: DevframeRpcClientOptions = { connection: prepared };
export const invalidFlag: SetupDevframeConnectionOptions = {
  connection: {
    // @ts-expect-error Isolation is boolean, not an identifier.
    isolated: 'provider',
  },
};
export const invalidLegacyToggle: DevframeRpcClientOptions = {
  // @ts-expect-error Isolation belongs to the connection.
  isolateConnection: true,
};
export const invalidPartialMetadata: SetupDevframeConnectionOptions = {
  // @ts-expect-error A prepared connection requires its metadata URL.
  connection: { isolated: true, connectionMeta: { backend: 'static' } },
};
export const invalidPartialUrl: SetupDevframeConnectionOptions = {
  // @ts-expect-error A prepared connection requires transport metadata.
  connection: { isolated: true, metaBaseUrl: 'https://example.test/__connection.json' },
};
