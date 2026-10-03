import type { JsonRenderRpcContext } from '@devframes/json-render/hub';
import { createStateStore, diffToPatches, executeAction, resolveAction } from '@json-render/core';
import type { ActionBinding } from '@json-render/core';
import { renderElement } from './components.js';
import type { ReadableSpec } from './components.js';

/** DOM and listeners belong to this mount; shared state and RPC belong to the native client. */
export class DomView {
  readonly root = document.createElement('section');
  private readonly content = document.createElement('div');
  private readonly error = document.createElement('p');
  private readonly state = createStateStore();
  private events = new AbortController();
  private disposed = false;
  private pending = false;
  private spec: ReadableSpec | undefined;
  private readonly rpc: JsonRenderRpcContext['rpc'];

  constructor(rpc: JsonRenderRpcContext['rpc']) {
    this.rpc = rpc;
    this.root.dataset['renderer'] = 'custom';
    const style = document.createElement('style');
    style.textContent = '[data-renderer="custom"] { padding: 1rem; font-family: monospace; }';
    this.error.setAttribute('role', 'alert');
    this.root.append(style, this.content, this.error);
  }

  render(spec: ReadableSpec): void {
    /** Remote projection changes leave unchanged mount-local callback values intact. */
    this.state.update(
      Object.fromEntries(
        diffToPatches(this.spec?.state ?? {}, spec.state ?? {}).map((patch) => [
          patch.path,
          patch.op === 'remove' ? undefined : patch.value,
        ]),
      ),
    );
    this.spec = spec;
    this.events.abort();
    this.events = new AbortController();
    this.content.replaceChildren();
    this.content.append(
      renderElement(spec.root, {
        spec,
        stateModel: this.state.getSnapshot(),
        signal: this.events.signal,
        invoke: (binding) => this.invoke(binding),
      }),
    );
    if (this.pending)
      for (const button of this.content.querySelectorAll('button')) button.disabled = true;
  }

  update(spec: ReadableSpec): void {
    try {
      this.render(spec);
    } catch (cause) {
      this.error.textContent = String(cause);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.events.abort();
    this.root.remove();
  }

  private async invoke(binding: ActionBinding): Promise<void> {
    if (this.disposed || this.pending || this.spec === undefined) return;
    this.pending = true;
    this.error.textContent = '';
    this.update(this.spec);
    try {
      const action = resolveAction(binding, this.state.getSnapshot());
      await executeAction({
        action,
        handler: (params) => this.call(action.action, params),
        setState: this.state.set,
      });
    } catch (cause) {
      if (!this.disposed) this.error.textContent = String(cause);
    } finally {
      this.pending = false;
      if (!this.disposed) this.update(this.spec);
    }
  }

  private async call(action: string, params: Record<string, unknown>): Promise<unknown> {
    try {
      /** Dynamic JSON method names use the native call unchanged; the backend validates input. */
      return await Reflect.apply(this.rpc.call, this.rpc, [action, params]);
    } catch (cause) {
      /** The RPC failure stays visible even when a native onError callback handles it. */
      if (!this.disposed) this.error.textContent = String(cause);
      throw cause;
    }
  }
}
