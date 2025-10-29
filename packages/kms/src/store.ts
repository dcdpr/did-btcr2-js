/**
 * Re-implmentation of a interface for a generic key-value store.
 */
export interface KeyValueStore<K, V> {
  /**
   * Clears the store, removing all key-value pairs.
   *
   * @returns {void} when the store has been cleared.
   */
  clear(): void;

  /**
   * Closes the store, freeing up any resources used. After calling this method, no other operations can be performed on the store.
   *
   * @returns {void} when the store has been closed.
   */
  close(): void;

  /**
   * Deletes a key-value pair from the store.
   *
   * @param {K} key - The key of the value to delete.
   * @returns {boolean | void} True if the element existed and has been removed, or false if the element does not exist.
   */
  delete(key: K): boolean | void;

  /**
   * Fetches a value from the store given its key.
   *
   * @param {K} key - The key of the value to retrieve.
   * @returns {V | undefined} The value associated with the key, or `undefined` if no value exists for that key.
   */
  get(key: K): V | undefined;

  /**
   * Sets the value for a key in the store.
   *
   * @param {K} key - The key under which to store the value.
   * @param {V} value - The value to be stored.
   * @returns {void} once the value has been set.
   */
  set(key: K, value: V): void;

  /**
   * Fetches the keys and values as a nested array.
   *
   * @returns {Array<[K, V]>} An array of key-value pair arrays in the store.
   */
  entries(): Array<[K, V]>;
}

/**
 * Re-implementation of a simple in-memory key-value store.
 *
 * The `MemoryStore` class is an implementation of
 * `KeyValueStore` that holds data in memory.
 *
 * It provides a basic key-value store that works synchronously and keeps all
 * data in memory. This can be used for testing, or for handling small amounts
 * of data with simple key-value semantics.
 *
 * Example usage:
 *
 * ```ts
 * const memoryStore = new MemoryStore<string, number>();
 * await memoryStore.set("key1", 1);
 * const value = await memoryStore.get("key1");
 * console.log(value); // 1
 * ```
 *
 * @public
 */
export class MemoryStore<K, V> implements KeyValueStore<K, V> {
  /**
   * A private field that contains the Map used as the key-value store.
   */
  private store: Map<K, V> = new Map();

  /**
   * Clears all entries in the key-value store.
   *
   * @returns {void} returns once the operation is complete.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * This operation is no-op for `MemoryStore`.
   */
  close(): void {
    /** no-op */
  }

  /**
   * Deletes an entry from the key-value store by its key.
   *
   * @param {K} id - The key of the entry to delete.
   * @returns {boolean} a boolean indicating whether the entry was successfully deleted.
   */
  delete(id: K): boolean {
    return this.store.delete(id);
  }

  /**
   * Retrieves the value of an entry by its key.
   *
   * @param {K} id - The key of the entry to retrieve.
   * @returns {V | undefined} the value of the entry, or `undefined` if the entry does not exist.
   */
  get(id: K): V | undefined {
    return this.store.get(id);
  }

  /**
   * Checks for the presence of an entry by key.
   *
   * @param {K} id - The key to check for the existence of.
   * @returns {boolean} a boolean indicating whether an element with the specified key exists or not.
   */
  has(id: K): boolean {
    return this.store.has(id);
  }

  /**
   * Retrieves all values in the key-value store.

   * @returns {Array<V>} an array of all values in the store.
   */
  list(): Array<V> {
    return Array.from(this.store.values());
  }

  /**
   * Retrieves all entries in the key-value store.
   *
   * @returns {Array<[K, V]>} an array of key-value pairs in the store.
   */
  entries(): Array<[K, V]> {
    return Array.from(this.store.entries());
  }

  /**
   * Sets the value of an entry in the key-value store.
   *
   * @param {K} id - The key of the entry to set.
   * @param {V} key - The new value for the entry.
   * @returns {void} once operation is complete.
   */
  set(id: K, key: V): void {
    this.store.set(id, key);
  }
}