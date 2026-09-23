import type { ActivationScope, Awaitable } from '@devkit/core';

import { createActivationScope } from './scope.js';

export type ActivationStatus =
  | 'idle'
  | 'starting'
  | 'active'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'cleanup-blocked';

/** Failure values belong to the owning execution and are not wire diagnostics. */
export interface ActivationSnapshot {
  readonly status: ActivationStatus;
  readonly setupFailure?: unknown;
  readonly cleanupFailure?: unknown;
}

export interface Activation<Value> {
  start(setup: (scope: ActivationScope) => Awaitable<Value>): Promise<Value>;
  run<Result>(work: (value: Value, signal: AbortSignal) => Awaitable<Result>): Promise<Result>;
  stop(): Promise<void>;
  snapshot(): ActivationSnapshot;
}

/** One generation owns setup, dispatched work, and exactly one terminal cleanup attempt. */
export function createActivation<Value>(): Activation<Value> {
  return new ActivationController<Value>();
}

class ActivationController<Value> implements Activation<Value> {
  private readonly activationScope = createActivationScope();
  private readonly pendingWork = new Set<Promise<unknown>>();
  private status: ActivationStatus = 'idle';
  private setupPromise: Promise<Value> | undefined;
  private stopPromise: Promise<void> | undefined;
  private activeValue: { readonly value: Value } | undefined;
  private setupFailure: { readonly error: unknown } | undefined;
  private cleanupFailure: { readonly error: unknown } | undefined;
  private failedSetup = false;

  start(setup: (scope: ActivationScope) => Awaitable<Value>): Promise<Value> {
    if (this.status !== 'idle') {
      return Promise.reject(new Error('Activation setup can only start once'));
    }

    this.status = 'starting';
    this.setupPromise = Promise.resolve().then(() => {
      this.activationScope.scope.signal.throwIfAborted();
      return setup(this.activationScope.scope);
    });
    return this.completeSetup(this.setupPromise);
  }

  run<Result>(work: (value: Value, signal: AbortSignal) => Awaitable<Result>): Promise<Result> {
    const activeValue = this.activeValue;
    if (this.status !== 'active' || activeValue === undefined) {
      return Promise.reject(new Error('Activation is not accepting work'));
    }

    const workPromise = Promise.resolve().then(() => {
      this.activationScope.scope.signal.throwIfAborted();
      return work(activeValue.value, this.activationScope.scope.signal);
    });
    this.pendingWork.add(workPromise);
    return this.completeWork(workPromise);
  }

  stop(): Promise<void> {
    if (this.stopPromise !== undefined) return this.stopPromise;

    this.status = 'stopping';
    /** Publish the attempt before synchronous abort listeners can reenter stop. */
    this.stopPromise = Promise.resolve().then(() => this.completeStop());
    this.activationScope.cancel();
    return this.stopPromise;
  }

  snapshot(): ActivationSnapshot {
    const failures: { setupFailure?: unknown; cleanupFailure?: unknown } = {};
    if (this.setupFailure !== undefined) failures.setupFailure = this.setupFailure.error;
    if (this.cleanupFailure !== undefined) failures.cleanupFailure = this.cleanupFailure.error;
    return Object.freeze({ status: this.status, ...failures });
  }

  private async completeSetup(setupPromise: Promise<Value>): Promise<Value> {
    let value: Value;
    try {
      value = await setupPromise;
    } catch (error) {
      this.setupFailure = { error };
      this.failedSetup = this.stopPromise === undefined;
      try {
        await this.stop();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Activation setup and cleanup failed', {
          cause: cleanupError,
        });
      }
      throw error;
    }

    this.activationScope.scope.signal.throwIfAborted();
    this.activeValue = { value };
    this.status = 'active';
    return value;
  }

  private async completeWork<Result>(workPromise: Promise<Result>): Promise<Result> {
    try {
      const result = await workPromise;
      this.activationScope.scope.signal.throwIfAborted();
      return result;
    } catch (error) {
      this.activationScope.scope.signal.throwIfAborted();
      throw error;
    } finally {
      this.pendingWork.delete(workPromise);
    }
  }

  private async completeStop(): Promise<void> {
    const pending: Promise<unknown>[] = [...this.pendingWork];
    if (this.setupPromise !== undefined) pending.push(this.setupPromise);
    await Promise.allSettled(pending);

    try {
      await this.activationScope.dispose();
    } catch (error) {
      this.cleanupFailure = { error };
      this.status = 'cleanup-blocked';
      throw error;
    }

    this.activeValue = undefined;
    this.status = this.failedSetup ? 'failed' : 'stopped';
  }
}
