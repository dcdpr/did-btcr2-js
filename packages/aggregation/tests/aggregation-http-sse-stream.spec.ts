import { expect } from 'chai';

import type { SseEvent, SseParseOptions } from '../src/index.js';
import { HttpTransportError, parseSseStream } from '../src/index.js';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for(const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>, options?: SseParseOptions): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const ev of parseSseStream(stream, options)) events.push(ev);
  return events;
}

/** A stream of raw byte chunks. */
function bytesStreamOf(...chunks: Array<Uint8Array | number[]>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for(const chunk of chunks) controller.enqueue(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
      controller.close();
    },
  });
}

/** The UTF-8 bytes of `text`. */
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A stream that gives the bytes of `text` in chunks of `size` bytes. */
function chunkedStreamOf(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = utf8(text);
  const chunks: Uint8Array[] = [];
  for(let i = 0; i < bytes.byteLength; i += size) chunks.push(bytes.subarray(i, i + size));
  return bytesStreamOf(...chunks);
}

interface PullSource {
  stream: ReadableStream<Uint8Array>;
  /** The count of bytes that the parser pulled. */
  pulled(): number;
  /** The reason of the source cancel, or `undefined` if no cancel ran. */
  cancelReason(): unknown;
  cancelled(): boolean;
}

/**
 * A pull source: `first`, then chunks of `chunk` until `maxBytes`, then the end of the
 * stream. The high water mark is 0, so the source gives a chunk only for a read.
 */
function pullSource(first: Uint8Array, chunk: Uint8Array, maxBytes: number): PullSource {
  let pulled = 0;
  let cancelled = false;
  let reason: unknown;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if(pulled >= maxBytes) {
        controller.close();
        return;
      }
      const next = pulled === 0 ? first : chunk;
      pulled += next.byteLength;
      controller.enqueue(next);
    },
    cancel(why) {
      cancelled = true;
      reason = why;
    },
  }, { highWaterMark: 0 });
  return { stream, pulled: () => pulled, cancelReason: () => reason, cancelled: () => cancelled };
}

/** Parse `stream` to its end. Returns the events and the error, if the parse throws. */
async function parseAll(stream: ReadableStream<Uint8Array>, options?: SseParseOptions): Promise<{ events: SseEvent[]; error?: unknown }> {
  const events: SseEvent[] = [];
  try {
    for await (const ev of parseSseStream(stream, options)) events.push(ev);
  } catch(error) {
    return { events, error };
  }
  return { events };
}

/** Make sure that `error` is the SSE_EVENT_TOO_LARGE error of the limit `max`. */
function expectTooLarge(error: unknown, max: number): void {
  expect(error).to.be.instanceOf(HttpTransportError);
  expect((error as HttpTransportError).type).to.equal('SSE_EVENT_TOO_LARGE');
  expect((error as HttpTransportError).data).to.deep.include({ maxEventBytes: max });
}

