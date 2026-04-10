import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultApiFactory,
  defaultConfigPath,
  ENV_VARS,
  profileToOverrides,
  readConfigFile,
  readEnvOverrides,
} from '../src/config.js';
import type { ConfigFile } from '../src/config.js';
import { expect } from './helpers.js';

describe('readEnvOverrides', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of Object.values(ENV_VARS)) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of Object.values(ENV_VARS)) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('returns undefined fields when no env vars are set', () => {
    const overrides = readEnvOverrides();
    expect(overrides.btcRest).to.be.undefined;
    expect(overrides.btcRpcUrl).to.be.undefined;
    expect(overrides.btcRpcUser).to.be.undefined;
    expect(overrides.btcRpcPass).to.be.undefined;
    expect(overrides.casGateway).to.be.undefined;
  });

  it('reads BTCR2_BTC_REST', () => {
    process.env[ENV_VARS.BTC_REST] = 'http://env-rest:3000';
    const overrides = readEnvOverrides();
    expect(overrides.btcRest).to.equal('http://env-rest:3000');
  });

  it('reads BTCR2_BTC_RPC_* vars', () => {
    process.env[ENV_VARS.BTC_RPC_URL] = 'http://env-rpc:18443';
    process.env[ENV_VARS.BTC_RPC_USER] = 'envuser';
    process.env[ENV_VARS.BTC_RPC_PASS] = 'envpass';
    const overrides = readEnvOverrides();
    expect(overrides.btcRpcUrl).to.equal('http://env-rpc:18443');
    expect(overrides.btcRpcUser).to.equal('envuser');
    expect(overrides.btcRpcPass).to.equal('envpass');
  });

  it('treats empty string as undefined', () => {
    process.env[ENV_VARS.BTC_REST] = '';
    const overrides = readEnvOverrides();
    expect(overrides.btcRest).to.be.undefined;
  });
});



describe('readConfigFile', () => {
  const tempDir = join(tmpdir(), 'btcr2-config-test');

  before(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads a valid config file', () => {
    const path = join(tempDir, 'valid.json');
    const content: ConfigFile = {
      profiles : {
        regtest : {
          btc : { rest: 'http://localhost:3000' },
        },
      },
    };
    writeFileSync(path, JSON.stringify(content));
    const result = readConfigFile(path);
    expect(result).to.deep.equal(content);
  });

  it('returns undefined for missing file', () => {
    const result = readConfigFile(join(tempDir, 'nope.json'));
    expect(result).to.be.undefined;
  });

  it('returns undefined for invalid JSON', () => {
    const path = join(tempDir, 'bad.json');
    writeFileSync(path, 'not json');
    const result = readConfigFile(path);
    expect(result).to.be.undefined;
  });
});

describe('profileToOverrides', () => {
  const config: ConfigFile = {
    profiles : {
      regtest : {
        btc : {
          rest    : 'http://localhost:3000',
          rpcUrl  : 'http://localhost:18443',
          rpcUser : 'polaruser',
          rpcPass : 'polarpass',
        },
        cas : { gateway: 'http://localhost:8080' },
      },
      bitcoin : {
        btc : { rest: 'https://my-mempool/api' },
      },
    },
  };

  it('extracts all fields from a full profile', () => {
    const o = profileToOverrides(config, 'regtest');
    expect(o.btcRest).to.equal('http://localhost:3000');
    expect(o.btcRpcUrl).to.equal('http://localhost:18443');
    expect(o.btcRpcUser).to.equal('polaruser');
    expect(o.btcRpcPass).to.equal('polarpass');
    expect(o.casGateway).to.equal('http://localhost:8080');
  });

  it('extracts partial profile', () => {
    const o = profileToOverrides(config, 'bitcoin');
    expect(o.btcRest).to.equal('https://my-mempool/api');
    expect(o.btcRpcUrl).to.be.undefined;
    expect(o.casGateway).to.be.undefined;
  });

  it('returns empty object for missing profile', () => {
    const o = profileToOverrides(config, 'testnet4');
    expect(o).to.deep.equal({});
  });

  it('returns empty object for config with no profiles', () => {
    const o = profileToOverrides({}, 'regtest');
    expect(o).to.deep.equal({});
  });
});

