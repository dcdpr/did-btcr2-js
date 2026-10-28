import { FEATURE_NOT_SUPPORTED, INVALID_DID, INVALID_OPTIONS, METHOD_NOT_SUPPORTED, ResolveError } from '@did-btcr2/std';
import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import { isAcceptValue, RESOLUTION_OPTION_NAMES } from '../src/core/resolution-options.js';
import deterministicData from './data/deterministic-data.js';

const [ fixture ] = deterministicData;

/** Calls DidBtcr2.resolve and returns the error that it throws. */
function refusal(did: string, options: unknown): any {
  try {
    DidBtcr2.resolve(did, options as never);
  } catch(error) {
    return error;
  }
  expect.fail(`resolve must throw for ${String(JSON.stringify(options))}`);
}

/** The first state of a resolution, as JSON. */
function firstState(options: unknown): string {
  return JSON.stringify(DidBtcr2.resolve(fixture.did, options as never).resolve());
}

/**
 * DidBtcr2.resolve checks the resolution options in the order of DID Resolution v1,
 * section 4.4: step 3 (FEATURE_NOT_SUPPORTED), then step 4 (INVALID_OPTIONS).
 */
describe('Resolution options', () => {
  it('supports the 8 option names', () => {
    expect([ ...RESOLUTION_OPTION_NAMES ]).to.have.members([
      'accept', 'expandRelativeUrls', 'noCache', 'versionId', 'versionTime', 'minConf', 'sidecar', 'maxDiscoveryRounds'
    ]);
  });

  describe('step 3: FEATURE_NOT_SUPPORTED', () => {
    it('refuses an option name that the resolver does not support', () => {
      for(const name of [ 'foo', 'resolveRepresentation', 'Accept', '' ]) {
        const error = refusal(fixture.did, { [name]: 1 });
        expect(error, name).to.be.instanceOf(ResolveError);
        expect(error.type, name).to.equal(FEATURE_NOT_SUPPORTED);
        expect(error.message).to.equal(`The resolver does not support the resolution option ${JSON.stringify(name)}.`);
        expect(error.data).to.deep.equal({ option: name });
      }
    });

    it('refuses expandRelativeUrls with the value true', () => {
      const error = refusal(fixture.did, { expandRelativeUrls: true });
      expect(error).to.be.instanceOf(ResolveError);
      expect(error.type).to.equal(FEATURE_NOT_SUPPORTED);
      expect(error.message).to.match(/"expandRelativeUrls" with the value true/);
      expect(error.data).to.deep.equal({ option: 'expandRelativeUrls' });
    });

    it('treats an option with the value undefined as absent', () => {
      expect(firstState({ foo: undefined, accept: undefined })).to.equal(firstState({}));
    });
  });

  describe('step 4: INVALID_OPTIONS', () => {
    it('refuses options that are not an object', () => {
      for(const options of [ null, [], 'x', 42, true ]) {
        const error = refusal(fixture.did, options);
        expect(error, String(options)).to.be.instanceOf(ResolveError);
        expect(error.type).to.equal(INVALID_OPTIONS);
        expect(error.message).to.equal('Invalid resolution options: expected an object.');
        expect(error.data).to.deep.equal({ resolutionOptions: options });
      }
    });

    it('refuses an option value of the wrong type or form', () => {
      const cases: Array<[ string, unknown, string ]> = [
        [ 'accept', 1, 'an Accept header value (RFC 9110, section 12.5.1), got 1' ],
        [ 'accept', 'application', 'an Accept header value (RFC 9110, section 12.5.1), got "application"' ],
        [ 'accept', 'application/did;;q=x', 'an Accept header value (RFC 9110, section 12.5.1), got "application/did;;q=x"' ],
        [ 'expandRelativeUrls', 'yes', 'a boolean, got "yes"' ],
        [ 'expandRelativeUrls', 'true', 'a boolean, got "true"' ],
        [ 'expandRelativeUrls', null, 'a boolean, got null' ],
        [ 'noCache', 1, 'true, false, "true", or "false", got 1' ],
        [ 'noCache', 'yes', 'true, false, "true", or "false", got "yes"' ],
        [ 'noCache', null, 'true, false, "true", or "false", got null' ],
        [ 'sidecar', null, 'an object, got null' ],
        [ 'sidecar', [], 'an object' ],
        [ 'sidecar', 'x', 'an object, got "x"' ],
        [ 'maxDiscoveryRounds', '5', 'a number, got "5"' ],
        [ 'maxDiscoveryRounds', null, 'a number, got null' ]
      ];
      for(const [ name, value, expected ] of cases) {
        const error = refusal(fixture.did, { [name]: value });
        expect(error, `${name} ${JSON.stringify(value)}`).to.be.instanceOf(ResolveError);
        expect(error.type, `${name} ${JSON.stringify(value)}`).to.equal(INVALID_OPTIONS);
        expect(error.message).to.equal(`Invalid resolution option ${name}: expected ${expected}.`);
        expect(error.data).to.deep.equal({ [name]: value });
      }
    });

    it('refuses a null-prototype object as an option value, with no value text in the message', () => {
      for(const name of [ 'accept', 'minConf', 'versionId', 'versionTime' ]) {
        const value = Object.create(null);
        const error = refusal(fixture.did, { [name]: value });
        expect(error, name).to.be.instanceOf(ResolveError);
        expect(error.type, name).to.equal(INVALID_OPTIONS);
        expect(error.message, name).to.not.match(/got|\[object/);
        expect(error.data[name], name).to.equal(value);
      }
    });

    it('accepts each valid value of accept, expandRelativeUrls, and noCache with no effect', () => {
      const plain = firstState({});
      const valid = [
        { accept: 'application/did' },
        { accept: 'application/did+cbor' },
        { accept: '' },
        { expandRelativeUrls: false },
        { noCache: true },
        { noCache: false },
        { noCache: 'true' },
        { noCache: 'false' },
        { sidecar: Object.create(null) },
        { maxDiscoveryRounds: 2 },
        Object.create(null)
      ];
      for(const options of valid) expect(firstState(options), JSON.stringify(options)).to.equal(plain);
    });
  });

  describe('order of the checks', () => {
    it('refuses an unsupported option before an option value that is not valid', () => {
      for(const options of [
        { versionId: 'x', foo: 1 },
        { accept: 1, foo: 1 },
        { sidecar: null, foo: 1 },
        { accept: 1, expandRelativeUrls: true },
        { maxDiscoveryRounds: '5', expandRelativeUrls: true }
      ]) {
        expect(refusal(fixture.did, options).type, JSON.stringify(options)).to.equal(FEATURE_NOT_SUPPORTED);
      }
    });

    it('decodes the DID before it checks the options', () => {
      expect(refusal('did:btcr2:notvalid', { foo: 1 }).type).to.equal(INVALID_DID);
      expect(refusal('did:example:123', { foo: 1 }).type).to.equal(METHOD_NOT_SUPPORTED);
      expect(refusal('did:example:123', null).type).to.equal(METHOD_NOT_SUPPORTED);
    });
  });

  describe('isAcceptValue (RFC 9110, section 12.5.1)', () => {
    it('accepts an Accept header value', () => {
      for(const value of [
        '', 'application/did', '*/*', 'text/*, application/did;q=0.9', 'application/did; q=1.000',
        'a/b;Q=0.1', 'a/b;qa=zz', 'a/b;c="x y"', 'a/b;c="x\\"y"', 'a/b;c=d;q=0', 'a/b; ', 'a/b , c/d', ',,'
      ]) expect(isAcceptValue(value), JSON.stringify(value)).to.equal(true);
    });

    it('refuses another value', () => {
      for(const value of [
        'application', 'a/b;c', 'a/b ', ' a/b', 'a/b;q=1.0001', 'a/b;q=2', 'a/b;q="0.5"', 'application/did;;q=x',
        'a/b;c="x', 'a b/c', 'a/b;c=d e'
      ]) expect(isAcceptValue(value), JSON.stringify(value)).to.equal(false);
    });

    it('refuses a long value with many separators in linear time', () => {
      expect(isAcceptValue('a/b' + '; '.repeat(10000) + '@')).to.equal(false);
      expect(isAcceptValue('a/b' + ' ,'.repeat(10000) + '@')).to.equal(false);
    });
  });
});
