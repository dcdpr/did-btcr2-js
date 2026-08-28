import { expect } from 'chai';
import { rootCauseMessage } from '../src/index.js';

/**
 * rootCauseMessage unit matrix: the helper must surface the deepest
 * meaningful message in any cause chain, and it must be total (never
 * throw), whatever hostile value was thrown.
 */
describe('rootCauseMessage()', () => {
  describe('cause-chain walking', () => {
    it('returns the message of a chainless error', () => {
      expect(rootCauseMessage(new Error('plain failure'))).to.equal('plain failure');
    });

    it('returns the deepest message in a cause chain', () => {
      const err = new Error('outer', {
        cause : new Error('middle', { cause: new Error('inner') }),
      });
      expect(rootCauseMessage(err)).to.equal('inner');
    });

    it('falls back up to the nearest non-empty message when the deepest is empty', () => {
      const err = new Error('outer', { cause: new Error('') });
      expect(rootCauseMessage(err)).to.equal('outer');
    });

    it('takes a string link as its own message', () => {
      const err = new Error('outer', { cause: 'string cause' });
      expect(rootCauseMessage(err)).to.equal('string cause');
    });

    it('stringifies a scalar link', () => {
      const err = new Error('outer', { cause: 42 });
      expect(rootCauseMessage(err)).to.equal('42');
    });

    it('terminates on a self-caused error', () => {
      const cyclic = new Error('cyclic');
      (cyclic as { cause?: unknown }).cause = cyclic;
      expect(rootCauseMessage(cyclic)).to.equal('cyclic');
    });

    it('stops walking after 16 hops', () => {
      // links[16] is the first link the 16-hop walk never examines, so this
      // pins the cap value itself: a 17-hop walk would find 'deep' instead.
      const links: Error[] = [];
      for (let i = 0; i < 20; i++) links.push(new Error(''));
      links[3].message = 'shallow';
      links[16].message = 'deep';
      for (let i = 0; i < 19; i++) (links[i] as { cause?: unknown }).cause = links[i + 1];
      expect(rootCauseMessage(links[0])).to.equal('shallow');
    });
  });

  describe('AggregateError descent', () => {
    it('descends into errors[0] when the aggregate message is empty', () => {
      // The Node dual-stack fetch failure shape: TypeError('fetch failed')
      // caused by an AggregateError whose own message is empty.
      const network = new AggregateError([new Error('connect ECONNREFUSED 127.0.0.1:3000')], '');
      const fetchFailed = new TypeError('fetch failed', { cause: network });
      const wrapper = new Error('resolution failed', { cause: fetchFailed });
      expect(rootCauseMessage(wrapper)).to.equal('connect ECONNREFUSED 127.0.0.1:3000');
    });

    it('accepts a string sub-error', () => {
      const aggregate = new AggregateError([], '');
      (aggregate as { errors?: unknown }).errors = ['string sub-error'];
      expect(rootCauseMessage(aggregate)).to.equal('string sub-error');
    });

    it('prefers a non-empty aggregate message over descent', () => {
      const aggregate = new AggregateError([new Error('sub')], 'aggregate message');
      expect(rootCauseMessage(aggregate)).to.equal('aggregate message');
    });

    it('falls back up when the errors array contributes nothing', () => {
      const emptySub = new Error('outer', { cause: new AggregateError([new Error('')], '') });
      expect(rootCauseMessage(emptySub)).to.equal('outer');
      const emptyArray = new Error('outer', { cause: new AggregateError([], '') });
      expect(rootCauseMessage(emptyArray)).to.equal('outer');
    });

    it('terminates on a self-referential errors array', () => {
      const aggregate = new AggregateError([], '');
      (aggregate as { errors?: unknown }).errors = [aggregate];
      expect(rootCauseMessage(aggregate)).to.equal('AggregateError');
    });
  });

  describe('totality', () => {
    it('maps null and undefined to Unknown error', () => {
      expect(rootCauseMessage(null)).to.equal('Unknown error');
      expect(rootCauseMessage(undefined)).to.equal('Unknown error');
    });

    it('stringifies thrown scalars', () => {
      expect(rootCauseMessage(42)).to.equal('42');
      expect(rootCauseMessage(true)).to.equal('true');
    });

    it('returns a thrown non-empty string as-is', () => {
      expect(rootCauseMessage('boom')).to.equal('boom');
    });

    it('maps a thrown empty string to Unknown error', () => {
      expect(rootCauseMessage('')).to.equal('Unknown error');
    });

    it('reads a message from a null-prototype object', () => {
      const bare = Object.create(null) as { message?: string };
      bare.message = 'null-proto message';
      expect(rootCauseMessage(bare)).to.equal('null-proto message');
    });

    it('maps a message-less null-prototype object to Unknown error', () => {
      // String(value) throws on a null-prototype object; the guard must catch it.
      expect(rootCauseMessage(Object.create(null))).to.equal('Unknown error');
    });

    it('survives a throwing message getter', () => {
      const hostile = {
        get message(): string { throw new Error('trap'); },
      };
      expect(rootCauseMessage(hostile)).to.equal('[object Object]');
    });

    it('survives a throwing cause getter', () => {
      const hostile = {
        message : 'top',
        get cause(): unknown { throw new Error('trap'); },
      };
      expect(rootCauseMessage(hostile)).to.equal('top');
    });
  });
});