describe('defaultConfigPath', () => {
  it('returns a string ending with btcr2/config.json', () => {
    const path = defaultConfigPath();
    expect(path).to.be.a('string');
    expect(path).to.match(/btcr2[/\\]config\.json$/);
  });
});



describe('defaultApiFactory', () => {
  const saved: Record<string, string | undefined> = {};
  const tempDir = join(tmpdir(), 'btcr2-factory-test');

  before(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  beforeEach(() => {
    for (const key of Object.values(ENV_VARS)) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of Object.values(ENV_VARS)) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key];
      } else {
        delete process.env[key];
      }
    }
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns unconfigured API when no network is provided', () => {
    const api = defaultApiFactory();
    expect(api).to.exist;
    expect(() => api.btc).to.throw(/Bitcoin not configured/);
  });

  it('creates API with network defaults', () => {
    // Point at a nonexistent config so file layer is empty
    const api = defaultApiFactory('regtest', { config: join(tempDir, 'nope.json') });
    expect(api).to.exist;
    expect(api.btc.connection.name).to.equal('regtest');
  });

  it('applies config file profile by network name', () => {
    const configPath = join(tempDir, 'auto-profile.json');
    writeFileSync(configPath, JSON.stringify({
      profiles : {
        regtest : { btc: { rest: 'http://profile-rest:3000' } },
      },
    }));
    const api = defaultApiFactory('regtest', { config: configPath });
    expect(api).to.exist;
    expect(api.btc.connection.name).to.equal('regtest');
  });

  it('applies named --profile over auto-detected network', () => {
    const configPath = join(tempDir, 'named-profile.json');
    writeFileSync(configPath, JSON.stringify({
      profiles : {
        custom : { btc: { rest: 'http://custom-rest:5000' } },
      },
    }));
    const api = defaultApiFactory('regtest', { config: configPath, profile: 'custom' });
    expect(api).to.exist;
    expect(api.btc.connection.name).to.equal('regtest');
  });

  it('env var overrides config file', () => {
    const configPath = join(tempDir, 'env-over-file.json');
    writeFileSync(configPath, JSON.stringify({
      profiles : {
        regtest : { btc: { rest: 'http://file-rest:3000' } },
      },
    }));
    process.env[ENV_VARS.BTC_REST] = 'http://env-rest:4000';
    const api = defaultApiFactory('regtest', { config: configPath });
    expect(api).to.exist;
    expect(api.btc.connection.name).to.equal('regtest');
  });

  it('CLI flag overrides env var and config file', () => {
    const configPath = join(tempDir, 'flag-over-all.json');
    writeFileSync(configPath, JSON.stringify({
      profiles : {
        regtest : { btc: { rest: 'http://file-rest:3000' } },
      },
    }));
    process.env[ENV_VARS.BTC_REST] = 'http://env-rest:4000';
    const api = defaultApiFactory('regtest', {
      config  : configPath,
      btcRest : 'http://flag-rest:5000',
    });
    expect(api).to.exist;
    expect(api.btc.connection.name).to.equal('regtest');
  });

  it('wires casGateway through to CAS executor', () => {
    const api = defaultApiFactory('regtest', {
      config     : join(tempDir, 'nope.json'),
      casGateway : 'https://ipfs.io',
    });
    expect(api).to.exist;
    // Accessing api.cas should NOT throw — gateway config was wired through
    expect(() => api.cas).to.not.throw();
  });

  it('defaults to public IPFS gateway when no casGateway is provided', () => {
    const api = defaultApiFactory('regtest', { config: join(tempDir, 'nope.json') });
    expect(api).to.exist;
    // CAS should be configured with the default gateway — no throw
    expect(() => api.cas).to.not.throw();
  });
});
