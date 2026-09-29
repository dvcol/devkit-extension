import type { ProviderConnection } from '@dvcol/cdb-extension';

export type BrokerState = Awaited<ReturnType<ProviderConnection['snapshot']>>;

export interface RecoveryFixtureOptions {
  readonly restored?: boolean;
  readonly attachError?: unknown;
  readonly probeError?: Error;
  readonly detachError?: Error;
  readonly reattachError?: Error;
}

export const recoveredTarget = { tabId: 42, id: 'target', generation: 3, scopeId: 'publication' };
export const approvedScope = {
  id: 'approval',
  principalId: 'caller',
  principalLabel: 'Caller',
  level: 'debug',
  navigation: 'same-origin',
  createdAt: 1,
  expiresAt: null,
  state: 'pending',
  providerId: 'provider',
} as const;
export const brokerState: BrokerState = {
  revision: 1,
  providers: [],
  principals: [],
  requests: [],
  targets: [],
  grants: [],
  leases: [],
  scopes: [approvedScope],
};

export const attachmentConflict = new Error(
  'Another debugger is already attached to the tab with id: 42.',
);
