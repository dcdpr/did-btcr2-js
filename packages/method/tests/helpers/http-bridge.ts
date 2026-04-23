/**
 * In-process bridge that wires an {@link HttpClientTransport}'s injected
 * `fetch` directly into an {@link HttpServerTransport}'s handlers. Lets
 * integration tests exercise the real client ↔ server wire protocol without
 * spinning up a network server.
 */
import type {
  HttpRequestLike,
  HttpServerTransport,
  SseStream,
} from '../../src/index.js';
import { formatSseComment, formatSseEvent } from '../../src/index.js';

/** Build a `fetch`-compatible function that routes calls to the server. */
export function bridgeClientToServer(server: HttpServerTransport): typeof fetch {
  const fn: typeof fetch = async (input, init) => {
    const urlStr = input instanceof URL
      ? input.href
      : typeof input === 'string' ? input : input.url;
    const url    = new URL(urlStr);
    const method = (init?.method ?? 'GET').toUpperCase();

    const headers: Record<string, string> = {};
    if(init?.headers) {
      if(init.headers instanceof Headers) {
        init.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
      } else if(Array.isArray(init.headers)) {
        for(const [k, v] of init.headers) headers[k.toLowerCase()] = v;
      } else {
        for(const [k, v] of Object.entries(init.headers)) headers[k.toLowerCase()] = String(v);
      }
    }

    const body = typeof init?.body === 'string' ? init.body : undefined;

    const req: HttpRequestLike = {
      method,
      url : url.pathname + url.search,
      headers,
      body,
    };

    const accept = headers.accept ?? '';
    if(accept.includes('text/event-stream')) {
      return makeSseResponse(server, req, init?.signal ?? undefined);
    }

    const res = await server.handleRequest(req);
    return new Response(res.body, { status: res.status, headers: res.headers });
  };
  return fn;
}

function makeSseResponse(
  server: HttpServerTransport,
  req:    HttpRequestLike,
  signal?: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  let   controller!: ReadableStreamDefaultController<Uint8Array>;

  const readable = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });

  let   closed = false;
  const closeHandlers: Array<() => void> = [];

  const sseStream: SseStream = {
    writeEvent(event, data, id) {
      if(closed) return;
      try { controller.enqueue(encoder.encode(formatSseEvent(event, data, id))); }
      catch { closed = true; }
    },
    writeComment(comment) {
      if(closed) return;
      try { controller.enqueue(encoder.encode(formatSseComment(comment))); }
      catch { closed = true; }
    },
    close() {
      if(closed) return;
      closed = true;
      try { controller.close(); } catch { /* already closed */ }
      for(const cb of closeHandlers) cb();
    },
    onClose(cb) { closeHandlers.push(cb); },
  };

  if(signal) {
    if(signal.aborted) {
      sseStream.close();
    } else {
      signal.addEventListener('abort', () => sseStream.close(), { once: true });
    }
  }

  server.handleSse(req, sseStream);

  return new Response(readable, {
    status  : 200,
    headers : { 'content-type': 'text/event-stream' },
  });
}
