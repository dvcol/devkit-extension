import { randomUUID } from 'node:crypto';
import {
  closeSync,
  cpSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export interface ProductionStatus {
  readonly phase: 'starting' | 'building' | 'ready' | 'failed' | 'stopped';
  readonly attempt: number;
  readonly generation: string | null;
  readonly error: string | null;
}

const phases = new Set(['starting', 'building', 'ready', 'failed', 'stopped']);

function isStatus(value: unknown): value is ProductionStatus {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'phase' in value &&
    typeof value.phase === 'string' &&
    phases.has(value.phase) &&
    'attempt' in value &&
    Number.isSafeInteger(value.attempt) &&
    Number(value.attempt) >= 0 &&
    'generation' in value &&
    (value.generation === null ||
      (typeof value.generation === 'string' && /^generation-[a-f\d-]+$/u.test(value.generation))) &&
    'error' in value &&
    (value.error === null || typeof value.error === 'string')
  );
}

export function productionPaths(directory: string) {
  return {
    staging: join(directory, 'staging'),
    published: join(directory, 'published'),
    status: join(directory, 'status.json'),
    lock: join(directory, 'publisher.lock'),
  };
}

export function readProductionStatus(directory: string): ProductionStatus {
  try {
    const value: unknown = JSON.parse(readFileSync(productionPaths(directory).status, 'utf8'));
    if (!isStatus(value)) throw new Error('Invalid production build status');
    return value;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return { phase: 'starting', attempt: 0, generation: null, error: null };
    throw error;
  }
}

/** One local build watcher publishes immutable output after Vite reports a successful bundle. */
export class ProductionPublication {
  private status: ProductionStatus;
  private readonly paths: ReturnType<typeof productionPaths>;
  private closed = false;
  private readonly onExit = () => {
    this.close();
  };

  constructor(directory: string) {
    this.paths = productionPaths(directory);
    mkdirSync(this.paths.published, { recursive: true });
    const lock = openSync(this.paths.lock, 'wx');
    closeSync(lock);
    try {
      this.status = readProductionStatus(directory);
    } catch (error) {
      rmSync(this.paths.lock, { force: true });
      throw error;
    }
    /** Process exit cannot await the watcher, but must release this process's publication lock. */
    process.once('exit', this.onExit);
  }

  private publish(status: ProductionStatus): void {
    const temporary = `${this.paths.status}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(status));
      renameSync(temporary, this.paths.status);
      this.status = status;
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  start(): void {
    this.publish({
      ...this.status,
      phase: 'building',
      attempt: this.status.attempt + 1,
      error: null,
    });
  }

  complete(): void {
    const generation = `generation-${randomUUID()}`;
    const temporary = join(this.paths.published, `.${generation}`);
    try {
      cpSync(this.paths.staging, temporary, { recursive: true });
      renameSync(temporary, join(this.paths.published, generation));
      this.publish({ ...this.status, phase: 'ready', generation, error: null });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  fail(error: string): void {
    this.publish({ ...this.status, phase: 'failed', error });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    process.off('exit', this.onExit);
    try {
      this.publish({ ...this.status, phase: 'stopped' });
    } finally {
      rmSync(this.paths.lock, { force: true });
    }
  }
}
