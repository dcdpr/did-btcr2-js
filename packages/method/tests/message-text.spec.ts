import { expect } from 'chai';
import { gotValue, messageText } from '../src/utils/message-text.js';

/**
 * messageText gives the text of a primitive value for an error message, and no text for an
 * object or a function (ADR 156).
 */
describe('messageText', () => {
  it('gives String(value) for each primitive value', () => {
    const symbol = Symbol('s');
    const cases: Array<[ unknown, string ]> = [
      [ 'abc', 'abc' ],
      [ '', '' ],
      [ 42, '42' ],
      [ Number.NaN, 'NaN' ],
      [ 10n, '10' ],
      [ true, 'true' ],
      [ undefined, 'undefined' ],
      [ null, 'null' ],
      [ symbol, 'Symbol(s)' ],
    ];
    for(const [ value, text ] of cases) {
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
    for(const value of values) {
      expect(messageText(value)).to.equal(undefined);
    }
  });
});

/** gotValue gives the end of an option message: a string in quotes, another primitive as is. */
describe('gotValue', () => {
  it('gives the text of a primitive value, a string in quotes', () => {
    expect(gotValue('x')).to.equal(', got "x"');
    expect(gotValue('')).to.equal(', got ""');
    expect(gotValue(5)).to.equal(', got 5');
    expect(gotValue(null)).to.equal(', got null');
    expect(gotValue(undefined)).to.equal(', got undefined');
  });

  it('gives no text for an object or a function', () => {
    for(const value of [ {}, [], Object.create(null), () => 1 ]) expect(gotValue(value)).to.equal('');
  });
});
