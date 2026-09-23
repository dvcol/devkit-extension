import type { ServiceDeclaration } from '@devkit/core';
import type { Reservation } from './admission.js';

export function contractKey(
  kind: string,
  contract: { readonly id: string; readonly version: number },
): string {
  return JSON.stringify([kind, contract.id, contract.version]);
}

/** Include already waiting services so later installation cannot close a dependency cycle. */
export function assertAcyclic(
  owners: ReadonlyMap<string, Reservation>,
  rejectCycle: (key: string) => never,
): void {
  const services = new Map<string, ServiceDeclaration>();
  for (const owner of new Set(owners.values())) {
    for (const service of owner.services)
      services.set(contractKey('capability', service.capability), service);
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(key: string): void {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      rejectCycle(key);
    }
    const service = services.get(key);
    if (!service) return;
    visiting.add(key);
    for (const requirement of Object.values(service.requires))
      visit(contractKey('capability', requirement));
    visiting.delete(key);
    visited.add(key);
  }
  for (const key of services.keys()) visit(key);
}
