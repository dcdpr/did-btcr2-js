import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { runInNewContext } from 'node:vm';
import {
  canonicalize,
  canonicalHash,
  canonicalHashBytes,
  CanonicalizationError,
  decode,
  encode,
  hash,
} from '../src/index.js';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('canonicalization', () => {
  const simpleObject = { b: 2, a: 1 };
  const complexObject = {
    z : [3, 2, 1],
    a : {
      d : 'string',
      c : 42,
      b : [true, false],
    },
    m : null,
  };
  const canonicalComplexObject = '{"a":{"b":[true,false],"c":42,"d":"string"},"m":null,"z":[3,2,1]}';
  const hashComplexObject = Uint8Array.from(
    Buffer.from('6a5e300f065a6541f9cd3deec24ba4caed6d5a2a3b219f16e9357459ffa01938', 'hex')
  );

  it('throws on unsupported algorithm', () => {
    expect(() => canonicalize({}, 'rdfc' as any))
      .to.throw(CanonicalizationError, 'Unsupported algorithm');
  });

  it('throws on unsupported encoding', () => {
    expect(() => encode(new Uint8Array(32), 'base64' as any))
      .to.throw(CanonicalizationError, 'Unsupported encoding');
  });

  it('canonicalizes with JCS by default (base64urlnopad encoding)', () => {
    const result = canonicalHash(simpleObject);
    const again = canonicalHash(simpleObject);
    expect(result).to.equal(again);
    expect(result).to.equal('QyWM_3g_5wNtikMDP4MK38YOwDc4JHNUisdCuIgpJ3c');
  });

  it('supports base58 encoding', () => {
    const base58 = canonicalHash(simpleObject, { encoding: 'base58' });
    expect(base58).to.equal('5X7XVwWA1NrC4JcuT7teDrhYpVQNA9LhHR3s2Ci6XUWz');
  });

  it('supports base64urlnopad encoding', () => {
    const base64url = canonicalHash(simpleObject, { encoding: 'base64urlnopad' });
    expect(base64url).to.equal('QyWM_3g_5wNtikMDP4MK38YOwDc4JHNUisdCuIgpJ3c');
  });

  it('throws on unsupported algorithms', () => {
    expect(() => canonicalHash(simpleObject, { algorithm: 'rdfc' as any }))
      .to.throw(CanonicalizationError, 'Unsupported algorithm');
  });

  it('validates algorithm and encoding through public API', () => {
    expect(() => canonicalize({}, 'jcs')).to.not.throw();
    expect(() => encode(new Uint8Array(32), 'hex')).to.not.throw();
    expect(() => canonicalize({}, 'bad' as any)).to.throw(CanonicalizationError);
    expect(() => encode(new Uint8Array(32), 'bad' as any)).to.throw(CanonicalizationError);
  });

  it('produces a canonical hash for a complex object', () => {
    const result = hash(canonicalize(complexObject));
    expect(result).to.deep.equal(hashComplexObject);
  });

  it('produces a hex-encoded SHA-256 hash of a canonicalized object', () => {
    const result = encode(hash(canonicalComplexObject), 'hex');
    expect(result).to.equal('6a5e300f065a6541f9cd3deec24ba4caed6d5a2a3b219f16e9357459ffa01938');
  });

  it('produces a base58 encoded SHA-256 hash of a canonicalized object', () => {
    const result = encode(hash(canonicalComplexObject), 'base58');
    expect(result).to.equal('8ADWw43bTgn9z3n7NjuzrM1GfJa1aNCaaK4RJpwe3sCK');
  });

  it('produces a base64urlnopad encoded SHA-256 hash of a canonicalized object', () => {
    const result = encode(hash(canonicalComplexObject), 'base64urlnopad');
    expect(result).to.equal('al4wDwZaZUH5zT3uwkukyu1tWio7IZ8W6TV0Wf-gGTg');
  });

  it('encodes and decodes hash bytes round-trip', () => {
    const hexEncoded = encode(hashComplexObject, 'hex');
    expect(hexEncoded).to.equal('6a5e300f065a6541f9cd3deec24ba4caed6d5a2a3b219f16e9357459ffa01938');
    expect(decode(hexEncoded, 'hex')).to.deep.equal(hashComplexObject);

    const b58Encoded = encode(hashComplexObject, 'base58');
    expect(b58Encoded).to.equal('8ADWw43bTgn9z3n7NjuzrM1GfJa1aNCaaK4RJpwe3sCK');
    expect(decode(b58Encoded, 'base58')).to.deep.equal(hashComplexObject);

    const b64urlEncoded = encode(hashComplexObject, 'base64urlnopad');
    expect(b64urlEncoded).to.equal('al4wDwZaZUH5zT3uwkukyu1tWio7IZ8W6TV0Wf-gGTg');
    expect(decode(b64urlEncoded, 'base64urlnopad')).to.deep.equal(hashComplexObject);
  });
});

