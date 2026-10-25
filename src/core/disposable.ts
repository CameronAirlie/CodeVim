export interface Disposable {
  dispose(): void;
}

export function toDisposable(fn: () => void): Disposable {
  let done = false;
  return {
    dispose() {
      if (!done) {
        done = true;
        fn();
      }
    },
  };
}

/** Owns a set of disposables and disposes them together (in reverse order). */
export class DisposableStore implements Disposable {
  private items: Disposable[] = [];
  private disposed = false;

  add<T extends Disposable>(item: T): T {
    if (this.disposed) {
      item.dispose();
    } else {
      this.items.push(item);
    }
    return item;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const item of this.items.reverse()) {
      try {
        item.dispose();
      } catch {
        // Keep disposing the rest.
      }
    }
    this.items = [];
  }
}
