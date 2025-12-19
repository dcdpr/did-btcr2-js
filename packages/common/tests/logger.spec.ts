import { expect } from 'chai';
import { Logger } from '../src/index.js';

describe('Logger', () => {
  const originalConsole = { ...console };

  afterEach(() => {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
  });

  it('honors level filtering and returns this', () => {
    let called = '';
    console.info = (msg?: any) => { called = String(msg); };
    const logger = new Logger('test', { levels: ['info'], useColors: false });
    const returned = logger.info('hello');
    expect(returned).to.equal(logger);
    expect(called).to.contain('info');
  });

  it('respects useColors override to disable color functions', () => {
    let captured = '';
    console.warn = (msg?: any) => { captured = String(msg); };
    const logger = new Logger('test', { levels: ['warn'], useColors: false });
    logger.warn('colorless');
    expect(captured).to.contain('colorless');
  });
});
