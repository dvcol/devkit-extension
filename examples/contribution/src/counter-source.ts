/** Local example resource; persistence and shared-state recovery are separate SDK contracts. */
export class MemoryCounter {
  private value = 0;
  private readonly listeners = new Set<(value: number) => void>();

  get subscriptionCount(): number {
    return this.listeners.size;
  }

  read(): number {
    return this.value;
  }

  increase(amount: number): number {
    this.value += amount;
    for (const listener of this.listeners) listener(this.value);
    return this.value;
  }

  subscribe(listener: (value: number) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
