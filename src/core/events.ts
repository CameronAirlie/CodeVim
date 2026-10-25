import { Disposable, toDisposable } from './disposable';

export type Listener<T> = (value: T) => void;
export type Event<T> = (listener: Listener<T>) => Disposable;

/** Minimal event emitter, independent of the vscode module so core code stays testable. */
export class Emitter<T> implements Disposable {
  private listeners = new Set<Listener<T>>();

  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return toDisposable(() => this.listeners.delete(listener));
  };

  fire(value: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch (err) {
        console.error('[codevim] listener failed', err);
      }
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

/** A typed publish/subscribe bus keyed by event name. */
export class EventBus<M extends object> implements Disposable {
  private emitters = new Map<keyof M, Emitter<unknown>>();

  on<K extends keyof M>(name: K, listener: Listener<M[K]>): Disposable {
    let emitter = this.emitters.get(name);
    if (!emitter) {
      emitter = new Emitter<unknown>();
      this.emitters.set(name, emitter);
    }
    return emitter.event(listener as Listener<unknown>);
  }

  emit<K extends keyof M>(name: K, value: M[K]): void {
    this.emitters.get(name)?.fire(value);
  }

  dispose(): void {
    for (const emitter of this.emitters.values()) {
      emitter.dispose();
    }
    this.emitters.clear();
  }
}
