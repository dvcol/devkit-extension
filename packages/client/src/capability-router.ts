import { defineCapability } from '@devkit/core';
import type {
  CapabilityClient,
  CapabilityDescriptor,
  CapabilityInvocationRequest,
  CapabilityResolution,
  CapabilityResolutionRequest,
  BroadcastInvocationOptions,
  BroadcastOutcome,
  OperationValue,
  RoutedInvocationOptions,
  RoutingPolicy,
} from '@devkit/core';
import { callMethod, callOptions, dispatched, pinnedBinding } from './dispatch.js';
import type { CapabilityCall, BroadcastCall, RoutedCall } from './calls.js';
import { RoutingError } from './errors.js';
import type { ConnectionEntry, ConnectionRegistry } from './registry.js';
import type { SelectionRequest } from './selection.js';
import { withSelection, assertNotCancelled } from './selection.js';
import { scopedRequest, assertBroadcast, broadcast, routingOrDefault } from './calls.js';
export class CapabilityRouter implements CapabilityClient {
  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly routing: RoutingPolicy | undefined,
  ) {}

  resolve<Capability extends CapabilityDescriptor>(
    request: CapabilityResolutionRequest<Capability> & RoutedCall,
  ): Promise<CapabilityResolution<Capability>>;
  async resolve(
    request: CapabilityResolutionRequest<CapabilityDescriptor> & RoutedCall,
  ): Promise<CapabilityResolution<CapabilityDescriptor>> {
    request = { ...request, capability: captureCapability(request.capability) };
    const scoped = {
      ...request,
      ...scopedRequest(this.registry, request, routingOrDefault(request.routing, this.routing)),
    };
    const selection: SelectionRequest = {
      ...scoped,
      kind: 'capability',
      id: request.capability.id,
      version: request.capability.version,
    };
    const result = await withSelection(this.registry, selection, (entry) =>
      dispatched(this.registry, entry, selection, async () => {
        const resolution = await entry.connection.resolve({
          capability: request.capability,
          ...callOptions(entry, scoped),
        });
        if (resolution.status !== 'available') return resolution;
        return {
          status: 'available' as const,
          binding: pinnedBinding(this.registry, entry, request.capability, resolution.binding),
        };
      }),
    );
    return result;
  }

  invoke<
    Capability extends CapabilityDescriptor,
    const OperationName extends keyof Capability['operations'],
  >(
    request: CapabilityInvocationRequest<Capability, OperationName, RoutedInvocationOptions>,
  ): Promise<OperationValue<Capability['operations'][OperationName]>>;
  async invoke(request: CapabilityCall): Promise<unknown> {
    request = { ...request, capability: captureCapability(request.capability) };
    const scoped = {
      ...request,
      ...scopedRequest(this.registry, request, routingOrDefault(request.routing, this.routing)),
    };
    const result = await withSelection(this.registry, this.selection(scoped), (entry) =>
      this.dispatch(entry, scoped),
    );
    return result;
  }

  broadcast<
    Capability extends CapabilityDescriptor,
    const OperationName extends keyof Capability['operations'],
  >(
    request: CapabilityInvocationRequest<Capability, OperationName, BroadcastInvocationOptions>,
  ): Promise<readonly BroadcastOutcome<OperationValue<Capability['operations'][OperationName]>>[]>;
  async broadcast(
    request: CapabilityCall & BroadcastCall,
  ): Promise<readonly BroadcastOutcome<unknown>[]> {
    assertBroadcast(request);
    request = { ...request, capability: captureCapability(request.capability) };
    const scoped = { ...request, ...scopedRequest(this.registry, request) };
    const result = await broadcast(
      this.registry,
      this.selection(scoped),
      request.selection,
      (entry) => this.dispatch(entry, scoped),
    );
    return result;
  }

  private selection(request: CapabilityCall): SelectionRequest {
    return {
      ...request,
      kind: 'capability',
      id: request.capability.id,
      version: request.capability.version,
    };
  }

  private dispatch(entry: ConnectionEntry, request: CapabilityCall): Promise<unknown> {
    return dispatched(this.registry, entry, this.selection(request), async () => {
      const options = callOptions(entry, request);
      const resolution = await entry.connection.resolve({
        capability: request.capability,
        ...options,
      });
      if (resolution.status !== 'available')
        throw new RoutingError({
          code: 'unavailable-provider',
          message: `Selected capability became ${resolution.reason} before dispatch`,
        });
      this.registry.assertCurrent(entry);
      assertNotCancelled(options.signal);
      const binding = pinnedBinding(this.registry, entry, request.capability, resolution.binding);
      return callMethod(binding, request.operation, request.input, options);
    });
  }
}

function captureCapability(capability: CapabilityDescriptor): CapabilityDescriptor {
  return defineCapability({
    id: capability.id,
    version: capability.version,
    operations: capability.operations,
  });
}
