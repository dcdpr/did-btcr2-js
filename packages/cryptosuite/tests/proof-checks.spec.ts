import { expect } from 'chai';
import { base58btc } from 'multiformats/bases/base58';
import {
  contextStartsWith,
  decodeProofValue,
  isMap,
  isValidUrlString,
  proofOptionsProblem,
  securedProofProblem
} from '../src/cryptosuite/proof-checks.js';

describe('proof-checks (internal)', () => {
  describe('isValidUrlString (URL Standard, valid URL string)', () => {
    const valid: Array<[string, string]> = [
      ['urn:uuid:6a1676b8-b51f-11ed-937b-d76685a20ff5', 'an opaque path (VC Data Integrity example)'],
      ['did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r#initialKey', 'a DID URL'],
      ['https://example.com/proofs/1', 'a special scheme'],
      ['HTTPS://EXAMPLE.COM/', 'a scheme in capitals'],
      ['https://example.com', 'a special scheme with no path'],
      ['https://example.com:8443/a?b=c#d', 'a port, a query, and a fragment'],
      ['https://example.com:/', 'an empty port'],
      ['https://[::1]:8080', 'an IPv6 host'],
      ['https://münchen.de/', 'a non-ASCII host'],
      ['https://example.com/café', 'a non-ASCII path'],
      ['file:///etc/x', 'a file URL with no host'],
      ['file://localhost/x', 'a file URL with a host'],
      ['foo://host:12/p', 'a non-special scheme with a host'],
      ['foo://', 'a non-special scheme with an empty host'],
      ['foo://[::1]/x', 'a non-special scheme with an IPv6 host'],
      ['foo:/p', 'a path-absolute-non-authority URL'],
      ['mailto:a@b.c', 'an opaque path with @'],
      ['urn:x%20y', 'a percent-encoded byte'],
      ['x:\u{10FFFD}', 'the last URL code point'],
      ['#frag', 'a fragment alone'],
      ['#schlüssel', 'a non-ASCII fragment'],
      ['proof-1', 'a path-relative URL'],
      ['', 'the empty string (a path-relative URL)'],
      ['a/b:c', 'a colon after the first segment'],
      ['/a/b', 'a path-absolute URL'],
      ['/', 'the root path'],
      ['?q', 'a query alone'],
      ['//example.com/x', 'a scheme-relative special URL'],
      ['//', 'a scheme-relative URL with an empty host'],
      ['https://a_b/', 'a host that the URL parser accepts (no IDNA check)'],
    ];
    for(const [value, label] of valid) {
      it(`accepts ${label}: ${JSON.stringify(value)}`, () => {
        expect(isValidUrlString(value)).to.equal(true);
      });
    }

    const invalid: Array<[unknown, string]> = [
      ['not a url', 'a space'],
      [42, 'a number'],
      [null, 'null'],
      [undefined, 'undefined'],
      [{}, 'a map'],
      ['https://exa mple.com/', 'a space in the host'],
      ['https://a"b/', 'a quote in the host'],
      ['http:foo', 'a special scheme with no //'],
      ['ftp:x', 'ftp with no //'],
      ['https://', 'a special scheme with no host'],
      ['ws://', 'ws with no host'],
      ['https:///x', 'a special scheme with an empty host and a path'],
      ['https://user@example.com/', 'credentials'],
      ['foo://a@b/', 'credentials in a non-special URL'],
      ['https://example.com:65536/', 'a port above 65535'],
      ['https://example.com:x/', 'a port that is not digits'],
      ['https://[zz]/', 'an IPv6 host that the parser refuses'],
      ['//[::1', 'an IPv6 host with no ]'],
      ['file://host:80/', 'a file URL with a port'],
      ['file:', 'a file URL with no //'],
      ['https://example.com/a b', 'a space in the path'],
      ['a#b#c', 'a # in the fragment'],
      ['?a b', 'a space in the query'],
      ['#a b', 'a space in the fragment'],
      ['foo:a b', 'a space in an opaque path'],
      ['%zz', 'a % with no two hex digits'],
      ['a\\b', 'a backslash'],
      ['<a>', 'angle brackets'],
      ['\ud800', 'a lone surrogate'],
      ['x:y\uFFFE', 'a noncharacter'],
      ['x:\u{1FFFF}', 'a noncharacter of plane 1'],
      ['x:\u0000', 'a C0 control'],
      ['https://1.2.3.256/', 'an IPv4 host with a part above 255'],
      ['https://[1:2]/', 'an IPv6 host with too few parts'],
      ['foo://[1:2]/', 'a non-special scheme with an IPv6 host with too few parts'],
      ['foo://:80/', 'a port with no host'],
      ['foo://h:x/', 'a non-special scheme with a port that is not digits'],
      ['HTTP:foo', 'a special scheme in capitals with no //'],
      ['file://a"b/', 'a quote in a file host'],
      ['foo://h/a b', 'a space in a non-special path'],
    ];
    for(const [value, label] of invalid) {
      it(`refuses ${label}: ${JSON.stringify(value)}`, () => {
        expect(isValidUrlString(value)).to.equal(false);
      });
    }
  });

  describe('contextStartsWith', () => {
    it('accepts a document @context that starts with the proof @context', () => {
      expect(contextStartsWith(['a', 'b'], ['a'])).to.equal(true);
      expect(contextStartsWith(['a', 'b'], ['a', 'b'])).to.equal(true);
    });

    it('reads a string @context as a list of one value', () => {
      expect(contextStartsWith('a', 'a')).to.equal(true);
      expect(contextStartsWith(['a', 'b'], 'a')).to.equal(true);
      expect(contextStartsWith('a', ['a'])).to.equal(true);
    });

    it('compares maps by their members, in any order', () => {
      expect(contextStartsWith(['a', { x: 1, y: [2] }], ['a', { y: [2], x: 1 }])).to.equal(true);
      expect(contextStartsWith([{ x: 1 }], [{ x: 1, y: 2 }])).to.equal(false);
      expect(contextStartsWith([{ x: 1, y: 2 }], [{ x: 1 }])).to.equal(false);
      expect(contextStartsWith([{ x: 1, z: 2 }], [{ x: 1, y: 2 }])).to.equal(false);
      expect(contextStartsWith([[1]], [{ 0: 1 }])).to.equal(false);
    });

    it('refuses another order, a longer proof @context, and an absent document @context', () => {
      expect(contextStartsWith(['b', 'a'], ['a'])).to.equal(false);
      expect(contextStartsWith(['a'], ['a', 'b'])).to.equal(false);
      expect(contextStartsWith(undefined, ['a'])).to.equal(false);
      expect(contextStartsWith(undefined, [])).to.equal(false);
    });
  });

  describe('decodeProofValue', () => {
    const signature = new Uint8Array(64).fill(7);
    const text = base58btc.encode(signature);

    it('decodes the base58btc text of 64 bytes', () => {
      expect(decodeProofValue(text)).to.deep.equal(signature);
    });

    it('refuses a text that the decoder reads but that is not canonical', () => {
      const other = `z\u0100${text.slice(1)}`;
      expect(base58btc.decode(other)).to.have.length(64);
      expect(decodeProofValue(other)).to.equal(undefined);
    });

    it('refuses 63 or 65 bytes, another header, a bad character, and a non-string', () => {
      expect(decodeProofValue(base58btc.encode(new Uint8Array(63).fill(7)))).to.equal(undefined);
      expect(decodeProofValue(base58btc.encode(new Uint8Array(65).fill(7)))).to.equal(undefined);
      expect(decodeProofValue(`u${text.slice(1)}`)).to.equal(undefined);
      expect(decodeProofValue(`z0${text.slice(2)}`)).to.equal(undefined);
      expect(decodeProofValue(5)).to.equal(undefined);
    });
  });

  describe('isMap', () => {
    it('accepts an object and refuses null, an array, and a string', () => {
      expect(isMap({})).to.equal(true);
      expect(isMap(null)).to.equal(false);
      expect(isMap([])).to.equal(false);
      expect(isMap('a')).to.equal(false);
    });
  });

  describe('proofOptionsProblem and securedProofProblem', () => {
    const base = {
      type               : 'DataIntegrityProof',
      cryptosuite        : 'bip340-jcs-2025',
      verificationMethod : 'did:example:1#key-0',
      proofPurpose       : 'assertionMethod',
    };

    it('find no problem in valid proof options', () => {
      const proof = {
        ...base,
        id            : '#proof-1',
        created       : '2026-01-01T00:00:00Z',
        expires       : '2027-01-01T00:00:00+01:00',
        domain        : ['example.com'],
        challenge     : 'abc',
        nonce         : 'n',
        previousProof : ['urn:uuid:1']
      };
      expect(proofOptionsProblem(proof)).to.equal(undefined);
      expect(securedProofProblem(proof)).to.equal(undefined);
    });

    it('a verifier accepts an expires with no offset and leaves created to Proof Configuration', () => {
      const proof = { ...base, created: 'soon', expires: '2027-01-01T00:00:00' };
      expect(securedProofProblem(proof)).to.equal(undefined);
      expect(proofOptionsProblem(proof)).to.deep.equal({ member: 'created', rule: 'an XML Schema dateTimeStamp' });
      expect(proofOptionsProblem({ ...base, expires: '2027-01-01T00:00:00' }))
        .to.deep.equal({ member: 'expires', rule: 'an XML Schema dateTimeStamp' });
      expect(securedProofProblem({ ...base, expires: 'soon' }))
        .to.deep.equal({ member: 'expires', rule: 'an XML Schema dateTime' });
    });

    it('gives the first problem in member order', () => {
      expect(proofOptionsProblem({ ...base, type: undefined, nonce: 7 }))
        .to.deep.equal({ member: 'type', rule: 'a string' });
      expect(proofOptionsProblem({ ...base, domain: ['a', 5], nonce: 7 }))
        .to.deep.equal({ member: 'domain', rule: 'a string or an array of strings with no repeated string' });
    });

    it('a creator refuses a domain array with a repeated string; a verifier reads it as a set', () => {
      const rule = 'a string or an array of strings with no repeated string';
      expect(proofOptionsProblem({ ...base, domain: ['a.example', 'a.example'] })).to.deep.equal({ member: 'domain', rule });
      expect(proofOptionsProblem({ ...base, domain: ['a.example', 'b.example', 'a.example'] })).to.deep.equal({ member: 'domain', rule });
      expect(proofOptionsProblem({ ...base, domain: ['a.example', 'b.example'] })).to.equal(undefined);
      expect(proofOptionsProblem({ ...base, domain: [] })).to.equal(undefined);
      expect(securedProofProblem({ ...base, domain: ['a.example', 'a.example'] })).to.equal(undefined);
    });

    it('reads null as a value that is present', () => {
      expect(proofOptionsProblem({ ...base, challenge: null }))
        .to.deep.equal({ member: 'challenge', rule: 'a string' });
    });
  });
});
