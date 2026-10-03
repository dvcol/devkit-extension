import type { DevframeJsonRenderSpec } from '@devframes/json-render';
import { resolveElementProps } from '@json-render/core';
import type { ActionBinding, StateModel } from '@json-render/core';
import type { Immutable } from 'devframe/utils/shared-state';

export type ReadableSpec = DevframeJsonRenderSpec | Immutable<DevframeJsonRenderSpec>;

interface RenderContext {
  spec: ReadableSpec;
  stateModel: StateModel;
  signal: AbortSignal;
  invoke: (binding: ActionBinding) => Promise<void>;
}

/** Small DOM catalog for this example, using the upstream JSON model and expression resolver. */
export function renderElement(
  identifier: string,
  context: RenderContext,
  ancestors: ReadonlySet<string> = new Set(),
): HTMLElement {
  if (ancestors.has(identifier)) throw new Error(`Circular element: ${identifier}`);
  const element = context.spec.elements[identifier];
  if (element === undefined) throw new Error(`Missing element: ${identifier}`);
  if (element.repeat !== undefined || element.visible !== undefined || element.watch !== undefined)
    throw new Error('The example DOM renderer does not implement repeat, visibility or watch');
  const properties = resolveElementProps(element.props, { stateModel: context.stateModel });
  const node = component(element.type, properties);
  if (element.type === 'Button') bindPress(node, element.on?.['press'], context);
  const path = new Set([...ancestors, identifier]);
  for (const child of element.children ?? []) node.append(renderElement(child, context, path));
  return node;
}

/** These actions belong to the native renderer's local providers, which this catalog omits. */
const localActions = new Set([
  'setState',
  'pushState',
  'removeState',
  'validateForm',
  'push',
  'pop',
]);

function bindPress(
  node: HTMLElement,
  binding: ActionBinding | ActionBinding[] | Immutable<ActionBinding | ActionBinding[]> | undefined,
  context: RenderContext,
): void {
  if (binding === undefined) return;
  if (!('action' in binding) || binding.confirm)
    throw new Error('The example DOM renderer supports one RPC press action without confirmation');
  if (
    (binding.onSuccess !== undefined && !('set' in binding.onSuccess)) ||
    (binding.onError !== undefined && !('set' in binding.onError))
  )
    throw new Error('The example DOM renderer supports only state-setting action callbacks');
  if (localActions.has(binding.action))
    throw new Error(`Unsupported local action: ${binding.action}`);
  node.addEventListener(
    'click',
    () => {
      void context.invoke(binding);
    },
    { signal: context.signal },
  );
}

function text(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  throw new Error('The example DOM renderer expects a string or number for text');
}

function component(type: string, properties: Record<string, unknown>): HTMLElement {
  if (type === 'Card') {
    const node = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = text(properties['title']);
    node.append(heading);
    return node;
  }
  if (type === 'Stack') {
    const node = document.createElement('div');
    node.style.display = 'flex';
    node.style.flexDirection = properties['direction'] === 'row' ? 'row' : 'column';
    node.style.gap = `${Number(properties['gap'] ?? 1) * 0.25}rem`;
    return node;
  }
  if (type === 'Text') {
    const node = document.createElement('p');
    node.textContent = text(properties['text']);
    return node;
  }
  if (type === 'Button') {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = text(properties['label']);
    node.disabled = Boolean(properties['disabled']);
    return node;
  }
  throw new Error(`Unsupported component in the example DOM renderer: ${type}`);
}
