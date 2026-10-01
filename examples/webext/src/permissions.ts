const permissions = { origins: ['http://localhost/*'] };

/** Permission requests stay in the user gesture that owns the native browser prompt. */
export function mountPermissionControls(): () => void {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const status = document.querySelector<HTMLOutputElement>('#permission-status')!;
  const result = document.querySelector<HTMLOutputElement>('#permission-result')!;

  async function refresh(): Promise<void> {
    const granted = await chrome.permissions.contains(permissions);
    if (!signal.aborted) status.textContent = granted ? 'Granted' : 'Not granted';
  }

  async function show(
    operation: Promise<boolean>,
    approved: string,
    denied: string,
  ): Promise<void> {
    try {
      const success = await operation;
      if (!signal.aborted) result.textContent = success ? approved : denied;
      await refresh();
    } catch (error) {
      if (!signal.aborted)
        result.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  function changed(): void {
    void refresh().catch((error: unknown) => {
      if (!signal.aborted)
        result.textContent = error instanceof Error ? error.message : String(error);
    });
  }

  function request(): void {
    void show(chrome.permissions.request(permissions), 'Access granted', 'Access denied');
  }
  function remove(): void {
    void show(chrome.permissions.remove(permissions), 'Access removed', 'Access not removed');
  }
  document.querySelector('#permission-request')!.addEventListener('click', request, { signal });
  document.querySelector('#permission-remove')!.addEventListener('click', remove, { signal });
  chrome.permissions.onAdded.addListener(changed);
  chrome.permissions.onRemoved.addListener(changed);
  changed();
  return () => {
    lifetime.abort();
    chrome.permissions.onAdded.removeListener(changed);
    chrome.permissions.onRemoved.removeListener(changed);
  };
}
