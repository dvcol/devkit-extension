import type {
  CatalogAction,
  CatalogCapability,
  CatalogContract,
  ProviderCatalog,
  ProviderCatalogSnapshot,
} from '@devkit/core';

import { allContributions } from './provider-bindings.js';
import type { BindingEnvironment } from './provider-bindings.js';
import { providerDiagnostic, reportDiagnostic } from './provider-status.js';
import { actionDeclaration, serviceDeclaration } from './provider-types.js';
import type { OwnedContribution } from './provider-types.js';

function contractMetadata(
  contribution: OwnedContribution,
): Omit<CatalogContract, 'id' | 'version'> {
  return {
    contributionId: contribution.definition.id,
    execution: contribution.definition.execution,
    status: contribution.status,
    ...(contribution.reason === undefined ? {} : { reason: contribution.reason }),
  };
}

/** Projects the existing lifecycle; it owns listeners, not registrations or activation state. */
export class ProviderCatalogController implements ProviderCatalog {
  private readonly listeners = new Set<(snapshot: ProviderCatalogSnapshot) => void>();
  status: ProviderCatalogSnapshot['status'] = 'open';
  readonly api = Object.freeze<ProviderCatalog>({
    snapshot: () => this.snapshot(),
    subscribe: (listener) => this.subscribe(listener),
  });

  constructor(private readonly environment: BindingEnvironment) {}

  snapshot(): ProviderCatalogSnapshot {
    const capabilities: CatalogCapability[] = [];
    const actions: CatalogAction[] = [];
    for (const contribution of allContributions(this.environment)) {
      const service = serviceDeclaration(contribution.definition);
      if (service !== undefined) {
        capabilities.push(
          Object.freeze({
            ...contractMetadata(contribution),
            id: service.capability.id,
            version: service.capability.version,
            operations: Object.freeze(
              Object.entries(service.capability.operations).map(([name, operation]) =>
                Object.freeze({ name, target: operation.target }),
              ),
            ),
          }),
        );
        continue;
      }
      const action = actionDeclaration(contribution.definition);
      if (action === undefined) continue;
      actions.push(
        Object.freeze({
          ...contractMetadata(contribution),
          id: action.contract.id,
          version: action.contract.version,
          target: action.contract.operation.target,
        }),
      );
    }
    return Object.freeze({
      provider: this.environment.options.provider,
      status: this.status,
      capabilities: Object.freeze(capabilities),
      actions: Object.freeze(actions),
    });
  }

  subscribe(listener: (snapshot: ProviderCatalogSnapshot) => void): () => void {
    if (this.status !== 'disposed') this.listeners.add(listener);
    this.notifyListener(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListener(listener: (snapshot: ProviderCatalogSnapshot) => void): void {
    try {
      listener(this.snapshot());
    } catch (cause) {
      reportDiagnostic(
        this.environment.options,
        providerDiagnostic(
          this.environment.options,
          'listener-failed',
          'A provider catalog listener threw',
          'call',
        ),
        undefined,
        cause,
      );
    }
  }

  readonly notify = (): void => {
    const listeners = [...this.listeners];
    for (const listener of listeners) {
      if (this.listeners.has(listener)) this.notifyListener(listener);
    }
    if (this.status === 'disposed') this.listeners.clear();
  };

  setStatus(status: ProviderCatalogSnapshot['status']): void {
    this.status = status;
    this.notify();
  }
}
