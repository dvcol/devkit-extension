import renderer from '@devframes/json-render-ui/renderer';
import { domRenderer } from '@devkit/example-json-render/renderer';

const control = document.querySelector<HTMLSelectElement>('#inspector-renderer')!;

/** Selection changes only the renderer; the panel owns the native view and action lifetime. */
export function selectedInspectorRenderer() {
  return control.value === 'custom' ? domRenderer : renderer;
}

export function mountInspectorRendererControl(options: {
  readonly signal: AbortSignal;
  readonly replace: () => Promise<void>;
  readonly reportFailure: (error: unknown) => void;
}): void {
  control.disabled = options.signal.aborted;
  options.signal.addEventListener(
    'abort',
    () => {
      control.disabled = true;
    },
    { once: true },
  );
  control.addEventListener(
    'change',
    () => {
      control.disabled = true;
      void options
        .replace()
        .catch(options.reportFailure)
        .finally(() => {
          control.disabled = options.signal.aborted;
        });
    },
    { signal: options.signal },
  );
}
