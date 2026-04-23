/**
 * Parsed Server-Sent Events record.
 *
 * Events without a `data` field are never yielded (per the SSE spec — only a
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

/**
 * Parse an SSE stream into an async iterable of {@link SseEvent} records.
 *
 * The parser follows the HTML Living Standard ({@link https://html.spec.whatwg.org/multipage/server-sent-events.html})
 * closely enough for our needs: LF and CRLF line terminators, multi-line
 * `data` fields, `event` / `id` / `retry` fields, and `:`-prefixed comments.
 * CR-only line terminators are not supported (every mainstream SSE
 * implementation emits LF or CRLF).
 *
 * Pure, runtime-agnostic — works anywhere `ReadableStream<Uint8Array>` and
 * `TextDecoder` exist (browsers and Node 22+).
 *
 * The caller owns stream lifecycle: cancellation should be effected via an
 * `AbortController` on the producing `fetch`, which propagates as a read
 * error and cleanly unwinds this generator's `finally`.
 */
export async function* parseSseStream(
  readable: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, void> {
  const decoder = new TextDecoder('utf-8');
  const reader  = readable.getReader();

  let buffer  = '';
  let pending: { event?: string; data?: string; id?: string; retry?: number } = {};

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

  const processLine = (line: string): void => {
    if(line.startsWith(':')) return; // comment

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

  try {
    for(;;) {
      const { value, done } = await reader.read();
      if(done) {
        // Flush any bytes the decoder is still holding.
        buffer += decoder.decode();
        if(buffer.length > 0) {
          const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
          if(line.length > 0) processLine(line);
          buffer = '';
        }
        const tail = dispatchPending();
        if(tail) yield tail;
        return;
      }

      buffer += decoder.decode(value, { stream: true });

      // Drain as many complete lines as are available.
      let lineEnd = buffer.indexOf('\n');
      while(lineEnd !== -1) {
        let line = buffer.slice(0, lineEnd);
        if(line.endsWith('\r')) line = line.slice(0, -1);
        buffer = buffer.slice(lineEnd + 1);

        if(line.length === 0) {
          const ev = dispatchPending();
          if(ev) yield ev;
        } else {
          processLine(line);
        }
        lineEnd = buffer.indexOf('\n');
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
