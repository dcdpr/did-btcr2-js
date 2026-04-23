export interface StoredEvent {
  /** Monotonic ID assigned at append time. Stable across the buffer's lifetime. */
  id: string;
  /** SSE event name. */
  event: string;
  /** SSE data payload (typically a JSON-stringified {@link SignedEnvelope}). */
  data: string;
}

/**
 * Fixed-capacity FIFO ring buffer of SSE events for a single actor's inbox.
 *
 * When a subscriber (re)connects with a `Last-Event-ID` header, the server
 * uses {@link since} to replay everything that arrived while the subscriber
 * was disconnected. Events older than the replay window (evicted from the
 * ring) are unrecoverable — callers should choose `capacity` based on
 * expected message rate × acceptable reconnect window.
 */
export class InboxBuffer {
  readonly #capacity: number;
  readonly #entries: StoredEvent[] = [];
  #nextId = 1;

  constructor(capacity = 100) {
    if(capacity < 1) throw new Error(`InboxBuffer capacity must be >= 1; got ${capacity}`);
    this.#capacity = capacity;
  }

  /** Append an event. Returns the stored record (including its assigned id). */
  append(event: string, data: string): StoredEvent {
    const stored: StoredEvent = { id: String(this.#nextId++), event, data };
    this.#entries.push(stored);
    if(this.#entries.length > this.#capacity) this.#entries.shift();
    return stored;
  }

  /**
   * Return stored events with id strictly greater than `lastEventId`. If
   * `lastEventId` is unset or unparseable, returns everything currently
   * retained.
   */
  since(lastEventId?: string): StoredEvent[] {
    if(!lastEventId) return this.#entries.slice();
    const boundary = Number(lastEventId);
    if(!Number.isFinite(boundary)) return this.#entries.slice();
    return this.#entries.filter((e) => Number(e.id) > boundary);
  }

  /** Currently retained event count. */
  size(): number {
    return this.#entries.length;
  }
}
