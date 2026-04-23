import { expect } from 'chai';

import { InboxBuffer } from '../src/index.js';

describe('HTTP transport inbox buffer', () => {
  it('appends events and assigns monotonic ids', () => {
    const buf = new InboxBuffer();
    const a = buf.append('message', 'A');
    const b = buf.append('message', 'B');
    expect(a.id).to.equal('1');
    expect(b.id).to.equal('2');
  });

  it('returns all entries via since() when no bound given', () => {
    const buf = new InboxBuffer();
    buf.append('message', 'A');
    buf.append('message', 'B');
    expect(buf.since().map((e) => e.data)).to.deep.equal(['A', 'B']);
  });

  it('returns only entries with id > lastEventId', () => {
    const buf = new InboxBuffer();
    buf.append('message', 'A'); // id 1
    buf.append('message', 'B'); // id 2
    buf.append('message', 'C'); // id 3
    expect(buf.since('1').map((e) => e.data)).to.deep.equal(['B', 'C']);
    expect(buf.since('2').map((e) => e.data)).to.deep.equal(['C']);
    expect(buf.since('3')).to.deep.equal([]);
  });

  it('ignores unparseable lastEventId (treats as no bound)', () => {
    const buf = new InboxBuffer();
    buf.append('message', 'A');
    expect(buf.since('not-a-number').map((e) => e.data)).to.deep.equal(['A']);
  });

  it('evicts oldest entries once capacity is exceeded', () => {
    const buf = new InboxBuffer(3);
    buf.append('message', 'A');
    buf.append('message', 'B');
    buf.append('message', 'C');
    buf.append('message', 'D'); // evicts A
    expect(buf.size()).to.equal(3);
    expect(buf.since().map((e) => e.data)).to.deep.equal(['B', 'C', 'D']);
  });

  it('rejects capacity < 1', () => {
    expect(() => new InboxBuffer(0)).to.throw(/capacity must be >= 1/);
  });
});
