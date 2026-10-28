import { DidMethodError, FEATURE_NOT_SUPPORTED, INTERNAL_ERROR, INVALID_DID, INVALID_DID_DOCUMENT, INVALID_DID_UPDATE, INVALID_DID_URL, INVALID_OPTIONS, INVALID_SIGNAL_DATA, LATE_PUBLISHING, METHOD_NOT_SUPPORTED, MISSING_UPDATE_DATA, NOT_FOUND, PROOF_VERIFICATION_ERROR, ResolveError } from '@did-btcr2/std';
import { expect } from 'chai';
import { messageText, resolutionError, resolutionErrorCode, resolutionErrorCodeOfType, resolutionErrorOfCode, rootCauseMessage } from '../src/helpers.js';

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

describe('resolutionErrorCode()', () => {
  it('returns the type of a typed error at the top', () => {
    expect(resolutionErrorCode(new ResolveError('x', NOT_FOUND))).to.equal(NOT_FOUND);
  });

  it('returns the type of a typed error below a plain wrapper', () => {
    const wrapped = new Error('Failed to resolve DID', { cause: new ResolveError('x', INVALID_DID) });
    expect(resolutionErrorCode(wrapped)).to.equal(INVALID_DID);
  });

  it('prefers the nearest typed link over a deeper one', () => {
    const inner = new ResolveError('inner', INVALID_DID);
    const outer = new ResolveError('outer', NOT_FOUND, { cause: inner });
    (outer as Error & { cause?: unknown }).cause = inner;
    expect(resolutionErrorCode(new Error('wrap', { cause: outer }))).to.equal(NOT_FOUND);
  });

  it('returns INTERNAL_ERROR for a plain Error', () => {
    expect(resolutionErrorCode(new Error('boom'))).to.equal(INTERNAL_ERROR);
  });

  it('returns INTERNAL_ERROR for a DidMethodError whose type is not a resolution code', () => {
    expect(resolutionErrorCode(new DidMethodError('x', { type: 'ResolveError' }))).to.equal(INTERNAL_ERROR);
  });

  it('returns INTERNAL_ERROR for null, undefined, and a string', () => {
    expect(resolutionErrorCode(null)).to.equal(INTERNAL_ERROR);
    expect(resolutionErrorCode(undefined)).to.equal(INTERNAL_ERROR);
    expect(resolutionErrorCode('nope')).to.equal(INTERNAL_ERROR);
  });

  it('survives a throwing cause getter', () => {
    const hostile = { get cause(): unknown { throw new Error('trap'); } };
    expect(resolutionErrorCode(hostile)).to.equal(INTERNAL_ERROR);
  });

  it('returns INTERNAL_ERROR for a typed error whose code is not one of the 13 error codes', () => {
    expect(resolutionErrorCode(new ResolveError('x', PROOF_VERIFICATION_ERROR))).to.equal(INTERNAL_ERROR);
  });

  it('returns REPRESENTATION_NOT_SUPPORTED, a DID Resolution code that std does not define', () => {
    expect(resolutionErrorCode(new ResolveError('x', 'REPRESENTATION_NOT_SUPPORTED'))).to.equal('REPRESENTATION_NOT_SUPPORTED');
  });
});

/** The 13 error codes, with the type URL and the title of each. */
const ERROR_TABLE: ReadonlyArray<[string, string, string]> = [
  [INVALID_DID, 'https://www.w3.org/ns/did#INVALID_DID', 'Invalid DID'],
  [INVALID_DID_DOCUMENT, 'https://www.w3.org/ns/did#INVALID_DID_DOCUMENT', 'Invalid DID document'],
  [NOT_FOUND, 'https://www.w3.org/ns/did#NOT_FOUND', 'DID not found'],
  ['REPRESENTATION_NOT_SUPPORTED', 'https://www.w3.org/ns/did#REPRESENTATION_NOT_SUPPORTED', 'Representation not supported'],
  [INVALID_DID_URL, 'https://www.w3.org/ns/did#INVALID_DID_URL', 'Invalid DID URL'],
  [METHOD_NOT_SUPPORTED, 'https://www.w3.org/ns/did#METHOD_NOT_SUPPORTED', 'DID method not supported'],
  [INVALID_OPTIONS, 'https://www.w3.org/ns/did#INVALID_OPTIONS', 'Invalid resolution options'],
  [INTERNAL_ERROR, 'https://www.w3.org/ns/did#INTERNAL_ERROR', 'Internal error'],
  [FEATURE_NOT_SUPPORTED, 'https://www.w3.org/ns/did#FEATURE_NOT_SUPPORTED', 'Feature not supported'],
  [INVALID_DID_UPDATE, 'https://dcdpr.github.io/did-btcr2/errors.html#invalid_did_update', 'Invalid DID update'],
  [INVALID_SIGNAL_DATA, 'https://dcdpr.github.io/did-btcr2/errors.html#invalid_signal_data', 'Invalid signal data'],
  [LATE_PUBLISHING, 'https://dcdpr.github.io/did-btcr2/errors.html#late_publishing', 'Late publishing'],
  [MISSING_UPDATE_DATA, 'https://dcdpr.github.io/did-btcr2/errors.html#missing_update_data', 'Missing update data'],
];

