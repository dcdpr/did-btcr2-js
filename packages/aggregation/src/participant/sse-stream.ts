import { HttpTransportError } from '../core/transport/http/errors.js';

/**
 * Parsed Server-Sent Events record.
 *
 * Events without a `data` field are never yielded (per the SSE spec - only a
 * blank line that follows at least one `data:` line dispatches an event).
 */
export interface SseEvent {
  /** Optional event name (from `event:` field). Defaults to "message" if omitted. */
  event?: string;
  /** Accumulated data payload (multiple `data:` lines joined with `\n`). */
  data: string;
  /** Last-Event-ID value for reconnect resumption. */
  id?: string;
  /** Retry delay hint in milliseconds. */
  retry?: number;
}

/** Options of {@link parseSseStream}. */
export interface SseParseOptions {
  /**
   * The maximum byte count of one event. Default: no limit. A number greater than 0 sets
   * the limit. The parser ignores each other value (for example `0`, a negative number,
   * `NaN`, or a string).
   *
   * The event count is the sum of these values:
   * - The bytes of each completed line of the event, with its line end (LF = 1 byte,
   *   CRLF = 2 bytes). A comment line does not count after its LF.
   * - The bytes of the current unterminated line, of each kind. A final CR byte does not
   *   count until its LF arrives, because it can be the start of a CRLF line end.
   *
   * The blank line that ends an event sets the count to 0, also if the event has no
   * `data` field. If the count becomes greater than the limit, the parser cancels the
   * stream and throws {@link HttpTransportError} `SSE_EVENT_TOO_LARGE`.
   *
   * The error data holds `adapter` (`'http'`, as in each {@link HttpTransportError}) and
   * these values:
   * - `maxEventBytes`: the limit.
   * - `eventId`: the value of the `id` field of the refused event, if the parser applied
   *   that field before the count became greater than the limit. The value can be an
   *   empty string. If the parser applied more than one `id` field of the event, the
   *   last applied field gives the value.
   *
   * The HTML standard sets the last event id only at the dispatch of an event. The
   * parser does not dispatch the refused event, so `eventId` is an addition to the
   * standard.
   *
   * The parser keeps the bytes of an unterminated line in one buffer. The size check
   * runs before the parser adds bytes to the buffer, so the buffer holds at most the
   * limit plus 1 byte. Thus the parser holds about the limit plus one chunk. The chunk
   * size does not change this bound. See {@link RECOMMENDED_MAX_SSE_EVENT_BYTES} for the
   * recommended value.
   */
  maxEventBytes?: number;
}

/**
 * The recommended value of {@link SseParseOptions.maxEventBytes} and of the
 * `maxSseEventBytes` option of the HTTP client: 1 MiB (1,048,576 bytes).
 *
 * This value is a recommendation only. No code applies it implicitly: the default
 * is no limit.
 *
 * The largest inbox events of the protocol grow with the cohort size:
 * - DISTRIBUTE_AGGREGATED_DATA of a CAS cohort holds one announcement map entry for
 *   each member (about 122 bytes for a did:btcr2 KEY DID). 1 MiB holds this event for
 *   a cohort of about 8,500 members.
 * - COHORT_READY holds one cohort key for each member (81 bytes). 1 MiB holds this
 *   event for a cohort of about 12,900 members.
 *
 * A service with a larger cohort needs a larger value.
 */
export const RECOMMENDED_MAX_SSE_EVENT_BYTES = 1_048_576;

/** The LF byte. An LF byte never occurs inside the UTF-8 sequence of another character. */
const LF = 0x0a;

/** The CR byte. */
const CR = 0x0d;

/** The UTF-16 code unit of the byte order mark (U+FEFF). */
const BOM_CODE_UNIT = 0xfeff;

/** The first capacity of the line buffer, in bytes. */
const MIN_LINE_BUFFER_BYTES = 1024;

/** After a line ends, the parser frees a line buffer with a larger capacity than this value. */
const KEPT_LINE_BUFFER_BYTES = 64 * 1024;

