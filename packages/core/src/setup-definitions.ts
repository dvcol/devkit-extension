import { snapshotSetup } from './snapshots.js';
import type {
  Awaitable,
  CapabilityRequirements,
  ExecutionDescriptor,
  ScriptDeclaration,
  ScriptDefinition,
  SetupContext,
  TransformDeclaration,
  TransformDefinition,
  ViewDeclaration,
  ViewDefinition,
} from './types.js';
import {
  assertKeys,
  assertRecord,
  assertRequirements,
  assertScript,
  assertTransform,
  assertView,
} from './validation.js';

export function defineView<
  const Requirements extends CapabilityRequirements = Record<never, never>,
>(definition: {
  readonly id: string;
  readonly execution: ExecutionDescriptor;
  readonly requires?: Requirements;
  setup(context: SetupContext<NoInfer<Requirements>>): Awaitable<void>;
}): ViewDefinition<Requirements>;
export function defineView(
  definition: Omit<ViewDeclaration, 'kind' | 'requires'> & {
    readonly requires?: CapabilityRequirements;
  },
): ViewDeclaration {
  assertRecord(definition, 'view');
  assertKeys(definition, ['id', 'execution', 'requires', 'setup'], 'view');
  if (Object.hasOwn(definition, 'requires'))
    assertRequirements(definition.requires, 'view.requires');
  const view = { ...definition, kind: 'view' as const, requires: definition.requires ?? {} };
  assertView(view, 'view');
  return snapshotSetup(view);
}

export function defineScript<
  const Requirements extends CapabilityRequirements = Record<never, never>,
>(definition: {
  readonly id: string;
  readonly execution: ExecutionDescriptor;
  readonly requires?: Requirements;
  setup(context: SetupContext<NoInfer<Requirements>>): Awaitable<void>;
}): ScriptDefinition<Requirements>;
export function defineScript(
  definition: Omit<ScriptDeclaration, 'kind' | 'requires'> & {
    readonly requires?: CapabilityRequirements;
  },
): ScriptDeclaration {
  assertRecord(definition, 'script');
  assertKeys(definition, ['id', 'execution', 'requires', 'setup'], 'script');
  if (Object.hasOwn(definition, 'requires'))
    assertRequirements(definition.requires, 'script.requires');
  const script = { ...definition, kind: 'script' as const, requires: definition.requires ?? {} };
  assertScript(script, 'script');
  return snapshotSetup(script);
}

export function defineTransform<
  const Requirements extends CapabilityRequirements = Record<never, never>,
>(definition: {
  readonly id: string;
  readonly execution: ExecutionDescriptor;
  readonly requires?: Requirements;
  setup(context: SetupContext<NoInfer<Requirements>>): Awaitable<void>;
}): TransformDefinition<Requirements>;
export function defineTransform(
  definition: Omit<TransformDeclaration, 'kind' | 'requires'> & {
    readonly requires?: CapabilityRequirements;
  },
): TransformDeclaration {
  assertRecord(definition, 'transform');
  assertKeys(definition, ['id', 'execution', 'requires', 'setup'], 'transform');
  if (Object.hasOwn(definition, 'requires'))
    assertRequirements(definition.requires, 'transform.requires');
  const transform = {
    ...definition,
    kind: 'transform' as const,
    requires: definition.requires ?? {},
  };
  assertTransform(transform, 'transform');
  return snapshotSetup(transform);
}
