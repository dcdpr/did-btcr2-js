import { expect } from 'chai';

import { formatSseComment, formatSseEvent, parseSseStream } from '../src/index.js';

function streamOf(chunk: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('HTTP transport SSE writer', () => {
  it('formats a minimal event', () => {
    expect(formatSseEvent('advert', 'hello')).to.equal('event: advert\ndata: hello\n\n');
  });

  it('formats an event with id', () => {
    expect(formatSseEvent('advert', 'hello', '42')).to.equal('id: 42\nevent: advert\ndata: hello\n\n');
  });

  it('splits multi-line data across data: lines', () => {
    expect(formatSseEvent('x', 'line1\nline2')).to.equal('event: x\ndata: line1\ndata: line2\n\n');
  });

  it('format round-trips through parseSseStream', async () => {
    const frame = formatSseEvent('hello', '{"n":1}', '7');
    const events: Array<{ event?: string; data: string; id?: string }> = [];
    for await (const ev of parseSseStream(streamOf(frame))) events.push(ev);
    expect(events).to.deep.equal([{ event: 'hello', data: '{"n":1}', id: '7' }]);
  });

  it('comments are ignored by the parser', async () => {
    const frame = formatSseComment('heartbeat') + formatSseEvent('x', 'y');
    const events: Array<{ event?: string; data: string }> = [];
    for await (const ev of parseSseStream(streamOf(frame))) events.push(ev);
    expect(events).to.deep.equal([{ event: 'x', data: 'y' }]);
  });

  it('comment replaces embedded newlines to avoid frame splitting', () => {
    expect(formatSseComment('line1\nline2')).to.equal(': line1 line2\n\n');
  });
});
