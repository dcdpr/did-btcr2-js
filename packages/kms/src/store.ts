/**
 * Interface for a generic key-value store.
 */
export interface KeyValueStore<K, V> {
  /** Clear all entries. */
  clear(): void;

  /** Close the store, freeing resources. */
  close(): void;

  /** Delete an entry by key. Returns true if the entry existed. */
  delete(key: K): boolean | void;

  /** Get an entry by key. Returns undefined if not found. */
  get(key: K): V | undefined;

  /** Check if a key exists in the store. */
  has(key: K): boolean;

  /** Set a value for a key. */
  set(key: K, value: V): void;

  /** Get all entries as key-value tuples. */
  entries(): Array<[K, V]>;
}

/**
 * In-memory key-value store backed by a Map.
 */
export class MemoryStore<K, V> implements KeyValueStore<K, V> {
  #store: Map<K, V> = new Map();

  clear(): void {
    this.#store.clear();
  }

  close(): void {
    /** no-op */
  }

  delete(key: K): boolean {
    return this.#store.delete(key);
  }

  get(key: K): V | undefined {
    return this.#store.get(key);
  }

  has(key: K): boolean {
    return this.#store.has(key);
  }

  list(): Array<V> {
    return Array.from(this.#store.values());
  }

  entries(): Array<[K, V]> {
    return Array.from(this.#store.entries());
  }

  set(key: K, value: V): void {
    this.#store.set(key, value);
  }
}