/**
 * Parse an SSE stream into an async iterable of {@link SseEvent} records.
 *
 * The parser follows the HTML Living Standard ({@link https://html.spec.whatwg.org/multipage/server-sent-events.html})
 * closely enough for our needs: LF and CRLF line terminators, multi-line
 * `data` fields, `event` / `id` / `retry` fields, and `:`-prefixed comments.
 * CR-only line terminators are not supported (every mainstream SSE
 * implementation emits LF or CRLF).
 *
 * At the end of the stream, the parser discards an incomplete event and an
 * unterminated last line, as the HTML standard says. An incomplete event has no
 * final blank line.
 *
 * The parser finds the LF bytes in each new chunk only. It keeps the bytes of an
 * unterminated line in one buffer, and it decodes each line once with one streaming
 * UTF-8 decoder. Thus the parse time is linear in the stream length. The parser
 * removes one byte order mark at the start of the stream, as the HTML standard says.
 * An invalid UTF-8 sequence gives U+FFFD in the line that holds it.
 *
 * Pure, runtime-agnostic - works anywhere `ReadableStream<Uint8Array>` and
 * `TextDecoder` exist (browsers and Node 22+).
 *
 * The caller stops the parse with an `AbortController` on the producing `fetch`. The
 * abort gives a read error, and the `finally` block of the generator releases the
 * reader. The parser cancels the stream only for an event above the size limit.
 *
 * @throws {HttpTransportError} `SSE_EVENT_TOO_LARGE` if an event is larger than
 *   `options.maxEventBytes` (see {@link SseParseOptions}). The parser cancels the
 *   stream before it throws. The error data holds `maxEventBytes`. It also holds
 *   `eventId` if the refused event has an applied `id` field (see
 *   {@link SseParseOptions.maxEventBytes}).
 */
