import { defineActionContract, defineCapability } from '@devkit/core';
import type {
  ActionDescriptor,
  ActionInvocationRequest,
  CapabilityDescriptor,
  CapabilityResolution,
  CapabilityResolutionRequest,
  CatalogCapability,
  InvocationOptions,
  OperationValue,
  TargetReference,
} from '@devkit/core';
import type { ProviderConnection } from '@devkit/client';
import { actionMethod, capabilityMethod } from '../rpc-contract.js';
import type { RemoteCatalog } from './catalog.js';
import { nativeCall, waitForNative } from './native-call.js';

type CallOptions = InvocationOptions & { readonly target?: TargetReference };

export class RemoteConnection implements ProviderConnection {
  readonly provider;
  readonly catalog;
  constructor(private readonly state: RemoteCatalog) {
    this.provider = state.provider;
    this.catalog = Object.freeze({
      snapshot: () => state.snapshot(),
      subscribe: state.subscribe.bind(state),
    });
  }

  invoke<Action extends ActionDescriptor>(
    request: ActionInvocationRequest<Action>,
  ): Promise<OperationValue<Action['operation']>>;
  async invoke(request: ActionInvocationRequest<ActionDescriptor>): Promise<unknown> {
    const action = defineActionContract({
      id: request.action.id,
      version: request.action.version,
      operation: request.action.operation,
    });
    const catalog = this.state.snapshot();
    this.signal(request).throwIfAborted();
    const contract = catalog?.actions.find(
      ({ id, version }) => id === action.id && version === action.version,
    );
    if (catalog?.status !== 'open' || contract?.status !== 'active')
      throw new Error('Exposed action is unavailable');
    if (action.operation.target !== 'none')
      throw new Error('Remote target authority is not implemented');
    const value = await this.call(
      actionMethod(this.provider.id, action.id, action.version),
      request.input,
      request,
    );
    return value;
  }

  resolve<Capability extends CapabilityDescriptor>(
    request: CapabilityResolutionRequest<Capability> & CallOptions,
  ): Promise<CapabilityResolution<Capability>>;
  resolve(
    request: CapabilityResolutionRequest<CapabilityDescriptor> & CallOptions,
  ): Promise<CapabilityResolution<CapabilityDescriptor>> {
    return new Promise((resolve) => {
      resolve(this.resolveBinding(request));
    });
  }

  private resolveBinding(
    request: CapabilityResolutionRequest<CapabilityDescriptor> & CallOptions,
  ): CapabilityResolution<CapabilityDescriptor> {
    this.signal(request).throwIfAborted();
    const capability = defineCapability({
      id: request.capability.id,
      version: request.capability.version,
      operations: request.capability.operations,
    });
    const catalog = this.state.snapshot();
    if (catalog?.status !== 'open') return { status: 'unavailable', reason: 'disconnected' };
    const contract = catalog.capabilities.find(
      ({ id, version }) => id === capability.id && version === capability.version,
    );
    if (contract === undefined)
      return {
        status: 'unavailable',
        reason: catalog.capabilities.some(({ id }) => id === capability.id)
          ? 'incompatible-contract'
          : 'unsupported',
      };
    if (contract.status !== 'active')
      return { status: 'unavailable', reason: contract.reason ?? 'dependency-unavailable' };
    return this.binding(capability, contract);
  }

  private binding(
    capability: CapabilityDescriptor,
    contract: CatalogCapability,
  ): CapabilityResolution<CapabilityDescriptor> {
    const api: Record<string, (input: unknown, options?: CallOptions) => Promise<unknown>> = {};
    for (const [name, operation] of Object.entries(capability.operations)) {
      if (
        operation.target !== 'none' ||
        !contract.operations.some((entry) => entry.name === name && entry.target === 'none')
      )
        return { status: 'unavailable', reason: 'unsupported' };
      Object.defineProperty(api, name, {
        enumerable: true,
        value: (input: unknown, options: CallOptions = {}) => {
          const latest = this.state.snapshot();
          const current = latest?.capabilities.find(
            ({ id, version }) => id === capability.id && version === capability.version,
          );
          if (latest?.status !== 'open' || current?.status !== 'active')
            return Promise.reject(new Error('Exposed capability is unavailable'));
          return this.call(capabilityMethod(this.provider.id, capability, name), input, options);
        },
      });
    }
    return {
      status: 'available',
      binding: Object.freeze({
        api: Object.freeze(api),
        context: Object.freeze({
          access: 'remote',
          provider: this.provider,
          execution: contract.execution,
        }),
      }),
    };
  }

  private signal(options: CallOptions): AbortSignal {
    if (options.target !== undefined)
      throw new TypeError('Target-free operations reject an execution target');
    if (options.signal === undefined) return this.state.signal;
    return AbortSignal.any([options.signal, this.state.signal]);
  }

  private async call(method: string, input: unknown, options: CallOptions): Promise<unknown> {
    const signal = this.signal(options);
    signal.throwIfAborted();
    const value = await waitForNative(
      nativeCall(this.state.options.rpc, method, [this.provider.incarnation, input]),
      signal,
    );
    signal.throwIfAborted();
    return value;
  }

  dispose(): void {
    this.state.dispose();
  }
}
