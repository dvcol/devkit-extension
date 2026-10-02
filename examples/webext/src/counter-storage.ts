import type { createJsonRenderView } from '@devframes/json-render/view';
import type { SharedState } from 'devframe/utils/shared-state';

declare global {
  interface ImportMetaEnv {
    readonly VITE_COUNTER_STORAGE_KEY?: string;
  }
}

type CounterView = ReturnType<typeof createJsonRenderView>;

/** One background owns this key; UI state and provider identity remain ephemeral. */
export async function connectCounterStorage(options: {
  key: string | undefined;
  counter: SharedState<{ value: number }>;
  management: CounterView;
}): Promise<(() => void) | undefined> {
  const { key, counter, management } = options;
  if (key === undefined || key === '') return undefined;
  const stored = await chrome.storage.local.get<Record<string, unknown>>(key);
  if (stored[key] !== undefined)
    counter.mutate((snapshot) => {
      snapshot.value = readCounter(stored[key]);
    });
  let previousValue = counter.value().value;
  management.patchState([{ op: 'replace', path: '/storage', value: 'Ready' }]);
  return counter.on('updated', (snapshot) => {
    const { value } = snapshot;
    if (value === previousValue) return;
    previousValue = value;
    void saveCounter({ key, value, management });
  });
}

function readCounter(record: unknown): number {
  if (
    typeof record !== 'object' ||
    record === null ||
    !('value' in record) ||
    Object.keys(record).length !== 1 ||
    typeof record.value !== 'number' ||
    !Number.isSafeInteger(record.value)
  )
    throw new TypeError('Stored counter must contain only an integer value');
  return record.value;
}

async function saveCounter(options: {
  key: string;
  value: unknown;
  management: CounterView;
}): Promise<void> {
  const { key, value, management } = options;
  management.patchState([
    { op: 'replace', path: '/storage', value: `Writing counter ${String(value)}` },
  ]);
  try {
    await chrome.storage.local.set({ [key]: { value: readCounter({ value }) } });
    management.patchState([
      { op: 'replace', path: '/storage', value: `Wrote counter ${String(value)}` },
    ]);
  } catch (error) {
    console.error('Counter storage write failed', error);
    const message = error instanceof Error ? error.message : String(error);
    management.patchState([
      {
        op: 'replace',
        path: '/storage',
        value: `Write failed for counter ${String(value)}: ${message}`,
      },
    ]);
  }
}
