/** Packaged recipe; the same synchronous code runs at the selected native stage and world. */
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