describe('resolutionError()', () => {
  for (const [code, type, title] of ERROR_TABLE) {
    it(`gives the type and the title of ${code}`, () => {
      const err = new Error('wrap', { cause: new ResolveError('root', code) });
      expect(resolutionError(err)).to.deep.equal({ type, title, detail: 'root' });
    });
  }

  it('gives INTERNAL_ERROR and the root cause message for an untyped value', () => {
    expect(resolutionError(null)).to.deep.equal({
      type   : 'https://www.w3.org/ns/did#INTERNAL_ERROR',
      title  : 'Internal error',
      detail : 'Unknown error',
    });
  });

  it('gives a new object for each call', () => {
    const first = resolutionError(new ResolveError('x', NOT_FOUND));
    first.title = 'changed';
    expect(resolutionError(new ResolveError('x', NOT_FOUND)).title).to.equal('DID not found');
  });
});

describe('resolutionErrorOfCode()', () => {
  for (const [code, type, title] of ERROR_TABLE) {
    it(`gives the type and the title of ${code}`, () => {
      expect(resolutionErrorOfCode(code)).to.deep.equal({ type, title });
    });
  }

  it('gives undefined for a code that is not one of the 13 error codes', () => {
    expect(resolutionErrorOfCode(PROOF_VERIFICATION_ERROR)).to.equal(undefined);
    expect(resolutionErrorOfCode('LATE_PUBLISHING_ERROR')).to.equal(undefined);
    expect(resolutionErrorOfCode('constructor')).to.equal(undefined);
  });
});

describe('resolutionErrorCodeOfType()', () => {
  for (const [code, type] of ERROR_TABLE) {
    it(`gives ${code} for its type URL`, () => {
      expect(resolutionErrorCodeOfType(type)).to.equal(code);
    });
  }

  it('gives INTERNAL_ERROR for another URL, a bare code, and a value that is not a string', () => {
    expect(resolutionErrorCodeOfType('https://www.w3.org/ns/did#PROOF_VERIFICATION_ERROR')).to.equal(INTERNAL_ERROR);
    expect(resolutionErrorCodeOfType(NOT_FOUND)).to.equal(INTERNAL_ERROR);
    expect(resolutionErrorCodeOfType(undefined)).to.equal(INTERNAL_ERROR);
    expect(resolutionErrorCodeOfType({})).to.equal(INTERNAL_ERROR);
  });
});

describe('messageText()', () => {
  // The text of a primitive value for an error message, and no text for an object or a
  // function (ADR 156).
  it('gives String(value) for each primitive value', () => {
    const cases: Array<[ unknown, string ]> = [
      [ 'abc', 'abc' ],
      [ '', '' ],
      [ 42, '42' ],
      [ Number.NaN, 'NaN' ],
      [ 10n, '10' ],
      [ true, 'true' ],
      [ undefined, 'undefined' ],
      [ null, 'null' ],
      [ Symbol('s'), 'Symbol(s)' ],
    ];
    for (const [ value, text ] of cases) {
      expect(messageText(value), text).to.equal(text);
    }
  });

  it('gives undefined for an object, an array, and a function', () => {
    const values: unknown[] = [
      {},
      { a: 1 },
      [ 1, 2 ],
      Object.create(null),
      JSON.parse('{"toString":1,"valueOf":1}'),
      () => 1,
      new Date(0),
    ];
    for (const value of values) {
      expect(messageText(value)).to.equal(undefined);
    }
  });
});
