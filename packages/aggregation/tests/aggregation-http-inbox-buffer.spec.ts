import { expect } from 'chai';

import { AggregationServiceError, InboxBuffer } from '../src/index.js';

const ID_PATTERN = /^[0-9a-f]{16}-[1-9][0-9]*$/;

describe('HTTP transport inbox buffer', () => {
  it('assigns ids of the form <epoch>-<seq>, with one epoch and a seq from 1', () => {
    const buf = new InboxBuffer();
    const a = buf.append('message', 'A');
    const b = buf.append('message', 'B');
    expect(a.id).to.match(ID_PATTERN);
    expect(b.id).to.match(ID_PATTERN);

    const [epochA, seqA] = a.id.split('-');
    const [epochB, seqB] = b.id.split('-');
    expect(epochA).to.equal(epochB);
    expect(seqA).to.equal('1');
    expect(seqB).to.equal('2');
  });

  it('gives each buffer its own epoch', () => {
    const a = new InboxBuffer().append('message', 'A');
    const b = new InboxBuffer().append('message', 'A');
    expect(a.id.split('-')[0]).to.not.equal(b.id.split('-')[0]);
  });

  it('returns all entries via since() when no id is given', () => {
    const buf = new InboxBuffer();
    buf.append('message', 'A');
    buf.append('message', 'B');
    expect(buf.since().map((e) => e.data)).to.deep.equal(['A', 'B']);
  });

  it('returns only the entries after the seq of an id of this buffer', () => {
    const buf = new InboxBuffer();
    const a = buf.append('message', 'A');
    const b = buf.append('message', 'B');
    const c = buf.append('message', 'C');
    expect(buf.since(a.id).map((e) => e.data)).to.deep.equal(['B', 'C']);
    expect(buf.since(b.id).map((e) => e.data)).to.deep.equal(['C']);
    expect(buf.since(c.id)).to.deep.equal([]);
  });

  it('returns the stored records with their ids', () => {
    const buf = new InboxBuffer();
    const a = buf.append('message', 'A');
    const b = buf.append('message', 'B');
    expect(buf.since(a.id)).to.deep.equal([b]);
  });

  for(const malformed of ['7', 'abc', '', 'not-a-number']) {
    it(`treats the malformed id '${malformed}' as no id`, () => {
      const buf = new InboxBuffer();
      buf.append('message', 'A');
      buf.append('message', 'B');
      expect(buf.since(malformed).map((e) => e.data)).to.deep.equal(['A', 'B']);
    });
  }

  it('treats an id with a seq that is not a safe integer as no id', () => {
    const buf = new InboxBuffer();
    const a = buf.append('message', 'A');
    const epoch = a.id.split('-')[0];
    expect(buf.since(`${epoch}-${'9'.repeat(20)}`).map((e) => e.data)).to.deep.equal(['A']);
  });

  it('treats an id with a leading-zero seq or an uppercase epoch as no id', () => {
    const buf = new InboxBuffer();
    const a = buf.append('message', 'A');
    buf.append('message', 'B');
    const epoch = a.id.split('-')[0]!;
    expect(buf.since(`${epoch}-01`).map((e) => e.data)).to.deep.equal(['A', 'B']);
    expect(buf.since(`${epoch.toUpperCase()}-1`).map((e) => e.data)).to.deep.equal(['A', 'B']);
  });

  it('treats an id of another buffer (for example before a restart) as no id', () => {
    const before = new InboxBuffer();
    before.append('message', 'old');
    const oldId = before.append('message', 'old').id;

    const after = new InboxBuffer();
    after.append('message', 'A');
    after.append('message', 'B');
    after.append('message', 'C');
    expect(after.since(oldId).map((e) => e.data)).to.deep.equal(['A', 'B', 'C']);
  });

  it('evicts oldest entries once capacity is exceeded', () => {
    const buf = new InboxBuffer(3);
    const a = buf.append('message', 'A');
    buf.append('message', 'B');
    buf.append('message', 'C');
    buf.append('message', 'D'); // evicts A
    expect(buf.size()).to.equal(3);
    expect(buf.since().map((e) => e.data)).to.deep.equal(['B', 'C', 'D']);
    // The id of the evicted event still sets the seq boundary.
    expect(buf.since(a.id).map((e) => e.data)).to.deep.equal(['B', 'C', 'D']);
  });

  it('keeps a generic payload', () => {
    const buf = new InboxBuffer<{ n: number }>();
    const payload = { n: 1 };
    const stored = buf.append('message', payload);
    expect(stored.data).to.equal(payload);
    expect(buf.since()[0]!.data).to.equal(payload);
  });

  it('rejects capacity < 1', () => {
    expect(() => new InboxBuffer(0))
      .to.throw(AggregationServiceError).with.property('type', 'INVALID_INBOX_CAPACITY');
  });
});
