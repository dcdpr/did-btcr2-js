import { messageText } from '../src/message-text.js';
import { expect } from './helpers.js';

/**
 * messageText gives the text of a primitive value for an error message, and no text for an
 * object or a function (ADR 156).
 */
describe('messageText', () => {
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
