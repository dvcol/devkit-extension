/** Both native build modes package this synchronous document-start marker. */
export function recordInspectorMarker(): void {
  Reflect.set(globalThis, 'responseInspectorMarker', document.readyState);
}
