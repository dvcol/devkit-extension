import type {
  ActionDescriptor,
  ActionDefinition,
  CapabilityDescriptor,
  CapabilityRequirements,
  ExecutionDescriptor,
  ServiceDefinition,
  SetupContext,
  CapabilityImplementation,
  Awaitable,
} from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/packages/core/dist/index.js';
import {
  counterCapability,
  increaseCounterAction,
} from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/contribution/dist/index.js';

declare const execution: ExecutionDescriptor;
declare function defineActionContribution<
  Action extends ActionDescriptor,
  const Requirements extends CapabilityRequirements = Record<never, never>,
>(definition: {
  readonly contract: Action;
  readonly id: string;
  readonly execution: ExecutionDescriptor;
  readonly requires?: Requirements;
  handler: ActionDefinition<NoInfer<Action>, NoInfer<Requirements>>['handler'];
}): ActionDefinition<Action, Requirements>;

declare function defineService<
  Capability extends CapabilityDescriptor,
  const Requirements extends CapabilityRequirements = Record<never, never>,
>(definition: {
  readonly capability: Capability;
  readonly id: string;
  readonly execution: ExecutionDescriptor;
  readonly requires?: Requirements;
  setup(context: SetupContext<NoInfer<Requirements>>): Awaitable<CapabilityImplementation<NoInfer<Capability>>>;
}): ServiceDefinition<Capability, Requirements>;

export const action = defineActionContribution({
  contract: increaseCounterAction,
  id: 'example.increment',
  execution,
  requires: { counter: counterCapability },
  handler({ input, services }) {
    const amount: number = input.amount;
    // @ts-expect-error Action input does not acquire unknown properties.
    input.missing;
    // @ts-expect-error Dependencies remain explicitly declared.
    services.missing;
    // @ts-expect-error Operation input remains numeric.
    services.counter.api.increase({ amount: 'wrong' });
    return services.counter.api.increase({ amount });
  },
});
export const service = defineService({
  capability: counterCapability,
  id: 'example.counter',
  execution,
  setup() {
    let value = 0;
    return {
      read() { return value; },
      increase(input) {
        // @ts-expect-error Contextual operation input remains numeric.
        const wrong: string = input.amount;
        value += input.amount;
        return value;
      },
    };
  },
});
