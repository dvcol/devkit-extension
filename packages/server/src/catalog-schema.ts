import type { CatalogContract, ProviderCatalogSnapshot } from '@devkit/core';
import { z } from 'zod';

const identifier = z.string().refine((value) => value.trim().length > 0);
const descriptor = z.strictObject({ id: identifier }).readonly();
const contract = {
  id: identifier,
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  contributionId: identifier,
  execution: descriptor,
  status: z.enum([
    'waiting',
    'starting',
    'active',
    'stopping',
    'disabled',
    'failed',
    'cleanup-blocked',
    'disposed',
  ]),
  reason: z
    .enum([
      'unsupported',
      'wrong-execution',
      'missing-permission',
      'target-unavailable',
      'restricted-target',
      'stale-target',
      'disconnected',
      'incompatible-contract',
      'dependency-unavailable',
    ])
    .optional(),
};
const target = z.enum(['none', 'required']);

/** Shared native return schema. Never accepts executable schemas, contexts or arbitrary metadata. */
export const catalogSchema = z
  .strictObject({
    provider: z
      .strictObject({ id: identifier, incarnation: identifier, realm: descriptor })
      .readonly(),
    status: z.enum(['open', 'disposing', 'cleanup-blocked', 'disposed']),
    capabilities: z
      .array(
        z.strictObject({
          ...contract,
          operations: z.array(z.strictObject({ name: identifier, target }).readonly()).readonly(),
        }),
      )
      .readonly(),
    actions: z.array(z.strictObject({ ...contract, target })).readonly(),
  })
  .optional();

function captureContract<
  Contract extends Omit<CatalogContract, 'reason'> & {
    readonly reason?: CatalogContract['reason'];
  },
>(value: Contract) {
  const { reason, ...metadata } = value;
  return Object.freeze({ ...metadata, ...(reason === undefined ? {} : { reason }) });
}

/** Validate and own received metadata before exposing it to routing or observers. */
export function captureCatalog(value: unknown): ProviderCatalogSnapshot | undefined {
  const catalog = catalogSchema.parse(value);
  if (catalog === undefined) return undefined;
  const capabilities = catalog.capabilities.map((capability) => captureContract(capability));
  const actions = catalog.actions.map((action) => captureContract(action));
  return Object.freeze({
    provider: catalog.provider,
    status: catalog.status,
    capabilities: Object.freeze(capabilities),
    actions: Object.freeze(actions),
  });
}
