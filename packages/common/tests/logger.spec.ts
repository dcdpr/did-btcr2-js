import { expect } from 'chai';
import { Logger, type Level } from '../src/index.js';

describe('Logger', () => {
  const originalConsole = { ...console };
  const originalLogColors = process.env.LOG_COLORS;
  const hadShared = Object.prototype.hasOwnProperty.call(Logger, 'shared');
  const originalShared = (Logger as any).shared;
  const allLevels: Level[] = ['debug', 'error', 'info', 'log', 'warn', 'security'];

  const restoreConsole = () => {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
  };

  const restoreLogColors = () => {
    if (originalLogColors === undefined) {
      delete process.env.LOG_COLORS;
    } else {
      process.env.LOG_COLORS = originalLogColors;
    }
  };

  const restoreShared = () => {
    if (!hadShared) {
      delete (Logger as any).shared;
    } else {
      (Logger as any).shared = originalShared;
    }
  };

  const captureConsole = () => {
    const calls: Record<string, string[]> = {
      log   : [],
      info  : [],
      warn  : [],
      error : [],
      debug : [],
    };
    const record = (store: string[]) => (...args: unknown[]) => {
      store.push(args.length ? args.map(arg => String(arg)).join(' ') : '');
    };
    console.log = record(calls.log);
    console.info = record(calls.info);
    console.warn = record(calls.warn);
    console.error = record(calls.error);
    console.debug = record(calls.debug);
    return calls;
  };

  beforeEach(() => {
    process.env.LOG_COLORS = '0';
  });

  afterEach(() => {
    restoreConsole();
    restoreLogColors();
    restoreShared();
  });

  it('formats and routes instance log output across levels', () => {
    const calls = captureConsole();
    const logger = new Logger('test', { levels: allLevels });

    logger.debug('dbg');
    logger.info('info');
    logger.warn('warn');
    logger.security('security');
    logger.error('error');
    logger.log('log');

    expect(calls.debug).to.have.length(1);
    expect(calls.info).to.have.length(1);
    expect(calls.warn).to.have.length(2);
    expect(calls.error).to.have.length(1);
    expect(calls.log).to.have.length(1);
    expect(calls.info[0]).to.match(/^\d{4}-\d{2}-\d{2}T/);
    expect(calls.info[0]).to.include('[test]');
    expect(calls.info[0]).to.include('info:');
  });

  it('emits newlines and preserves chaining', () => {
    const calls = captureConsole();
    const logger = new Logger('test', { levels: allLevels });
    const returned = logger.newline();
    expect(returned).to.equal(logger);
    expect(calls.log).to.have.length(1);
  });

  it('proxies static helpers through the shared instance', () => {
    const calls = captureConsole();
    (Logger as any).shared = new Logger('static', { levels: allLevels });

    Logger.debug('dbg');
    Logger.info('info');
    Logger.warn('warn');
    Logger.security('security');
    Logger.error('error');
    Logger.log('log');
    Logger.newline();

    expect(calls.debug).to.have.length(1);
    expect(calls.info).to.have.length(1);
    expect(calls.warn).to.have.length(2);
    expect(calls.error).to.have.length(1);
    expect(calls.log).to.have.length(2);
    expect(calls.info[0]).to.include('[static]');
  });

  it('detects non-shared instance and creates one', () => {
    const calls = captureConsole();
    restoreShared();

    Logger.info('info');

    expect(calls.info).to.have.length(1);
    expect(calls.info[0]).to.include('info:');
  });
});
