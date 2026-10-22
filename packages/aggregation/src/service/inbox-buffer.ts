import { bytesToHex, randomBytes } from '@noble/hashes/utils';

import { AggregationServiceError } from '../core/errors.js';

export interface StoredEvent<T = string> {
  /**
   * Event id, `<epoch>-<seq>`. The epoch is 16 lowercase hex characters, random
   * per buffer. The seq is a decimal integer that starts at 1 and increases by 1
   * at each append. The id does not change while the event is in the buffer.
   */
  id: string;
  /** SSE event name. */
  event: string;
  /** Event payload. The server transport keeps the signed envelope and its JSON form. */
  data: T;
}

/** Length of the random buffer epoch (bytes). */
const EPOCH_LEN_BYTES = 8;

/** `<epoch>-<seq>`: 16 lowercase hex characters, a hyphen, and a decimal seq with no leading zero. */
const EVENT_ID_PATTERN = /^([0-9a-f]{16})-([1-9][0-9]*)$/;

interface Entry<T> {
  seq: number;
  stored: StoredEvent<T>;
}

/**
 * Fixed-capacity FIFO ring buffer of SSE events for a single actor's inbox.
 *
 * When a subscriber (re)connects with a `Last-Event-ID` header, the server
 * uses {@link InboxBuffer.since} to replay the events that arrived while the
 * subscriber was disconnected. An event that the ring evicted is lost, so
 * choose `capacity` from the expected message rate and the reconnect window.
 */
export class InboxBuffer<T = string> {
  readonly #capacity: number;
  readonly #epoch: string = bytesToHex(randomBytes(EPOCH_LEN_BYTES));
  readonly #entries: Entry<T>[] = [];
  #nextSeq = 1;

  constructor(capacity = 100) {
    if(capacity < 1) throw new AggregationServiceError(`InboxBuffer capacity must be >= 1; got ${capacity}`, 'INVALID_INBOX_CAPACITY', { capacity });
    this.#capacity = capacity;
  }

  /** Append an event. Returns the stored record (including its assigned id). */
  append(event: string, data: T): StoredEvent<T> {
    const seq = this.#nextSeq++;
    const stored: StoredEvent<T> = { id: `${this.#epoch}-${seq}`, event, data };
    this.#entries.push({ seq, stored });
    if(this.#entries.length > this.#capacity) this.#entries.shift();
    return stored;
  }

  /**
   * Return the stored events after `lastEventId`.
   *
   * If `lastEventId` is an id of this buffer, the result is the events with a
   * seq greater than its seq. Else the result is every retained event. This
   * applies to no id, a malformed id, an id with a seq that is not a safe
   * integer, and an id of another buffer. A new buffer (for example after a
   * server restart) has a new epoch, so an id of an old buffer replays every
   * retained event.
   */
  since(lastEventId?: string): StoredEvent<T>[] {
    const boundary = this.#boundarySeq(lastEventId);
    const entries  = boundary === undefined
      ? this.#entries
      : this.#entries.filter((e) => e.seq > boundary);
    return entries.map((e) => e.stored);
  }

  /** Currently retained event count. */
  size(): number {
    return this.#entries.length;
  }

  /** Return the seq of `lastEventId` if it is an id of this buffer, else `undefined`. */
  #boundarySeq(lastEventId?: string): number | undefined {
    if(lastEventId === undefined) return undefined;
    const match = EVENT_ID_PATTERN.exec(lastEventId);
    if(!match || match[1] !== this.#epoch) return undefined;
    const seq = Number(match[2]);
    return Number.isSafeInteger(seq) ? seq : undefined;
  }
}
