import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultConfigPath,
  defaultKeystorePath,
  platformDefaultHome,
  resolveHome,
} from '../src/paths.js';
import { expect } from './helpers.js';

/** Env keys these tests mutate, restored to their captured values after each case. */
const ENV_KEYS = [ 'BTCR2_HOME', 'APPDATA', 'LOCALAPPDATA', 'HOME' ];

describe('paths / home resolution (ADR 079)', () => {
  const saved: Record<string, string | undefined> = {};
  const originalPlatform = process.platform;
  let dir: string;

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
    dir = mkdtempSync(join(tmpdir(), 'btcr2-paths-'));
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    rmSync(dir, { recursive: true, force: true });
  });

  describe('resolveHome precedence', () => {
    it('--home wins over $BTCR2_HOME and the default', () => {
      process.env.BTCR2_HOME = join(dir, 'env');
      expect(resolveHome({ home: join(dir, 'flag') })).to.equal(join(dir, 'flag'));
    });

    it('$BTCR2_HOME wins over the default', () => {
      process.env.BTCR2_HOME = join(dir, 'env');
      expect(resolveHome()).to.equal(join(dir, 'env'));
    });

    it('a blank --home defers to $BTCR2_HOME', () => {
      process.env.BTCR2_HOME = join(dir, 'env');
      expect(resolveHome({ home: '   ' })).to.equal(join(dir, 'env'));
    });

    it('a blank $BTCR2_HOME defers to the platform default', () => {
      process.env.BTCR2_HOME = '';
      process.env.HOME = dir;
      expect(resolveHome()).to.equal(join(dir, '.btcr2'));
    });
  });

  describe('platformDefaultHome', () => {
    it('is ~/.btcr2 off Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      process.env.HOME = dir;
      expect(platformDefaultHome()).to.equal(join(dir, '.btcr2'));
    });

    it('is %LOCALAPPDATA%\\btcr2 on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      process.env.LOCALAPPDATA = dir;
      expect(platformDefaultHome()).to.equal(join(dir, 'btcr2'));
    });

    it('falls back to %APPDATA%\\btcr2 on Windows without LOCALAPPDATA', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      process.env.APPDATA = dir;
      expect(platformDefaultHome()).to.equal(join(dir, 'btcr2'));
    });
  });

  describe('config and keystore both derive from the home', () => {
    it('colocates config.json and keystore.json under a home override', () => {
      expect(defaultConfigPath({ home: dir })).to.equal(join(dir, 'config.json'));
      expect(defaultKeystorePath({ home: dir })).to.equal(join(dir, 'keystore.json'));
    });
  });
});
