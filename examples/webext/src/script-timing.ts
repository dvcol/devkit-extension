/** Packaged document-start recipe; the same synchronous code runs in either native world. */
export function recordScriptTiming(): void {
  Reflect.set(globalThis, 'exampleScriptTiming', document.readyState);
  const injectedReadyState = document.readyState;
  document.addEventListener(
    'example-script-timing',
    () => {
      document.documentElement.dataset.injectedState = injectedReadyState;
    },
    { once: true },
  );
}
