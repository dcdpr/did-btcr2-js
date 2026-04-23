import { expect } from 'chai';

import type { SseEvent } from '../src/index.js';
import { parseSseStream } from '../src/index.js';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for(const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const ev of parseSseStream(stream)) events.push(ev);
  return events;
}

describe('HTTP transport SSE parser', () => {
  it('parses a single event with data only', async () => {
    const events = await collect(streamOf('data: hello\n\n'));
    expect(events).to.deep.equal([{ data: 'hello' }]);
  });

  it('parses event with event name and data', async () => {
    const events = await collect(streamOf('event: advert\ndata: {"x":1}\n\n'));
    expect(events).to.deep.equal([{ event: 'advert', data: '{"x":1}' }]);
  });

  it('parses multiple events in one stream', async () => {
    const events = await collect(streamOf(
      'event: a\ndata: 1\n\n',
      'event: b\ndata: 2\n\n',
    ));
    expect(events).to.deep.equal([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ]);
  });

  it('joins multi-line data with newlines', async () => {
    const events = await collect(streamOf('data: line1\ndata: line2\ndata: line3\n\n'));
    expect(events[0].data).to.equal('line1\nline2\nline3');
  });

  it('supports CRLF line endings', async () => {
    const events = await collect(streamOf('event: x\r\ndata: y\r\n\r\n'));
    expect(events).to.deep.equal([{ event: 'x', data: 'y' }]);
  });

  it('ignores comment lines (":"-prefixed)', async () => {
    const events = await collect(streamOf(': this is a comment\ndata: real\n\n'));
    expect(events).to.deep.equal([{ data: 'real' }]);
  });

  it('captures id field', async () => {
    const events = await collect(streamOf('id: abc\ndata: payload\n\n'));
    expect(events[0].id).to.equal('abc');
  });

  it('rejects ids containing NUL', async () => {
    const events = await collect(streamOf('id: ab\u0000c\ndata: payload\n\n'));
    expect(events[0].id).to.be.undefined;
  });

  it('captures numeric retry field', async () => {
    const events = await collect(streamOf('retry: 1500\ndata: x\n\n'));
    expect(events[0].retry).to.equal(1500);
  });

  it('rejects non-integer retry', async () => {
    const events = await collect(streamOf('retry: abc\ndata: x\n\n'));
    expect(events[0].retry).to.be.undefined;
  });

  it('rejects negative retry', async () => {
    const events = await collect(streamOf('retry: -50\ndata: x\n\n'));
    expect(events[0].retry).to.be.undefined;
  });

  it('does not emit events that have no data field', async () => {
    // Event with only `event:` and no `data:` is not dispatched.
    const events = await collect(streamOf('event: ping\n\ndata: after\n\n'));
    expect(events).to.deep.equal([{ data: 'after' }]);
  });

  it('strips exactly one leading space from the field value', async () => {
    const events = await collect(streamOf(
      'data: one-space\n\n',
      'data:  two-spaces\n\n',   // second space should remain
      'data:no-space\n\n',
    ));
    expect(events.map((e) => e.data)).to.deep.equal(['one-space', ' two-spaces', 'no-space']);
  });

  it('handles chunks that split mid-line', async () => {
    const events = await collect(streamOf(
      'event: split',
      '-event\ndata: split',
      '-data\n\n',
    ));
    expect(events).to.deep.equal([{ event: 'split-event', data: 'split-data' }]);
  });

  it('handles chunks that split mid-event (between events)', async () => {
    const events = await collect(streamOf(
      'data: first\n\nevent: second\n',
      'data: 2\n\n',
    ));
    expect(events).to.deep.equal([
      { data: 'first' },
      { event: 'second', data: '2' },
    ]);
  });

  it('flushes a trailing event that has data but no final blank line', async () => {
    const events = await collect(streamOf('data: tail\n'));
    expect(events).to.deep.equal([{ data: 'tail' }]);
  });

  it('yields nothing for an empty stream', async () => {
    const events = await collect(streamOf());
    expect(events).to.deep.equal([]);
  });

  it('ignores unknown fields', async () => {
    const events = await collect(streamOf('foo: bar\ndata: payload\nbaz:\n\n'));
    expect(events).to.deep.equal([{ data: 'payload' }]);
  });
});