/** A data line of exactly `bytes` bytes with its LF: `data: xxx...\n`. */
const dataLine = (bytes: number): string => `data: ${'x'.repeat(bytes - 7)}\n`;

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

  it('discards a trailing event that has data but no final blank line', async () => {
    const events = await collect(streamOf('data: first\n\n', 'id: e-2\ndata: tail\n'));
    expect(events).to.deep.equal([{ data: 'first' }]);
  });

  it('discards an unterminated last line and its event at the end of the stream', async () => {
    const events = await collect(streamOf('id: e-1\ndata: first\n\n', 'id: e-2\nevent: message\ndata: {"v":1'));
    expect(events).to.deep.equal([{ id: 'e-1', data: 'first' }]);
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

/**
 * The event byte count of the limit: the bytes of each line of the event with its line
 * end (LF = 1 byte, CRLF = 2 bytes), except comment lines and the blank line that ends
 * the event. An unterminated line counts up to its last byte, except a final CR.
 */
describe('HTTP transport SSE parser: maxEventBytes', () => {
  it('an endless data line: SSE_EVENT_TOO_LARGE, the source is cancelled, at most the limit plus one chunk pulled', async () => {
    const chunk = utf8('x'.repeat(256));
    const source = pullSource(utf8('data: '), chunk, 64 * 1024);
    const { events, error } = await parseAll(source.stream, { maxEventBytes: 1024 });

    expect(events).to.deep.equal([]);
    expectTooLarge(error, 1024);
    expect(source.cancelled()).to.equal(true);
    expect(source.cancelReason()).to.equal(error);
    expect(source.pulled()).to.be.at.most(1024 + chunk.byteLength);
  });

  it('a source cancel that rejects: SSE_EVENT_TOO_LARGE and no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const chunk = utf8('x'.repeat(256));
      let pulled = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(pulled++ === 0 ? utf8('data: ') : chunk);
        },
        cancel() {
          return Promise.reject(new Error('cancel failed'));
        },
      }, { highWaterMark: 0 });
      const { error } = await parseAll(stream, { maxEventBytes: 1024 });
      expectTooLarge(error, 1024);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).to.be.empty;
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  it('an endless comment line counts: SSE_EVENT_TOO_LARGE, the source is cancelled', async () => {
    const chunk = utf8('c'.repeat(256));
    const source = pullSource(utf8(': '), chunk, 64 * 1024);
    const { error } = await parseAll(source.stream, { maxEventBytes: 1024 });

    expectTooLarge(error, 1024);
    expect(source.cancelled()).to.equal(true);
    expect(source.pulled()).to.be.at.most(1024 + chunk.byteLength);
  });

  it('a comment line above the limit fails also if it arrives in one chunk with its LF', async () => {
    const { error } = await parseAll(streamOf(`: ${'c'.repeat(2000)}\ndata: ok\n\n`), { maxEventBytes: 1024 });
    expectTooLarge(error, 1024);
  });

  it('an event of exactly the limit passes; one byte more fails', async () => {
    const max = 1024;
    // 9 + 6 + 1009 = 1024 bytes. The blank line that ends the event does not count.
    const exact = `event: e\nid: 1\n${dataLine(max - 15)}\n`;
    expect(utf8(exact).byteLength - 1).to.equal(max);
    expect(await collect(streamOf(exact), { maxEventBytes: max })).to.have.lengthOf(1);

    const over = `event: e\nid: 1\n${dataLine(max - 14)}\n`;
    expectTooLarge((await parseAll(streamOf(over), { maxEventBytes: max })).error, max);
  });

  it('the result does not depend on the chunk size: chunks of 1 byte and of 7 bytes', async () => {
    const max = 300;
    const exact = `: note\n${dataLine(max)}\n${dataLine(max)}\r\n`;
    const over  = `: note\n${dataLine(max + 1)}\n`;
    for(const size of [1, 7]) {
      expect(await collect(chunkedStreamOf(exact, size), { maxEventBytes: max })).to.have.lengthOf(2);
      expectTooLarge((await parseAll(chunkedStreamOf(over, size), { maxEventBytes: max })).error, max);
    }
  });

  it('comment lines inside an event do not count after their LF', async () => {
    const comments = `: ${'c'.repeat(27)}\n`.repeat(5);
    // 60 + 40 = 100 bytes of field lines. Each comment line is 30 bytes.
    const withComments = `${dataLine(60)}${comments}${dataLine(40)}\n`;
    expect(await collect(streamOf(withComments), { maxEventBytes: 100 })).to.have.lengthOf(1);

    // The same bytes as an unknown field count.
    const withFields = withComments.replace(/^: /gm, 'x:');
    expectTooLarge((await parseAll(streamOf(withFields), { maxEventBytes: 100 })).error, 100);
  });

  it('a blank line sets the count to 0: many small events above the limit in total pass', async () => {
    const events = await collect(streamOf(`${dataLine(80)}\n`.repeat(200)), { maxEventBytes: 100 });
    expect(events).to.have.lengthOf(200);
  });

  it('a blank line sets the count to 0 also for an event with no data field', async () => {
    const text = `event: ${'p'.repeat(80)}\n\n${dataLine(90)}\n`;
    const events = await collect(streamOf(text), { maxEventBytes: 100 });
    expect(events).to.have.lengthOf(1);
  });

  it('counts multi-byte UTF-8 in bytes', async () => {
    // 6 + 2 * 46 + 1 = 99 bytes, and 6 + 2 * 47 + 1 = 101 bytes. Each line has fewer than 100 characters.
    const ok   = `data: ${'é'.repeat(46)}\n\n`;
    const over = `data: ${'é'.repeat(47)}\n\n`;
    expect(await collect(streamOf(ok), { maxEventBytes: 100 })).to.deep.equal([{ data: 'é'.repeat(46) }]);
    expectTooLarge((await parseAll(streamOf(over), { maxEventBytes: 100 })).error, 100);
  });

  it('counts a CRLF line end as 2 bytes', async () => {
    // 6 + 92 + 2 = 100 bytes. The CR of the final blank line does not count.
    const exact = `data: ${'x'.repeat(92)}\r\n\r\n`;
    const over  = `data: ${'x'.repeat(93)}\r\n\r\n`;
    expect(await collect(streamOf(exact), { maxEventBytes: 100 })).to.have.lengthOf(1);
    expectTooLarge((await parseAll(streamOf(over), { maxEventBytes: 100 })).error, 100);
    // A chunk end after the CR of the blank line.
    expect(await collect(streamOf(exact.slice(0, -1), '\n'), { maxEventBytes: 100 })).to.have.lengthOf(1);
  });

  describe('the eventId of the error data', () => {
    const big = 'x'.repeat(2000);
    /** Label, stream text, and the expected eventId (`undefined`: no eventId). */
    const cases: Array<[string, string, string | undefined]> = [
      ['an id before the data', `id: e-7\ndata: ${big}\n\n`, 'e-7'],
      ['an empty id before the data', `id:\ndata: ${big}\n\n`, ''],
      ['two ids before the data', `id: a\nid: b\ndata: ${big}\n\n`, 'b'],
      ['two ids before the data, the last with NUL', `id: a\nid: b\0c\ndata: ${big}\n\n`, 'a'],
      ['an id after the limit point', `data: ${big}\nid: e-7\n\n`, undefined],
      ['no id, and the event before has an id', `id: e-1\ndata: ok\n\ndata: ${big}\n\n`, undefined],
      ['an id with NUL', `id: a\0b\ndata: ${big}\n\n`, undefined],
    ];
    for(const [label, text, eventId] of cases) {
      const expected = eventId === undefined ? 'no eventId' : `eventId ${JSON.stringify(eventId)}`;
      it(`${label}: ${expected}, in one chunk and in chunks of 7 bytes`, async () => {
        // One chunk: the check at an LF fails. Chunks of 7 bytes: the check of an unterminated line fails.
        for(const size of [utf8(text).byteLength, 7]) {
          const { error } = await parseAll(chunkedStreamOf(text, size), { maxEventBytes: 1024 });
          expectTooLarge(error, 1024);
          const data = (error as HttpTransportError).data;
          if(eventId === undefined) expect(data).to.not.have.property('eventId');
          else expect(data).to.have.property('eventId', eventId);
        }
      });
    }

    it('an endless data line after an id: eventId, the source is cancelled', async () => {
      const source = pullSource(utf8('id: e-9\ndata: '), utf8('x'.repeat(256)), 64 * 1024);
      const { error } = await parseAll(source.stream, { maxEventBytes: 1024 });
      expectTooLarge(error, 1024);
      expect((error as HttpTransportError).data).to.have.property('eventId', 'e-9');
      expect(source.cancelled()).to.equal(true);
    });
  });

  const noLimit: Array<[string, SseParseOptions | undefined]> = [
    ['no options', undefined],
    ['no maxEventBytes', {}],
    ['0', { maxEventBytes: 0 }],
    ['-1', { maxEventBytes: -1 }],
    ['NaN', { maxEventBytes: Number.NaN }],
    ['the string 1000', { maxEventBytes: '1000' as unknown as number }],
  ];
  for(const [label, options] of noLimit) {
    it(`${label}: no limit, an event of 2 MiB parses`, async () => {
      const data = 'x'.repeat(2 * 1024 * 1024);
      const events = await collect(chunkedStreamOf(`data: ${data}\n\n`, 64 * 1024), options);
      expect(events).to.have.lengthOf(1);
      expect(events[0].data.length).to.equal(data.length);
    });
  }
});

