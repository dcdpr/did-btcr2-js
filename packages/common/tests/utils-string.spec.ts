import { expect } from 'chai';
import { StringUtils } from '../src/index.js';

describe('utils/string', () => {
  it('converts to snake and SCREAMING_SNAKE', () => {
    expect(StringUtils.toSnake('HelloWorld')).to.equal('hello_world');
    expect(StringUtils.toSnakeScream('HelloWorld')).to.equal('HELLO_WORLD');
  });

  it('chops last character', () => {
    expect(StringUtils.chop('abc')).to.equal('ab');
    expect(StringUtils.chop('')).to.equal('');
  });

  it('replaces end with string or regex', () => {
    expect(StringUtils.replaceEnd('hello/', '/')).to.equal('hello');
    expect(StringUtils.replaceEnd('hello123', /\d+$/, '456')).to.equal('hello456');
  });
});