export async function* parseSseStream(
  readable: ReadableStream<Uint8Array>,
  options?: SseParseOptions,
): AsyncGenerator<SseEvent, void, void> {
  const max     = options?.maxEventBytes;
  const limit   = typeof max === 'number' && max > 0 ? max : Infinity;
  // The parser removes the byte order mark itself (see `decode`). Bun 1.3 removes a BOM
  // at the start of each streaming decode call, so the decoder must keep each BOM.
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  const reader  = readable.getReader();

  /** The bytes of the current unterminated line: `lineBuf[0]` to `lineBuf[lineLen - 1]`. */
  let lineBuf = new Uint8Array(0);
  /** The byte count of the current unterminated line. */
  let lineLen = 0;
  /** The byte count of the completed lines of the current event, except comment lines. */
  let eventBytes = 0;
  /** `true` after the decoder gave the first character of the stream. */
  let decodedFirst = false;
  let pending: { event?: string; data?: string; id?: string; retry?: number } = {};

  /** Decode the next bytes of the stream. Remove a BOM if it is the first character of the stream. */
  const decode = (bytes: Uint8Array): string => {
    const text = decoder.decode(bytes, { stream: true });
    if(decodedFirst || text.length === 0) return text;
    decodedFirst = true;
    return text.charCodeAt(0) === BOM_CODE_UNIT ? text.slice(1) : text;
  };

  /**
   * Add bytes to the unterminated line. The capacity doubles, and it stays at most
   * `limit + 1`: the caller checks the size before the call.
   */
  const keepBytes = (bytes: Uint8Array): void => {
    const needed = lineLen + bytes.byteLength;
    if(needed > lineBuf.byteLength) {
      const doubled = Math.max(needed, 2 * lineBuf.byteLength, MIN_LINE_BUFFER_BYTES);
      const grown   = new Uint8Array(Math.min(doubled, Math.max(needed, limit + 1)));
      grown.set(lineBuf.subarray(0, lineLen));
      lineBuf = grown;
    }
    lineBuf.set(bytes, lineLen);
    lineLen = needed;
  };

  const dispatchPending = (): SseEvent | null => {
    if(pending.data === undefined) {
      pending = {};
      return null;
    }
    const ev: SseEvent = { data: pending.data };
    if(pending.event !== undefined) ev.event = pending.event;
    if(pending.id    !== undefined) ev.id    = pending.id;
    if(pending.retry !== undefined) ev.retry = pending.retry;
    pending = {};
    return ev;
  };

  /** Apply a field line. The caller handles a blank line and a comment line. */
  const processLine = (line: string): void => {
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let   value = colon === -1 ? '' : line.slice(colon + 1);
    if(value.startsWith(' ')) value = value.slice(1);

    switch(field) {
      case 'data':
        pending.data = pending.data === undefined ? value : `${pending.data}\n${value}`;
        break;
      case 'event':
        pending.event = value;
        break;
      case 'id':
        // Per spec: ignore ids containing NUL.
        if(!value.includes('\0')) pending.id = value;
        break;
      case 'retry': {
        const n = Number(value);
        if(Number.isInteger(n) && n >= 0) pending.retry = n;
        break;
      }
      // Other fields (including unknown names) are ignored per the spec.
    }
  };

  /**
   * Cancel the stream. Then return the error of an event above the limit. A blank line
   * sets `pending` to a new object, so `pending.id` is an id of the refused event only.
   */
  const tooLarge = (): HttpTransportError => {
    const error = new HttpTransportError(
      `An SSE event exceeds the limit of ${limit} bytes.`,
      'SSE_EVENT_TOO_LARGE',
      pending.id !== undefined ? { maxEventBytes: limit, eventId: pending.id } : { maxEventBytes: limit },
    );
    try {
      reader.cancel(error).catch(() => { /* ignored */ });
    } catch { /* ignored */ }
    return error;
  };

  try {
    for(;;) {
      const { value, done } = await reader.read();
      // At the end of the stream, discard the pending event and an unterminated last
      // line (HTML: "If the file ends in the middle of an event, before the final empty
      // line, the incomplete event is not dispatched."). A cut event never gives its id.
      if(done) return;

      // Find each LF in this chunk only. The parser never scans older data again.
      let start = 0;
      for(let lf = value.indexOf(LF); lf !== -1; lf = value.indexOf(LF, start)) {
        const contentBytes = lineLen + (lf - start);
        // The byte before the LF is in this chunk, or it is the last kept byte.
        const crlf = (lf > start ? value[lf - 1] : lineLen > 0 ? lineBuf[lineLen - 1] : undefined) === CR;

        // The line counts while it is unterminated: up to its LF, with no final CR.
        if(eventBytes + contentBytes - (crlf ? 1 : 0) > limit) throw tooLarge();

        // Decode the LF with the line that it ends. Thus an incomplete UTF-8 sequence
        // before the LF gives U+FFFD in this line, as a decode of the whole stream does.
        const kept = lineLen > 0 ? decode(lineBuf.subarray(0, lineLen)) : '';
        const text = kept + decode(value.subarray(start, lf + 1));
        lineLen = 0;
        if(lineBuf.byteLength > KEPT_LINE_BUFFER_BYTES) lineBuf = new Uint8Array(0);
        start = lf + 1;

        // The decoded text ends with the LF. Remove it, and a CR before it.
        const line = text.slice(0, crlf ? -2 : -1);

        if(line.length === 0) {
          eventBytes = 0;
          const ev = dispatchPending();
          if(ev) yield ev;
        } else if(!line.startsWith(':')) {
          eventBytes += contentBytes + 1;
          if(eventBytes > limit) throw tooLarge();
          processLine(line);
        }
        // A comment line does not count after its LF.
      }

      // Keep the rest of the chunk as a part of the unterminated line. Check the size
      // first, so the line buffer never holds more than the limit plus 1 byte.
      if(start < value.byteLength) {
        const rest    = value.subarray(start);
        const finalCr = value[value.byteLength - 1] === CR ? 1 : 0;
        if(eventBytes + lineLen + rest.byteLength - finalCr > limit) throw tooLarge();
        keepBytes(rest);
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
