/**
 * Tiny strongly-typed event emitter.
 *
 * Browser-compatible (no Node.js `events` module). Uses a generic event map
 * to give compile-time safety on event names and listener signatures.
 *
 * @example
 * type MyEvents = {
 *   'connected': [{ host: string }];
 *   'data': [Uint8Array];
 *   'error': [Error];
 * };
 *
 * class MyClient extends TypedEventEmitter<MyEvents> {
 *   doStuff() {
 *     this.emit('connected', { host: 'example.com' });  // ✓ typed
 *     this.emit('data', new Uint8Array([1, 2]));        // ✓ typed
 *   }
 * }
 *
 * const client = new MyClient();
 * client.on('connected', ({ host }) => console.log(host));  // ✓ typed
 */

export type EventMap = Record<string, ReadonlyArray<unknown>>;

export type Listener<Args extends ReadonlyArray<unknown>> = (...args: Args) => void;

export class TypedEventEmitter<Events extends EventMap> {
  #listeners: Map<keyof Events, Set<Listener<any>>> = new Map();

  /** Subscribe to an event. */
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
    let set = this.#listeners.get(event);
    if(!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener as Listener<any>);
    return this;
  }

  /** Subscribe to an event, automatically unsubscribing after the first call. */
  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
    const wrapped = ((...args: Events[K]) => {
      this.off(event, wrapped as Listener<Events[K]>);
      listener(...args);
    });
    return this.on(event, wrapped as Listener<Events[K]>);
  }

  /** Unsubscribe a specific listener. */
  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
    this.#listeners.get(event)?.delete(listener as Listener<any>);
    return this;
  }

  /** Emit an event to all subscribed listeners. */
  emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean {
    const set = this.#listeners.get(event);
    if(!set || set.size === 0) return false;
    for(const listener of set) {
      try {
        listener(...args);
      } catch(err) {
        // Listener errors must not break other listeners
        console.error(`Listener for event "${String(event)}" threw:`, err);
      }
    }
    return true;
  }

  /** Remove all listeners (optionally for a specific event). */
  removeAllListeners<K extends keyof Events>(event?: K): this {
    if(event === undefined) {
      this.#listeners.clear();
    } else {
      this.#listeners.delete(event);
    }
    return this;
  }

  /** Number of listeners for an event. */
  listenerCount<K extends keyof Events>(event: K): number {
    return this.#listeners.get(event)?.size ?? 0;
  }
}