describe('RFC 8785 conformance (ADR 154)', () => {
  /** Runs the function and gives the CanonicalizationError that it raises. */
  function caught(run: () => unknown): CanonicalizationError {
    try {
      run();
    } catch (error) {
      if (error instanceof CanonicalizationError) return error;
      throw error;
    }
    throw new Error('Expected a CanonicalizationError');
  }

  const LONE_SURROGATE = /\p{Cs}/u;

  it('sorts an object with a data member named toJSON', () => {
    expect(canonicalize({ z: 1, toJSON: 'x', a: { d: 1, c: 2 } }))
      .to.equal('{"a":{"c":2,"d":1},"toJSON":"x","z":1}');
  });

  it('sorts a nested object with a toJSON member of each JSON type', () => {
    const cases: Array<[unknown, string]> = [
      ['', '""'], ['x', '"x"'], [0, '0'], [1, '1'], [false, 'false'], [true, 'true'], [null, 'null'],
      [{}, '{}'], [{ b: 2, a: 1 }, '{"a":1,"b":2}'], [[2, 1], '[2,1]'],
    ];
    for (const [value, text] of cases) {
      expect(canonicalize({ s: [{ z: 1, toJSON: value, a: { d: 1, c: 2 } }] }))
        .to.equal(`{"s":[{"a":{"c":2,"d":1},"toJSON":${text},"z":1}]}`);
    }
  });

  it('gives one text for two member orders of an object with a toJSON member', () => {
    const first = { service: [{ z: 1, toJSON: 'x', a: { d: 1, c: 2 } }] };
    const second = { service: [{ a: { c: 2, d: 1 }, toJSON: 'x', z: 1 }] };
    expect(canonicalize(first)).to.equal(canonicalize(second));
    expect(canonicalHash(first)).to.equal(canonicalHash(second));
  });

  it('sorts a class instance whose own toJSON property is data', () => {
    class Holder {
      z = 1;
      toJSON = 'data';
      a = 2;
    }
    expect(canonicalize(new Holder())).to.equal('{"a":2,"toJSON":"data","z":1}');
  });

  it('gives the JSON form of a toJSON method, a Date, and a Uint8Array', () => {
    class Doc {
      z = 2;
      a = 1;
      toJSON(): object {
        return { b: this.z, a: this.a };
      }
    }
    expect(canonicalize({ doc: new Doc(), date: new Date(0), bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) }))
      .to.equal(
        '{"bytes":{"0":1,"1":2,"10":11,"2":3,"3":4,"4":5,"5":6,"6":7,"7":8,"8":9,"9":10},'
        + '"date":"1970-01-01T00:00:00.000Z","doc":{"a":1,"b":2}}'
      );
  });

  it('refuses NaN, Infinity, and -Infinity with NON_FINITE_NUMBER and the JSON Pointer', () => {
    const cases: Array<[unknown, string, string]> = [
      [NaN, '', 'the number NaN at the top level'],
      [{ a: Infinity }, '/a', 'the number Infinity at /a'],
      [[1, -Infinity], '/1', 'the number -Infinity at /1'],
      [{ a: [{ b: NaN }] }, '/a/0/b', 'the number NaN at /a/0/b'],
      [{ '': NaN }, '/', 'the number NaN at /'],
    ];
    for (const [value, path, text] of cases) {
      const error = caught(() => canonicalize(value as Record<string, unknown>));
      expect(error.type).to.equal('NON_FINITE_NUMBER');
      expect(error.data).to.deep.equal({ path });
      expect(error.message).to.equal(`Cannot canonicalize: ${text} is not a JSON number (RFC 8785 section 3.2.2.3).`);
    }
  });

  it('refuses a non-finite number in toJSON output, in a Number object, and in parsed text such as 1e400', () => {
    const cases: Array<[unknown, string, string]> = [
      [{ inner: { toJSON: (): object => ({ v: NaN }) } }, '/inner/v', 'NaN at /inner/v'],
      [{ n: Object(-Infinity) }, '/n', '-Infinity at /n'],
      [JSON.parse('{"a":[1e400]}'), '/a/0', 'Infinity at /a/0'],
    ];
    for (const [value, path, text] of cases) {
      const error = caught(() => canonicalize(value as Record<string, unknown>));
      expect(error.type).to.equal('NON_FINITE_NUMBER');
      expect(error.data).to.deep.equal({ path });
      expect(error.message).to.equal(`Cannot canonicalize: the number ${text} is not a JSON number (RFC 8785 section 3.2.2.3).`);
    }
  });

  it('refuses a non-finite Number object with a changed tag, a changed valueOf, or another realm', () => {
    const tagged = Object(NaN);
    tagged[Symbol.toStringTag] = 'X';
    class Tagged extends Number {
      get [Symbol.toStringTag](): string {
        return 'T';
      }
    }
    const cases: unknown[] = [tagged, new Tagged(Infinity), runInNewContext('Object(-Infinity)')];
    for (const value of cases) {
      const error = caught(() => canonicalize({ n: value }));
      expect(error.type).to.equal('NON_FINITE_NUMBER');
      expect(error.data).to.deep.equal({ path: '/n' });
    }
    expect(canonicalize({ n: runInNewContext('Object(2)') })).to.equal('{"n":2}');
    // The check and the output read the number one time, so a second read cannot write NaN as null.
    let calls = 0;
    const changing = Object(1);
    changing.valueOf = (): number => (calls++ === 0 ? 1 : NaN);
    expect(canonicalize({ n: changing })).to.equal('{"n":1}');
    expect(calls).to.equal(1);
  });

  it('accepts an object with the Number prototype or tag but no number value', () => {
    expect(canonicalize({ x: Object.create(Number.prototype) })).to.equal('{"x":{}}');
    expect(canonicalize({ x: { [Symbol.toStringTag]: 'Number' } })).to.equal('{"x":{}}');
  });

  it('refuses a number that raw JSON text gives as Infinity', function () {
    const rawJSON = (JSON as unknown as { rawJSON?: (text: string) => unknown }).rawJSON;
    if (!rawJSON) this.skip();
    const error = caught(() => canonicalize({ r: [rawJSON('1e400')] }));
    expect(error.type).to.equal('NON_FINITE_NUMBER');
    expect(error.data).to.deep.equal({ path: '/r/0' });
  });

  it('refuses a lone surrogate in a string with LONE_SURROGATE and the JSON Pointer', () => {
    const cases: Array<[unknown, string, string]> = [
      ['\ud800', '', 'the top level'],
      [{ note: 'a\ud800b' }, '/note', '/note'],
      [{ note: 'a\udc00' }, '/note', '/note'],
      [{ list: ['ok', '\udfff'] }, '/list/1', '/list/1'],
      [{ list: ['\ude00\ud83d'] }, '/list/0', '/list/0'],
    ];
    for (const [value, path, where] of cases) {
      const error = caught(() => canonicalize(value as Record<string, unknown>));
      expect(error.type).to.equal('LONE_SURROGATE');
      expect(error.data).to.deep.equal({ path });
      expect(error.message)
        .to.equal(`Cannot canonicalize: the string at ${where} has a lone surrogate (RFC 8785 section 3.2.2.2).`);
    }
  });

  it('refuses a lone surrogate in a String object', () => {
    const error = caught(() => canonicalize({ s: Object('a\ud800') }));
    expect(error.type).to.equal('LONE_SURROGATE');
    expect(error.data).to.deep.equal({ path: '/s' });
  });

  it('refuses a lone surrogate in a member name and does not print the name', () => {
    const nested = caught(() => canonicalize({ s: [{ '\udead': 1 }] }));
    expect(nested.type).to.equal('LONE_SURROGATE');
    expect(nested.data).to.deep.equal({ path: '/s/0' });
    expect(nested.message).to.equal(
      'Cannot canonicalize: a member name in the object at /s/0 has a lone surrogate (RFC 8785 section 3.2.2.2).'
    );
    const top = caught(() => canonicalize({ '\ud800x': 1 }));
    expect(top.data).to.deep.equal({ path: '' });
    expect(LONE_SURROGATE.test(top.message)).to.equal(false);
  });

  it('prints each lone surrogate of the JSON Pointer as escape text', () => {
    const number = caught(() => canonicalize({ '\udead': { 'a/b~c': NaN } }));
    expect(number.data).to.deep.equal({ path: '/\\udead/a~1b~0c' });
    expect(number.message).to.contain('at /\\udead/a~1b~0c is not');
    expect(LONE_SURROGATE.test(number.message)).to.equal(false);
    const big = caught(() => canonicalize({ x: { '😀\ud800': [BigInt(1)] } }));
    expect(big.data).to.deep.equal({ path: '/x/😀\\ud800/0' });
    expect(LONE_SURROGATE.test(big.message)).to.equal(false);
  });

  it('accepts a surrogate pair and writes it as the character', () => {
    expect(canonicalize({ '😀': 'x😀' })).to.equal('{"😀":"x😀"}');
  });

  it('does not check a member that has no JSON form', () => {
    expect(canonicalize({ '\udead': undefined, a: 1, f: (): number => 1 })).to.equal('{"a":1}');
    expect(canonicalize([undefined, (): number => 1, Symbol('s')] as unknown as Record<string, unknown>))
      .to.equal('[null,null,null]');
  });

  it('refuses a BigInt and a BigInt object with NOT_JSON_DATA and the JSON Pointer', () => {
    for (const value of [BigInt(1), Object(BigInt(1))]) {
      const error = caught(() => canonicalize({ n: [value] }));
      expect(error.type).to.equal('NOT_JSON_DATA');
      expect(error.data).to.deep.equal({ path: '/n/0' });
      expect(error.message).to.equal('Cannot canonicalize: the value at /n/0 is a BigInt, not a JSON number.');
    }
  });

  it('refuses a cycle with NOT_JSON_DATA and the JSON Pointer', () => {
    const cycle: Record<string, unknown> = { a: {} };
    (cycle.a as Record<string, unknown>).b = cycle;
    const top = caught(() => canonicalize(cycle));
    expect(top.type).to.equal('NOT_JSON_DATA');
    expect(top.data).to.deep.equal({ path: '/a/b' });
    expect(top.message).to.equal(
      'Cannot canonicalize: the value at /a/b is the object at the top level, which contains it (a cycle).'
    );
    const inner: Record<string, unknown> = {};
    inner['\ud800'] = [inner];
    const named = caught(() => canonicalize({ '\udbff': inner }));
    expect(named.data).to.deep.equal({ path: '/\\udbff/\\ud800/0' });
    expect(named.message).to.equal(
      'Cannot canonicalize: the value at /\\udbff/\\ud800/0 is the object at /\\udbff, which contains it (a cycle).'
    );
    expect(LONE_SURROGATE.test(named.message)).to.equal(false);
    const holder: Record<string, unknown> = {};
    holder.a = { toJSON: (): unknown => holder };
    expect(caught(() => canonicalize(holder)).data).to.deep.equal({ path: '/a' });
  });

  it('accepts one object at two locations and checks each location', () => {
    const shared = { x: 1 };
    expect(canonicalize({ a: shared, ab: [shared, { c: shared }] }))
      .to.equal('{"a":{"x":1},"ab":[{"x":1},{"c":{"x":1}}]}');
    let reads = 0;
    const changing = {
      get v(): number {
        return reads++ === 0 ? 1 : NaN;
      },
    };
    const error = caught(() => canonicalize({ a: changing, b: changing }));
    expect(error.type).to.equal('NON_FINITE_NUMBER');
    expect(error.data).to.deep.equal({ path: '/b/v' });
  });

  it('passes an error from a toJSON method or a getter through unchanged', () => {
    const failure = new TypeError('toJSON failed');
    const fromMethod = { a: { toJSON: (): never => { throw failure; } } };
    expect(() => canonicalize(fromMethod)).to.throw(failure);
    const fromGetter = runInNewContext('({ get a() { return null.x; } })');
    expect(() => canonicalize(fromGetter)).to.throw().that.is.not.instanceOf(CanonicalizationError);
  });

  it('refuses a top-level value with no JSON form with NOT_JSON_DATA', () => {
    for (const value of [undefined, (): number => 1, Symbol('s')]) {
      const error = caught(() => canonicalize(value as unknown as Record<string, unknown>));
      expect(error.type).to.equal('NOT_JSON_DATA');
      expect(error.data).to.deep.equal({ path: '' });
      expect(error.message).to.equal('Cannot canonicalize: the value at the top level has no JSON form.');
    }
  });

  it('raises the same errors from canonicalHash and canonicalHashBytes', () => {
    for (const run of [canonicalHash, canonicalHashBytes]) {
      expect(caught(() => run({ a: NaN })).type).to.equal('NON_FINITE_NUMBER');
      expect(caught(() => run({ a: '\ud800' })).type).to.equal('LONE_SURROGATE');
      expect(caught(() => run({ a: BigInt(2) })).type).to.equal('NOT_JSON_DATA');
    }
  });

  it('checks the JSON form in input order before the text in sorted order', function () {
    expect(caught(() => canonicalize({ a: '\ud800', b: NaN })).type).to.equal('NON_FINITE_NUMBER');
    expect(caught(() => canonicalize({ b: NaN, a: Infinity })).data).to.deep.equal({ path: '/b' });
    expect(caught(() => canonicalize({ b: '\ud800', a: '\udc00' })).data).to.deep.equal({ path: '/a' });
    const rawJSON = (JSON as unknown as { rawJSON?: (text: string) => unknown }).rawJSON;
    if (!rawJSON) this.skip();
    const error = caught(() => canonicalize({ a: '\ud800', b: rawJSON('1e400') }));
    expect(error.type).to.equal('LONE_SURROGATE');
    expect(error.data).to.deep.equal({ path: '/a' });
  });

  it('gives the RFC 8785 section 3.2.3 text for the section 3.2.2 sample', () => {
    const sample = String.raw`{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],`
      + String.raw`"string":"\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/","literals":[null,true,false]}`;
    const expected = String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],`
      + String.raw`"string":"€$\u000f\nA'B\"\\\\\"/"}`;
    expect(canonicalize(JSON.parse(sample))).to.equal(expected);
  });

  it('sorts member names by UTF-16 code units', () => {
    const data = JSON.parse(String.raw`{"\u20ac":"Euro Sign","\r":"Carriage Return",`
      + String.raw`"\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One","\ud83d\ude00":"Emoji: Grinning Face",`
      + String.raw`"\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis"}`);
    expect(canonicalize(data).match(/"[^"]+"(?=[,}])/g)).to.deep.equal([
      '"Carriage Return"', '"One"', '"Control"', '"Latin Small Letter O With Diaeresis"', '"Euro Sign"',
      '"Emoji: Grinning Face"', '"Hebrew Letter Dalet With Dagesh"',
    ]);
    expect(canonicalize({ ab: 1, aa: 2, a: 3, '': 4, '10': 5, '2': 6 })).to.equal('{"":4,"10":5,"2":6,"a":3,"aa":2,"ab":1}');
  });

  it('writes the numbers of RFC 8785 Appendix B', () => {
    const table: Array<[string, string | undefined]> = [
      ['0000000000000000', '0'], ['8000000000000000', '0'], ['0000000000000001', '5e-324'],
      ['8000000000000001', '-5e-324'], ['7fefffffffffffff', '1.7976931348623157e+308'],
      ['ffefffffffffffff', '-1.7976931348623157e+308'], ['4340000000000000', '9007199254740992'],
      ['c340000000000000', '-9007199254740992'], ['4430000000000000', '295147905179352830000'],
      ['7fffffffffffffff', undefined], ['7ff0000000000000', undefined],
      ['44b52d02c7e14af5', '9.999999999999997e+22'], ['44b52d02c7e14af6', '1e+23'],
      ['44b52d02c7e14af7', '1.0000000000000001e+23'], ['444b1ae4d6e2ef4e', '999999999999999700000'],
      ['444b1ae4d6e2ef4f', '999999999999999900000'], ['444b1ae4d6e2ef50', '1e+21'],
      ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'], ['3eb0c6f7a0b5ed8d', '0.000001'],
      ['41b3de4355555553', '333333333.3333332'], ['41b3de4355555554', '333333333.33333325'],
      ['41b3de4355555555', '333333333.3333333'], ['41b3de4355555556', '333333333.3333334'],
      ['41b3de4355555557', '333333333.33333343'], ['becbf647612f3696', '-0.0000033333333333333333'],
      ['43143ff3c1cb0959', '1424953923781206.2'],
    ];
    for (const [ieee, text] of table) {
      const view = new DataView(new ArrayBuffer(8));
      view.setBigUint64(0, BigInt(`0x${ieee}`));
      const value = view.getFloat64(0);
      if (text === undefined) {
        expect(caught(() => canonicalize([value] as unknown as Record<string, unknown>)).type).to.equal('NON_FINITE_NUMBER');
      } else {
        expect(canonicalize([value] as unknown as Record<string, unknown>), ieee).to.equal(`[${text}]`);
      }
    }
  });

  it('keeps a __proto__ member as data and sorts it', () => {
    const parsed = JSON.parse('{"b":1,"__proto__":{"y":2,"x":1},"a":2}');
    expect(canonicalize(parsed)).to.equal('{"__proto__":{"x":1,"y":2},"a":2,"b":1}');
  });
});