describe('HTTP transport SSE parser: stream decode', () => {
  it('parses a data line of 8 MiB in chunks of 1 KiB in less than 5 s', async function() {
    this.timeout(60_000);
    const size = 8 * 1024 * 1024;
    const chunk = utf8('x'.repeat(1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if(sent === 0) controller.enqueue(utf8('data: '));
        if(sent >= size) {
          controller.enqueue(utf8('\n\n'));
          controller.close();
          return;
        }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    }, { highWaterMark: 0 });

    const start = Date.now();
    const events = await collect(stream);
    const elapsedMs = Date.now() - start;
    expect(events).to.have.lengthOf(1);
    expect(events[0].data.length).to.equal(size);
    expect(elapsedMs).to.be.below(5000);
  });

  it('removes a byte order mark at the stream start and keeps a later one', async () => {
    const events = await collect(bytesStreamOf([0xef, 0xbb, 0xbf], utf8('data: a\n\ndata: \ufeffb\n\n')));
    expect(events).to.deep.equal([{ data: 'a' }, { data: '\ufeffb' }]);
  });

  it('keeps a byte order mark at the start of a later line: the field name then holds it', async () => {
    // HTML: only a BOM at the stream start is removed. '\ufeffdata' is an unknown field name.
    const bytes = [...utf8('data: a\n\n'), 0xef, 0xbb, 0xbf, ...utf8('data: b\n\n')];
    expect(await collect(bytesStreamOf(bytes))).to.deep.equal([{ data: 'a' }]);
    // The same if the BOM is at the start of a chunk, or if a chunk end splits it.
    expect(await collect(bytesStreamOf(utf8('data: a\n\n'), [0xef, 0xbb, 0xbf, ...utf8('data: b\n\n')]))).to.deep.equal([{ data: 'a' }]);
    expect(await collect(bytesStreamOf(utf8('data: a\n\n'), [0xef], [0xbb, 0xbf, ...utf8('data: b\n\n')]))).to.deep.equal([{ data: 'a' }]);
  });

  it('removes only one byte order mark at the stream start', async () => {
    // HTML: one leading U+FEFF is ignored. A second one is the start of the first field name.
    const bom = [0xef, 0xbb, 0xbf];
    const rest = utf8('data: a\n\ndata: b\n\n');
    expect(await collect(bytesStreamOf([...bom, ...bom, ...rest]))).to.deep.equal([{ data: 'b' }]);
    expect(await collect(bytesStreamOf(bom, [...bom, ...rest]))).to.deep.equal([{ data: 'b' }]);
  });

  it('removes a byte order mark that a chunk end splits', async () => {
    const events = await collect(bytesStreamOf([0xef], [0xbb], [0xbf, ...utf8('data: a\n\n')]));
    expect(events).to.deep.equal([{ data: 'a' }]);
  });

  it('decodes a multi-byte character that a chunk end splits, at each split point', async () => {
    const text = 'data: é€😀\n\n';
    for(const size of [1, 2, 3, 5]) {
      expect(await collect(chunkedStreamOf(text, size))).to.deep.equal([{ data: 'é€😀' }]);
    }
  });

  it('gives U+FFFD in the same line for a broken multi-byte sequence before an LF', async () => {
    // 0xE2 0x82 is the start of a 3-byte sequence (for example U+20AC) with no last byte.
    const expected = [{ data: 'a\ufffd\nb' }];
    const broken = [...utf8('data: a'), 0xe2, 0x82, ...utf8('\ndata: b\n\n')];
    expect(await collect(bytesStreamOf(broken))).to.deep.equal(expected);
    // The same if a chunk end comes after the broken sequence.
    expect(await collect(bytesStreamOf([...utf8('data: a'), 0xe2, 0x82], utf8('\ndata: b\n\n')))).to.deep.equal(expected);
    // The same as a decode of the whole stream.
    expect(new TextDecoder().decode(new Uint8Array(broken)).split('\n')[0]).to.equal('data: a\ufffd');
  });

  it('supports a CRLF line end that a chunk end splits after the CR', async () => {
    const events = await collect(streamOf('event: x\r', '\ndata: y\r', '\n\r', '\n'));
    expect(events).to.deep.equal([{ event: 'x', data: 'y' }]);
  });

  it('parses a line of 200 KiB in chunks of 100 bytes, then more events', async () => {
    const long = 'é'.repeat(100 * 1024);
    const text = `data: ${long}\n\n${'data: next\n\n'.repeat(3)}`;
    const events = await collect(chunkedStreamOf(text, 100));
    expect(events).to.have.lengthOf(4);
    expect(events[0].data).to.equal(long);
    expect(events.slice(1)).to.deep.equal([{ data: 'next' }, { data: 'next' }, { data: 'next' }]);
  });

  it('parses many events in one chunk', async () => {
    let text = '';
    for(let i = 0; i < 1000; i++) text += `id: ${i}\nevent: e\ndata: ${i}\n\n`;
    const events = await collect(streamOf(text));
    expect(events).to.have.lengthOf(1000);
    expect(events[999]).to.deep.equal({ id: '999', event: 'e', data: '999' });
    expect(events.map((e) => e.data)).to.deep.equal(Array.from({ length: 1000 }, (_, i) => String(i)));
  });
});
