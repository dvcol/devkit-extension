import type {
  DevframeRpcClientOptions,
  SetupDevframeConnectionOptions,
} from './devframe/dist/client/index.mjs';

export const isolatedSetup = {
  isolateConnection: true,
  baseURL: 'http://provider.example/',
} satisfies SetupDevframeConnectionOptions;

export const isolatedClient = {
  ...isolatedSetup,
  otpParam: false,
  simpleAuth: false,
  webmcp: false,
} satisfies DevframeRpcClientOptions;

export const invalidSetup: SetupDevframeConnectionOptions = {
  // @ts-expect-error The experimental option accepts only a boolean.
  isolateConnection: 'local',
};

export const invalidClient: DevframeRpcClientOptions = {
  // @ts-expect-error Client options inherit the same boolean constraint.
  isolateConnection: 'global',
};
