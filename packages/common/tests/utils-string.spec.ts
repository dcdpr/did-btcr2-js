import { expect } from 'chai';
import { chop, replaceEnd, toSnake, toSnakeScream } from '../src/index.js';

describe('utils/string', () => {
  it('converts to snake and SCREAMING_SNAKE', () => {
    expect(toSnake('HelloWorld')).to.equal('hello_world');
    expect(toSnakeScream('HelloWorld')).to.equal('HELLO_WORLD');
  });

  it('chops last character', () => {
    expect(chop('abc')).to.equal('ab');
    expect(chop('')).to.equal('');
  });

  it('replaces end with string or regex', () => {
    expect(replaceEnd('hello/', '/')).to.equal('hello');
    expect(replaceEnd('hello123', /\d+$/, '456')).to.equal('hello456');
  });
});
