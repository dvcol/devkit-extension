import { defineActionContract } from '@devkit/core';
import type {
  ActionClient,
  ActionDescriptor,
  ActionInvocationRequest,
  BroadcastInvocationOptions,
  BroadcastOutcome,
  OperationValue,
  RoutedInvocationOptions,
  RoutingPolicy,
} from '@devkit/core';
import { callOptions, dispatched } from './dispatch.js';
import type { ActionCall, BroadcastCall } from './calls.js';
import type { ConnectionEntry, ConnectionRegistry } from './registry.js';
import type { SelectionRequest } from './selection.js';
import { withSelection } from './selection.js';
import { scopedRequest, assertBroadcast, broadcast, routingOrDefault } from './calls.js';
export class ActionRouter implements ActionClient {
  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly routing: RoutingPolicy | undefined,
  ) {}

  invoke<Action extends ActionDescriptor>(
    request: ActionInvocationRequest<Action, RoutedInvocationOptions>,
  ): Promise<OperationValue<Action['operation']>>;
  async invoke(request: ActionCall): Promise<unknown> {
    request = { ...request, action: captureAction(request.action) };
    const scoped = {
      ...request,
      ...scopedRequest(
        this.registry,
        request,
        routingOrDefault(request.routing, routingOrDefault(request.action.routing, this.routing)),
      ),
    };
    const result = await withSelection(this.registry, this.selection(scoped), (entry) =>
      this.dispatch(entry, scoped),
    );
    return result;
  }

  broadcast<Action extends ActionDescriptor>(
    request: ActionInvocationRequest<Action, BroadcastInvocationOptions>,
  ): Promise<readonly BroadcastOutcome<OperationValue<Action['operation']>>[]>;
  async broadcast(
    request: ActionCall & BroadcastCall,
  ): Promise<readonly BroadcastOutcome<unknown>[]> {
    assertBroadcast(request);
    request = { ...request, action: captureAction(request.action) };
    const scoped = { ...request, ...scopedRequest(this.registry, request) };
    const result = await broadcast(
      this.registry,
      this.selection(scoped),
      request.selection,
      (entry) => this.dispatch(entry, scoped),
    );
    return result;
  }

  private selection(request: ActionCall): SelectionRequest {
    return { ...request, kind: 'action', id: request.action.id, version: request.action.version };
  }

  private dispatch(entry: ConnectionEntry, request: ActionCall): Promise<unknown> {
    return dispatched(this.registry, entry, this.selection(request), async () => {
      const result: unknown = await Reflect.apply(
        entry.connection.invoke.bind(entry.connection),
        entry.connection,
        [{ action: request.action, input: request.input, ...callOptions(entry, request) }],
      );
      return result;
    });
  }
}

function captureAction(action: ActionDescriptor): ActionDescriptor {
  return defineActionContract({
    id: action.id,
    version: action.version,
    operation: action.operation,
    ...(action.routing === undefined ? {} : { routing: action.routing }),
  });
}
