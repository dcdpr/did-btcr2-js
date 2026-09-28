import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { StaticFeeEstimator } from '@did-btcr2/method';
import {
  defaultApiFactory,
  defaultConfigPath,
  defaultsToOverrides,
  ENV_VARS,
  parseHeaderList,
  profileNetworkMismatch,
  profileToOverrides,
  readConfigFile,
  readEnvOverrides,
  resolveActiveProfile,
  resolveBroadcastOptions,
  resolveConnectionConfig,
  resolveDefaultNetwork,
  resolveKeystorePath,
  resolveOutputFormat,
  resolveSecretRef,
  resolveDefaultKeyRef,
} from '../src/config.js';
import type { ConfigFile } from '../src/config.js';
import { CLIError } from '../src/error.js';
import { defaultKeystorePath } from '../src/keystore/paths.js';
import { blankToUndef } from '../src/types.js';
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
    expect(overrides.casRpcUrl).to.be.undefined;
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

  it('reads BTCR2_CAS_GATEWAY and BTCR2_CAS_RPC_URL', () => {
    process.env[ENV_VARS.CAS_GATEWAY] = 'https://ipfs.io';
    process.env[ENV_VARS.CAS_RPC_URL] = 'http://127.0.0.1:5001';
    const overrides = readEnvOverrides();
    expect(overrides.casGateway).to.equal('https://ipfs.io');
    expect(overrides.casRpcUrl).to.equal('http://127.0.0.1:5001');
  });

  it('reads BTCR2_BTC_SIGNAL_DISCOVERY', () => {
    process.env[ENV_VARS.BTC_SIGNAL_DISCOVERY] = 'fullnode';
    expect(readEnvOverrides().btcSignalDiscovery).to.equal('fullnode');
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

  it('returns undefined only for a genuinely missing file (ENOENT)', () => {
    const result = readConfigFile(join(tempDir, 'nope.json'));
    expect(result).to.be.undefined;
  });

  it('throws (never silently undefined) for invalid JSON, naming the file', () => {
    const path = join(tempDir, 'bad.json');
    writeFileSync(path, 'not json');
    expect(() => readConfigFile(path)).to.throw(CLIError, /not valid JSON/);
    expect(() => readConfigFile(path)).to.throw(path);
  });

  it('reads a config whose schemaVersion is absent (migrated forward as earliest)', () => {
    const path = join(tempDir, 'no-version.json');
    writeFileSync(path, JSON.stringify({ profiles: { regtest: { btc: { rest: 'http://x' } } } }));
    const result = readConfigFile(path);
    expect(result?.profiles?.regtest?.btc?.rest).to.equal('http://x');
  });

  it('refuses a config written by a newer schema version', () => {
    const path = join(tempDir, 'future.json');
    writeFileSync(path, JSON.stringify({ schemaVersion: 9999, profiles: {} }));
    expect(() => readConfigFile(path)).to.throw(CLIError, /schemaVersion 9999/);
    expect(() => readConfigFile(path)).to.throw(/Upgrade/);
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
        cas : { gateway: 'http://localhost:8080', rpcUrl: 'http://localhost:5001' },
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
    expect(o.casRpcUrl).to.equal('http://localhost:5001');
  });

  it('extracts partial profile', () => {
    const o = profileToOverrides(config, 'bitcoin');
    expect(o.btcRest).to.equal('https://my-mempool/api');
    expect(o.btcRpcUrl).to.be.undefined;
    expect(o.casGateway).to.be.undefined;
    expect(o.casRpcUrl).to.be.undefined;
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

  it('wires casGateway through to a read-only CAS executor', () => {
    const api = defaultApiFactory('regtest', {
      config     : join(tempDir, 'nope.json'),
      casGateway : 'https://ipfs.io',
    });
    expect(api).to.exist;
    // Accessing api.cas should NOT throw - gateway config was wired through.
    // A gateway is read-only, so the CAS is not writable.
    expect(() => api.cas).to.not.throw();
    expect(api.cas.writable).to.equal(false);
  });

  it('defaults to public IPFS gateway (read-only) when no CAS is provided', () => {
    const api = defaultApiFactory('regtest', { config: join(tempDir, 'nope.json') });
    expect(api).to.exist;
    // CAS should be configured with the default gateway - no throw, not writable.
    expect(() => api.cas).to.not.throw();
    expect(api.cas.writable).to.equal(false);
  });

  it('wires casRpcUrl through to a writable CAS executor', () => {
    const api = defaultApiFactory('regtest', {
      config    : join(tempDir, 'nope.json'),
      casRpcUrl : 'http://127.0.0.1:5001',
    });
    expect(api).to.exist;
    // An IPFS RPC endpoint supports publishing, so the CAS is writable.
    expect(api.cas.writable).to.equal(true);
  });

  it('casRpcUrl takes precedence over casGateway and stays writable', () => {
    const api = defaultApiFactory('regtest', {
      config     : join(tempDir, 'nope.json'),
      casGateway : 'https://ipfs.io',
      casRpcUrl  : 'http://127.0.0.1:5001',
    });
    expect(api).to.exist;
    // Priority is rpcUrl > gateway, so the writable RPC executor wins.
    expect(api.cas.writable).to.equal(true);
  });

  it('wires cas.rpcUrl from the config-file profile', () => {
    const configPath = join(tempDir, 'cas-rpc-profile.json');
    writeFileSync(configPath, JSON.stringify({
      profiles : {
        regtest : { cas: { rpcUrl: 'http://127.0.0.1:5001' } },
      },
    }));
    const api = defaultApiFactory('regtest', { config: configPath });
    expect(api.cas.writable).to.equal(true);
  });

  it('env BTCR2_CAS_RPC_URL wires a writable CAS over a gateway-only config file', () => {
    const configPath = join(tempDir, 'cas-env-over-file.json');
    writeFileSync(configPath, JSON.stringify({
      profiles : {
        regtest : { cas: { gateway: 'https://ipfs.io' } },
      },
    }));
    process.env[ENV_VARS.CAS_RPC_URL] = 'http://127.0.0.1:5001';
    const api = defaultApiFactory('regtest', { config: configPath });
    expect(api.cas.writable).to.equal(true);
  });
});

describe('blankToUndef', () => {
  it('maps empty and whitespace-only strings to undefined', () => {
    expect(blankToUndef('')).to.be.undefined;
    expect(blankToUndef('   ')).to.be.undefined;
    expect(blankToUndef('\t\n')).to.be.undefined;
    expect(blankToUndef(undefined)).to.be.undefined;
  });

  it('passes a non-blank value through unchanged', () => {
    expect(blankToUndef('http://x')).to.equal('http://x');
  });
});

describe('defaultConfigPath / defaultKeystorePath (single home root, ADR 079)', () => {
  const keys = [ 'BTCR2_HOME', 'XDG_CONFIG_HOME', 'APPDATA', 'XDG_DATA_HOME', 'LOCALAPPDATA' ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] !== undefined) process.env[k] = saved[k]; else delete process.env[k];
    }
  });

  it('defaults the config to the platform home (~/.btcr2 off Windows) and ignores XDG_CONFIG_HOME', () => {
    process.env.XDG_CONFIG_HOME = join(tmpdir(), 'xdg-custom');
    const p = defaultConfigPath();
    expect(isAbsolute(p)).to.equal(true);
    expect(p).to.not.contain('xdg-custom');
    if (process.platform !== 'win32') expect(p).to.match(/[/\\]\.btcr2[/\\]config\.json$/);
  });

  it('colocates the keystore in the same home and ignores XDG_DATA_HOME', () => {
    process.env.XDG_DATA_HOME = join(tmpdir(), 'xdg-data');
    const p = defaultKeystorePath();
    expect(isAbsolute(p)).to.equal(true);
    expect(p).to.not.contain('xdg-data');
    if (process.platform !== 'win32') expect(p).to.match(/[/\\]\.btcr2[/\\]keystore\.json$/);
  });

  it('$BTCR2_HOME relocates both files as a unit', () => {
    process.env.BTCR2_HOME = join(tmpdir(), 'btcr2home');
    expect(defaultConfigPath()).to.equal(join(tmpdir(), 'btcr2home', 'config.json'));
    expect(defaultKeystorePath()).to.equal(join(tmpdir(), 'btcr2home', 'keystore.json'));
  });
});

describe('resolveKeystorePath blank handling (ADR 079)', () => {
  const keys = [ 'BTCR2_HOME', 'XDG_DATA_HOME', 'LOCALAPPDATA' ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => { for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; } });

  afterEach(() => { for (const k of keys) { if (saved[k] !== undefined) process.env[k] = saved[k]; else delete process.env[k]; } });

  it('an explicit --keystore wins', () => {
    expect(resolveKeystorePath({ keystore: '/explicit/ks.json' })).to.equal('/explicit/ks.json');
  });

  it('a blank --keystore defers to the home default instead of resolving to an empty path', () => {
    process.env.BTCR2_HOME = join(tmpdir(), 'ks-home');
    expect(resolveKeystorePath({ keystore: '   ' })).to.equal(join(tmpdir(), 'ks-home', 'keystore.json'));
  });
});

describe('resolveActiveProfile (unified profile/network resolution)', () => {
  it('derives the network from the profile network field', () => {
    const file: ConfigFile = { defaults: { profile: 'production' }, profiles: { production: { network: 'bitcoin' } } };
    expect(resolveActiveProfile(file)).to.deep.equal({ name: 'production', network: 'bitcoin' });
  });

  it('falls back to the profile name when it is itself a network name', () => {
    const file: ConfigFile = { defaults: { profile: 'signet' }, profiles: { signet: {} } };
    expect(resolveActiveProfile(file)).to.deep.equal({ name: 'signet', network: 'signet' });
  });

  it('yields an undefined network for a non-network-named profile with no network field', () => {
    const file: ConfigFile = { defaults: { profile: 'custom' }, profiles: { custom: {} } };
    expect(resolveActiveProfile(file)).to.deep.equal({ name: 'custom', network: undefined });
  });

  it('prefers an explicit --profile flag over defaults.profile', () => {
    const file: ConfigFile = {
      defaults : { profile: 'signet' },
      profiles : { signet: {}, staging: { network: 'testnet4' } },
    };
    expect(resolveActiveProfile(file, { profile: 'staging' })).to.deep.equal({ name: 'staging', network: 'testnet4' });
  });
});

describe('resolveDefaultNetwork / profileNetworkMismatch', () => {
  const tempDir = join(tmpdir(), 'btcr2-network-test');

  before(() => mkdirSync(tempDir, { recursive: true }));

  after(() => rmSync(tempDir, { recursive: true, force: true }));

  const writeCfg = (name: string, content: ConfigFile): string => {
    const p = join(tempDir, name);
    writeFileSync(p, JSON.stringify(content));
    return p;
  };

  it('returns the active profile network field when set (the two resolvers agree)', () => {
    const cfg = writeCfg('prod.json', { defaults: { profile: 'production' }, profiles: { production: { network: 'bitcoin' } } });
    expect(resolveDefaultNetwork({ config: cfg })).to.equal('bitcoin');
  });

  it('lets the active profile network win over defaults.network (ADR 131)', () => {
    const cfg = writeCfg('both.json', {
      defaults : { network: 'signet', profile: 'production' },
      profiles : { production: { network: 'bitcoin' } },
    });
    expect(resolveDefaultNetwork({ config: cfg })).to.equal('bitcoin');
  });

  it('lets the network of a --profile flag win over defaults.network', () => {
    const cfg = writeCfg('flag.json', {
      defaults : { network: 'signet' },
      profiles : { staging: { network: 'testnet4' } },
    });
    expect(resolveDefaultNetwork({ config: cfg, profile: 'staging' })).to.equal('testnet4');
  });

  it('uses defaults.network when the active profile declares no network', () => {
    const cfg = writeCfg('nonet-default.json', {
      defaults : { network: 'signet', profile: 'custom' },
      profiles : { custom: {} },
    });
    expect(resolveDefaultNetwork({ config: cfg })).to.equal('signet');
  });

  it('falls back to regtest with no config file', () => {
    expect(resolveDefaultNetwork({ config: join(tempDir, 'nope.json') })).to.equal('regtest');
  });

  it('flags a create-network / active-profile-network disagreement', () => {
    const cfg = writeCfg('mismatch.json', { defaults: { profile: 'production' }, profiles: { production: { network: 'bitcoin' } } });
    expect(profileNetworkMismatch('regtest', { config: cfg })).to.deep.equal({ profile: 'production', declared: 'bitcoin' });
  });

  it('returns undefined when the networks agree', () => {
    const cfg = writeCfg('agree.json', { defaults: { profile: 'production' }, profiles: { production: { network: 'bitcoin' } } });
    expect(profileNetworkMismatch('bitcoin', { config: cfg })).to.be.undefined;
  });

  it('returns undefined when the active profile declares no network', () => {
    const cfg = writeCfg('nonet.json', { defaults: { profile: 'custom' }, profiles: { custom: {} } });
    expect(profileNetworkMismatch('regtest', { config: cfg })).to.be.undefined;
  });
});

describe('resolveOutputFormat', () => {
  const tempDir = join(tmpdir(), 'btcr2-output-test');
  let savedOutput: string | undefined;

  before(() => mkdirSync(tempDir, { recursive: true }));

  after(() => rmSync(tempDir, { recursive: true, force: true }));

  beforeEach(() => { savedOutput = process.env.BTCR2_OUTPUT; delete process.env.BTCR2_OUTPUT; });

  afterEach(() => {
    if (savedOutput !== undefined) process.env.BTCR2_OUTPUT = savedOutput; else delete process.env.BTCR2_OUTPUT;
  });

  const writeCfg = (name: string, content: unknown): string => {
    const p = join(tempDir, name);
    writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
    return p;
  };

  it('lets the flag win over env and config', () => {
    const cfg = writeCfg('json-default.json', { defaults: { output: 'json' } });
    process.env.BTCR2_OUTPUT = 'json';
    expect(resolveOutputFormat({ output: 'text', config: cfg })).to.equal('text');
  });

  it('lets BTCR2_OUTPUT win over config defaults.output', () => {
    const cfg = writeCfg('text-default.json', { defaults: { output: 'text' } });
    process.env.BTCR2_OUTPUT = 'json';
    expect(resolveOutputFormat({ config: cfg })).to.equal('json');
  });

  it('honors config defaults.output when no flag or env is set', () => {
    const cfg = writeCfg('json-only.json', { defaults: { output: 'json' } });
    expect(resolveOutputFormat({ config: cfg })).to.equal('json');
  });

  it('falls back to text when nothing is configured', () => {
    expect(resolveOutputFormat({ config: join(tempDir, 'nope.json') })).to.equal('text');
  });

  it('never throws on a malformed config (falls back to text)', () => {
    const cfg = writeCfg('broken.json', '{bad');
    expect(resolveOutputFormat({ config: cfg })).to.equal('text');
  });
});

describe('connection resolution (non-vacuous precedence)', () => {
  const tempDir = join(tmpdir(), 'btcr2-precedence-test');
  const saved: Record<string, string | undefined> = {};

  before(() => mkdirSync(tempDir, { recursive: true }));

  after(() => rmSync(tempDir, { recursive: true, force: true }));

  beforeEach(() => {
    for (const k of Object.values(ENV_VARS)) { saved[k] = process.env[k]; delete process.env[k]; }
  });

  afterEach(() => {
    for (const k of Object.values(ENV_VARS)) {
      if (saved[k] !== undefined) process.env[k] = saved[k]; else delete process.env[k];
    }
  });

  const writeCfg = (name: string, content: ConfigFile): string => {
    const p = join(tempDir, name);
    writeFileSync(p, JSON.stringify(content));
    return p;
  };

  it('resolves the REST host from the config-file profile (not merely the network name)', () => {
    const cfg = writeCfg('rest-host.json', { profiles: { regtest: { btc: { rest: 'http://profile-rest:3000' } } } });
    const api = defaultApiFactory('regtest', { config: cfg });
    expect(api.btc.connection.rest.config.host).to.equal('http://profile-rest:3000');
  });

  it('a CLI flag REST host wins over env and file (asserted on the resolved host)', () => {
    const cfg = writeCfg('rest-flag.json', { profiles: { regtest: { btc: { rest: 'http://file-rest:3000' } } } });
    process.env[ENV_VARS.BTC_REST] = 'http://env-rest:4000';
    const api = defaultApiFactory('regtest', { config: cfg, btcRest: 'http://flag-rest:5000' });
    expect(api.btc.connection.rest.config.host).to.equal('http://flag-rest:5000');
  });

  it('an env REST host wins over the file (asserted on the resolved host)', () => {
    const cfg = writeCfg('rest-env.json', { profiles: { regtest: { btc: { rest: 'http://file-rest:3000' } } } });
    process.env[ENV_VARS.BTC_REST] = 'http://env-rest:4000';
    const api = defaultApiFactory('regtest', { config: cfg });
    expect(api.btc.connection.rest.config.host).to.equal('http://env-rest:4000');
  });

  it('RPC url, user, and pass from a profile all reach the RPC client', () => {
    const cfg = writeCfg('rpc-creds.json', {
      profiles : { regtest: { btc: { rpcUrl: 'http://node-a:18443', rpcUser: 'alice', rpcPass: 's3cret' } } },
    });
    const api = defaultApiFactory('regtest', { config: cfg });
    expect(api.btc.connection.rpc?.config.host).to.equal('http://node-a:18443');
    expect(api.btc.connection.rpc?.config.username).to.equal('alice');
    expect(api.btc.connection.rpc?.config.password).to.equal('s3cret');
  });

  it('a flag RPC url never inherits a profile\'s credentials (atomic credential unit)', () => {
    const cfg = writeCfg('rpc-atomic.json', {
      profiles : { regtest: { btc: { rpcUrl: 'http://node-a:18443', rpcUser: 'alice', rpcPass: 's3cret' } } },
    });
    const api = defaultApiFactory('regtest', { config: cfg, btcRpcUrl: 'http://node-b:18443' });
    expect(api.btc.connection.rpc?.config.host).to.equal('http://node-b:18443');
    expect(api.btc.connection.rpc?.config.username).to.be.undefined;
    expect(api.btc.connection.rpc?.config.password).to.be.undefined;
  });

  it('a config-file defaults.profile selects a non-network-named profile\'s endpoints', () => {
    const cfg = writeCfg('default-profile.json', {
      defaults : { profile: 'custom' },
      profiles : { custom: { btc: { rest: 'http://custom-rest:9000' } } },
    });
    const api = defaultApiFactory('regtest', { config: cfg });
    expect(api.btc.connection.rest.config.host).to.equal('http://custom-rest:9000');
  });

  it('a blank flag defers to the configured layer instead of masking it', () => {
    const cfg = writeCfg('blank-flag.json', { profiles: { regtest: { btc: { rest: 'http://file-rest:3000' } } } });
    const api = defaultApiFactory('regtest', { config: cfg, btcRest: '   ' });
    expect(api.btc.connection.rest.config.host).to.equal('http://file-rest:3000');
  });

  it('a profile REST header reaches the resolved REST client', () => {
    const cfg = writeCfg('rest-header.json', {
      profiles : { regtest: { btc: { headers: { Authorization: 'Bearer file' } } } },
    });
    const api = defaultApiFactory('regtest', { config: cfg });
    expect(api.btc.connection.rest.config.headers).to.deep.equal({ Authorization: 'Bearer file' });
  });

  it('a profile RPC wallet reaches the resolved RPC client', () => {
    const cfg = writeCfg('rpc-wallet.json', {
      profiles : { regtest: { btc: { rpcUrl: 'http://node:18443', wallet: 'primary' } } },
    });
    const api = defaultApiFactory('regtest', { config: cfg });
    expect(api.btc.connection.rpc?.config.wallet).to.equal('primary');
  });

  it('a profile signalDiscovery reaches the resolved BitcoinApi', () => {
    const cfg = writeCfg('signal-discovery.json', {
      profiles : { regtest: { btc: { signalDiscovery: 'fullnode' } } },
    });
    // regtest carries a default RPC host, so fullnode needs no explicit rpc config.
    expect(defaultApiFactory('regtest', { config: cfg }).btc.signalDiscovery).to.equal('fullnode');
  });

  it('defaults to indexer discovery when nothing configures it', () => {
    const cfg = writeCfg('signal-discovery-default.json', {});
    expect(defaultApiFactory('regtest', { config: cfg }).btc.signalDiscovery).to.equal('indexer');
  });

  it('rejects fullnode discovery on a network with no RPC client', () => {
    const cfg = writeCfg('signal-discovery-no-rpc.json', {});
    expect(() => defaultApiFactory('bitcoin', { config: cfg, btcSignalDiscovery: 'fullnode' }).btc)
      .to.throw(/no rpc config was resolved/);
  });
});

describe('parseHeaderList', () => {
  it('parses "Key: Value" pairs into a header map', () => {
    expect(parseHeaderList([ 'Authorization: Bearer abc', 'X-Api-Key: k1' ])).to.deep.equal({
      Authorization : 'Bearer abc',
      'X-Api-Key'   : 'k1',
    });
  });

  it('returns undefined for an empty or missing list', () => {
    expect(parseHeaderList([])).to.be.undefined;
    expect(parseHeaderList(undefined)).to.be.undefined;
  });

  it('throws for an entry missing a colon', () => {
    expect(() => parseHeaderList([ 'no-colon' ], '--btc-rest-header')).to.throw(CLIError, /Invalid --btc-rest-header/);
  });

  it('throws for an empty header name', () => {
    expect(() => parseHeaderList([ ': value' ])).to.throw(CLIError, /expected "Key: Value"/);
  });
});

describe('resolveConnectionConfig (I/O knobs)', () => {
  const tempDir = join(tmpdir(), 'btcr2-knobs-test');
  const saved: Record<string, string | undefined> = {};
  const cfgPath = join(tempDir, 'nope.json');

  before(() => mkdirSync(tempDir, { recursive: true }));

  after(() => rmSync(tempDir, { recursive: true, force: true }));

  beforeEach(() => {
    for (const k of Object.values(ENV_VARS)) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of Object.values(ENV_VARS)) {
      if (saved[k] !== undefined) process.env[k] = saved[k]; else delete process.env[k];
    }
  });

  it('maps --btc-timeout to BitcoinApiConfig.timeoutMs', () => {
    const { btc } = resolveConnectionConfig('regtest', { config: cfgPath, btcTimeout: '5000' });
    expect(btc?.timeoutMs).to.equal(5000);
  });

  it('leaves timeoutMs unset (unbounded) when no timeout is given', () => {
    const { btc } = resolveConnectionConfig('regtest', { config: cfgPath });
    expect(btc?.timeoutMs).to.be.undefined;
  });

  it('rejects a non-numeric --btc-timeout', () => {
    expect(() => resolveConnectionConfig('regtest', { config: cfgPath, btcTimeout: 'soon' }))
      .to.throw(CLIError, /number of milliseconds/);
  });

  it('rejects --btc-timeout 0 (would abort every request immediately)', () => {
    expect(() => resolveConnectionConfig('regtest', { config: cfgPath, btcTimeout: '0' }))
      .to.throw(CLIError, /milliseconds >= 1/);
  });

  it('does not build an RPC config from wallet/headers alone on a public network (no phantom client)', () => {
    const { btc } = resolveConnectionConfig('bitcoin', { config: cfgPath, btcRpcWallet: 'w1' });
    expect(btc?.rpc).to.be.undefined;
  });

  it('reaches the regtest default RPC host with env credentials and no url', () => {
    const { btc } = resolveConnectionConfig('regtest', {
      config     : cfgPath,
      btcRpcUser : 'polaruser',
      btcRpcPass : 'polarpass',
    });
    // No url in any layer, but regtest has a default RPC host, so credentials are kept.
    expect(btc?.rpc?.username).to.equal('polaruser');
    expect(btc?.rpc?.password).to.equal('polarpass');
    expect(btc?.rpc?.host).to.be.undefined; // host comes from the SDK default in the api merge
  });

  it('maps --cas-timeout to CasConfig.timeoutMs and attaches the default gateway', () => {
    const { cas } = resolveConnectionConfig('regtest', { config: cfgPath, casTimeout: '0' });
    expect(cas?.timeoutMs).to.equal(0);
    // A timeout needs an endpoint; the default gateway is attached so it is honored.
    expect(cas?.gateway).to.be.a('string');
  });

  it('maps --btc-rest-header into RestConfig.headers (no host override needed)', () => {
    const { btc } = resolveConnectionConfig('regtest', { config: cfgPath, btcRestHeader: [ 'Authorization: Bearer t' ] });
    expect(btc?.rest?.headers).to.deep.equal({ Authorization: 'Bearer t' });
  });

  it('merges profile REST headers under flag headers (flag wins per key)', () => {
    const cfg = join(tempDir, 'headers.json');
    writeFileSync(cfg, JSON.stringify({
      profiles : { regtest: { btc: { headers: { 'X-Api-Key': 'file', 'X-Env': 'prod' } } } },
    }));
    const { btc } = resolveConnectionConfig('regtest', { config: cfg, btcRestHeader: [ 'X-Api-Key: flag' ] });
    expect(btc?.rest?.headers).to.deep.equal({ 'X-Api-Key': 'flag', 'X-Env': 'prod' });
  });

  it('defaults signalDiscovery to unset so the api applies indexer', () => {
    const { btc } = resolveConnectionConfig('regtest', { config: cfgPath });
    expect(btc?.signalDiscovery).to.be.undefined;
  });

  it('maps --btc-signal-discovery into BitcoinApiConfig', () => {
    const { btc } = resolveConnectionConfig('regtest', { config: cfgPath, btcSignalDiscovery: 'fullnode' });
    expect(btc?.signalDiscovery).to.equal('fullnode');
  });

  it('reads btc.signalDiscovery from the config-file profile', () => {
    const cfg = join(tempDir, 'signal-discovery.json');
    writeFileSync(cfg, JSON.stringify({
      profiles : { regtest: { btc: { signalDiscovery: 'fullnode' } } },
    }));
    expect(resolveConnectionConfig('regtest', { config: cfg }).btc?.signalDiscovery).to.equal('fullnode');
  });

  it('lets --btc-signal-discovery override the profile', () => {
    const cfg = join(tempDir, 'signal-discovery-override.json');
    writeFileSync(cfg, JSON.stringify({
      profiles : { regtest: { btc: { signalDiscovery: 'fullnode' } } },
    }));
    const { btc } = resolveConnectionConfig('regtest', { config: cfg, btcSignalDiscovery: 'indexer' });
    expect(btc?.signalDiscovery).to.equal('indexer');
  });

  it('rejects an unknown --btc-signal-discovery mode', () => {
    expect(() => resolveConnectionConfig('regtest', { config: cfgPath, btcSignalDiscovery: 'esplora' }))
      .to.throw(CLIError, /Invalid --btc-signal-discovery value "esplora"/);
  });

  it('rejects an unknown signalDiscovery in the config-file profile', () => {
    const cfg = join(tempDir, 'signal-discovery-bad.json');
    writeFileSync(cfg, JSON.stringify({
      profiles : { regtest: { btc: { signalDiscovery: 'nope' } } },
    }));
    expect(() => resolveConnectionConfig('regtest', { config: cfg }))
      .to.throw(CLIError, /Invalid --btc-signal-discovery value "nope"/);
  });

  it('maps --btc-rpc-wallet and --btc-rpc-header into RpcConfig alongside the url', () => {
    const { btc } = resolveConnectionConfig('regtest', {
      config       : cfgPath,
      btcRpcUrl    : 'http://node:18443',
      btcRpcWallet : 'w1',
      btcRpcHeader : [ 'X-Auth: z' ],
    });
    expect(btc?.rpc?.host).to.equal('http://node:18443');
    expect(btc?.rpc?.wallet).to.equal('w1');
    expect(btc?.rpc?.headers).to.deep.equal({ 'X-Auth': 'z' });
  });

  it('reads btc.timeoutMs and cas.timeoutMs from the config-file profile', () => {
    const cfg = join(tempDir, 'timeouts.json');
    writeFileSync(cfg, JSON.stringify({
      profiles : { regtest: { btc: { timeoutMs: 1234 }, cas: { gateway: 'https://g', timeoutMs: 4321 } } },
    }));
    const { btc, cas } = resolveConnectionConfig('regtest', { config: cfg });
    expect(btc?.timeoutMs).to.equal(1234);
    expect(cas?.timeoutMs).to.equal(4321);
  });
});

describe('resolveBroadcastOptions', () => {
  const tempDir = join(tmpdir(), 'btcr2-broadcast-test');
  const cfgPath = join(tempDir, 'nope.json');
  let savedFee: string | undefined;

  before(() => mkdirSync(tempDir, { recursive: true }));

  after(() => rmSync(tempDir, { recursive: true, force: true }));

  beforeEach(() => { savedFee = process.env.BTCR2_FEE_RATE; delete process.env.BTCR2_FEE_RATE; });

  afterEach(() => {
    if (savedFee !== undefined) process.env.BTCR2_FEE_RATE = savedFee; else delete process.env.BTCR2_FEE_RATE;
  });

  it('returns undefined when neither fee-rate nor change-address is set', () => {
    expect(resolveBroadcastOptions('regtest', { config: cfgPath }, {})).to.be.undefined;
  });

  it('wraps a flag --fee-rate in a StaticFeeEstimator', () => {
    const opts = resolveBroadcastOptions('regtest', { config: cfgPath }, { feeRate: '9' });
    expect(opts?.feeEstimator).to.be.instanceOf(StaticFeeEstimator);
    expect((opts?.feeEstimator as StaticFeeEstimator).satsPerVbyte).to.equal(9);
  });

  it('reads the fee rate from BTCR2_FEE_RATE when no flag is given', () => {
    process.env.BTCR2_FEE_RATE = '15';
    const opts = resolveBroadcastOptions('regtest', { config: cfgPath }, {});
    expect((opts?.feeEstimator as StaticFeeEstimator).satsPerVbyte).to.equal(15);
  });

  it('reads the fee rate and change address from the config-file profile', () => {
    const cfg = join(tempDir, 'broadcast.json');
    writeFileSync(cfg, JSON.stringify({
      profiles : { regtest: { btc: { feeRate: 21, changeAddress: 'bcrt1qchange' } } },
    }));
    const opts = resolveBroadcastOptions('regtest', { config: cfg }, {});
    expect((opts?.feeEstimator as StaticFeeEstimator).satsPerVbyte).to.equal(21);
    expect(opts?.changeAddress).to.equal('bcrt1qchange');
  });

  it('lets the flag fee rate win over env and profile', () => {
    const cfg = join(tempDir, 'broadcast2.json');
    writeFileSync(cfg, JSON.stringify({ profiles: { regtest: { btc: { feeRate: 21 } } } }));
    process.env.BTCR2_FEE_RATE = '15';
    const opts = resolveBroadcastOptions('regtest', { config: cfg }, { feeRate: '3' });
    expect((opts?.feeEstimator as StaticFeeEstimator).satsPerVbyte).to.equal(3);
  });

  it('throws for a non-positive fee rate', () => {
    expect(() => resolveBroadcastOptions('regtest', { config: cfgPath }, { feeRate: '0' }))
      .to.throw(CLIError, /positive number of sats/);
  });
});

describe('resolveSecretRef and RPC password sources', () => {
  const tempDir = join(tmpdir(), 'btcr2-secret-test');
  const envKeys = [ ...Object.values(ENV_VARS), 'BTCR2_BTC_RPC_PASS_FILE', 'MY_RPC_PASS' ];
  const saved: Record<string, string | undefined> = {};

  before(() => mkdirSync(tempDir, { recursive: true }));

  after(() => rmSync(tempDir, { recursive: true, force: true }));

  beforeEach(() => {
    for (const k of envKeys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] !== undefined) process.env[k] = saved[k]; else delete process.env[k];
    }
  });

  it('returns a literal value unchanged and undefined for undefined', () => {
    expect(resolveSecretRef('plain')).to.equal('plain');
    expect(resolveSecretRef(undefined)).to.be.undefined;
  });

  it('reads an env: reference and trims a trailing newline', () => {
    process.env.MY_RPC_PASS = 'from-env\n';
    expect(resolveSecretRef('env:MY_RPC_PASS')).to.equal('from-env');
  });

  it('reads a file: reference and trims a trailing newline', () => {
    const file = join(tempDir, 'pass.txt');
    writeFileSync(file, 'from-file\n');
    expect(resolveSecretRef(`file:${file}`)).to.equal('from-file');
  });

  it('throws a CLIError (not a raw error) for an unreadable file: reference', () => {
    expect(() => resolveSecretRef('file:/no/such/rpc/pass/file'))
      .to.throw(CLIError, /Could not read the RPC password/);
  });

  it('resolves a profile rpcPass env: ref into the RPC client password', () => {
    process.env.MY_RPC_PASS = 'resolved-secret';
    const cfg = join(tempDir, 'ref.json');
    writeFileSync(cfg, JSON.stringify({
      profiles : { regtest: { btc: { rpcUrl: 'http://node:18443', rpcUser: 'u', rpcPass: 'env:MY_RPC_PASS' } } },
    }));
    const api = defaultApiFactory('regtest', { config: cfg });
    expect(api.btc.connection.rpc?.config.password).to.equal('resolved-secret');
  });

  it('reads the RPC password from BTCR2_BTC_RPC_PASS_FILE when the layer supplies none', () => {
    const file = join(tempDir, 'passfile.txt');
    writeFileSync(file, 'file-secret\n');
    process.env.BTCR2_BTC_RPC_PASS_FILE = file;
    const cfg = join(tempDir, 'nopass.json');
    writeFileSync(cfg, JSON.stringify({
      profiles : { regtest: { btc: { rpcUrl: 'http://node:18443', rpcUser: 'u' } } },
    }));
    const api = defaultApiFactory('regtest', { config: cfg });
    expect(api.btc.connection.rpc?.config.password).to.equal('file-secret');
  });

  it('supplies the password for a flag-given RPC url from BTCR2_BTC_RPC_PASS_FILE', () => {
    // The pass file is the layer-independent password channel, so it still
    // reaches an RPC url given on the command line. BTCR2_BTC_RPC_PASS does not:
    // the atomic credential unit binds url and credentials to one layer, and the
    // url came from the flag layer.
    const file = join(tempDir, 'flag-passfile.txt');
    writeFileSync(file, 'file-secret\n');
    process.env.BTCR2_BTC_RPC_PASS_FILE = file;
    process.env[ENV_VARS.BTC_RPC_PASS] = 'env-secret';
    const api = defaultApiFactory('regtest', {
      config     : join(tempDir, 'no-such-config.json'),
      btcRpcUrl  : 'http://node-b:18443',
      btcRpcUser : 'bob',
    });
    expect(api.btc.connection.rpc?.config.password).to.equal('file-secret');
  });
});

describe('CAS RPC credentials (ADR 128)', () => {
  const tempDir = join(tmpdir(), 'btcr2-cas-rpc-auth-test');
  const envKeys = [ ...Object.values(ENV_VARS), 'BTCR2_CAS_RPC_PASS_FILE', 'MY_CAS_PASS' ];
  const saved: Record<string, string | undefined> = {};
  const auth = { username: 'alice', password: 's3cret' };

  before(() => mkdirSync(tempDir, { recursive: true }));

  after(() => rmSync(tempDir, { recursive: true, force: true }));

  beforeEach(() => {
    for (const k of envKeys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] !== undefined) process.env[k] = saved[k]; else delete process.env[k];
    }
  });

  const writeCfg = (name: string, content: ConfigFile): string => {
    const p = join(tempDir, name);
    writeFileSync(p, JSON.stringify(content));
    return p;
  };

  it('reads BTCR2_CAS_RPC_USER and BTCR2_CAS_RPC_PASS', () => {
    process.env[ENV_VARS.CAS_RPC_USER] = 'alice';
    process.env[ENV_VARS.CAS_RPC_PASS] = 's3cret';
    const overrides = readEnvOverrides();
    expect(overrides.casRpcUser).to.equal('alice');
    expect(overrides.casRpcPass).to.equal('s3cret');
  });

  it('maps the profile cas.rpcUser and cas.rpcPass', () => {
    const o = profileToOverrides({ profiles: { p: { cas: { rpcUser: 'alice', rpcPass: 'env:X' } } } }, 'p');
    expect(o.casRpcUser).to.equal('alice');
    expect(o.casRpcPass).to.equal('env:X');
  });

  it('gives the profile url, user, and password to the CAS config', () => {
    const cfg = writeCfg('profile.json', {
      profiles : { regtest: { cas: { rpcUrl: 'http://node-a:5001', rpcUser: 'alice', rpcPass: 's3cret' } } },
    });
    expect(resolveConnectionConfig('regtest', { config: cfg }).cas)
      .to.deep.equal({ rpcUrl: 'http://node-a:5001', rpcAuth: auth });
  });

  it('resolves an env: reference in cas.rpcPass', () => {
    process.env.MY_CAS_PASS = 's3cret\n';
    const cfg = writeCfg('ref.json', {
      profiles : { regtest: { cas: { rpcUrl: 'http://node-a:5001', rpcUser: 'alice', rpcPass: 'env:MY_CAS_PASS' } } },
    });
    expect(resolveConnectionConfig('regtest', { config: cfg }).cas?.rpcAuth).to.deep.equal(auth);
  });

  it('takes the url, user, and password from the environment', () => {
    process.env[ENV_VARS.CAS_RPC_URL] = 'http://node-e:5001';
    process.env[ENV_VARS.CAS_RPC_USER] = 'alice';
    process.env[ENV_VARS.CAS_RPC_PASS] = 's3cret';
    const cas = resolveConnectionConfig('regtest', { config: join(tempDir, 'none.json') }).cas;
    expect(cas).to.deep.equal({ rpcUrl: 'http://node-e:5001', rpcAuth: auth });
  });

  it('never gives the profile credentials to a flag url', () => {
    const cfg = writeCfg('atomic.json', {
      profiles : { regtest: { cas: { rpcUrl: 'http://node-a:5001', rpcUser: 'alice', rpcPass: 's3cret' } } },
    });
    const cas = resolveConnectionConfig('regtest', { config: cfg, casRpcUrl: 'http://node-b:5001' }).cas;
    expect(cas).to.deep.equal({ rpcUrl: 'http://node-b:5001' });
  });

  it('gives a flag url and user the password of BTCR2_CAS_RPC_PASS_FILE, not of BTCR2_CAS_RPC_PASS', () => {
    const file = join(tempDir, 'passfile.txt');
    writeFileSync(file, 's3cret\n');
    process.env.BTCR2_CAS_RPC_PASS_FILE = file;
    process.env[ENV_VARS.CAS_RPC_PASS] = 'env-secret';
    const cas = resolveConnectionConfig('regtest', {
      config     : join(tempDir, 'none.json'),
      casRpcUrl  : 'http://node-b:5001',
      casRpcUser : 'alice',
    }).cas;
    expect(cas?.rpcAuth).to.deep.equal(auth);
  });

  it('refuses a user with no password', () => {
    const cfg = writeCfg('user-only.json', {
      profiles : { regtest: { cas: { rpcUrl: 'http://node-a:5001', rpcUser: 'alice' } } },
    });
    expect(() => resolveConnectionConfig('regtest', { config: cfg }))
      .to.throw(CLIError, 'The CAS RPC credentials need a user and a password. Only the user is set for http://node-a:5001.');
  });

  it('refuses a password with no user', () => {
    const cfg = writeCfg('pass-only.json', {
      profiles : { regtest: { cas: { rpcUrl: 'http://node-a:5001', rpcPass: 's3cret' } } },
    });
    expect(() => resolveConnectionConfig('regtest', { config: cfg }))
      .to.throw(CLIError, /Only the password is set/);
  });

  it('ignores credentials if no layer gives a url', () => {
    const cfg = writeCfg('no-url.json', {
      profiles : { regtest: { cas: { gateway: 'https://gw.example', rpcUser: 'alice', rpcPass: 's3cret' } } },
    });
    expect(resolveConnectionConfig('regtest', { config: cfg }).cas).to.deep.equal({ gateway: 'https://gw.example' });
  });

  it('sends the credentials in each CAS request of the api', async () => {
    const cfg = writeCfg('api.json', {
      profiles : { regtest: { cas: { rpcUrl: 'http://node-a:5001', rpcUser: 'alice', rpcPass: 's3cret' } } },
    });
    const original = globalThis.fetch;
    const headers: unknown[] = [];
    globalThis.fetch = (async (_input: unknown, init?: Parameters<typeof fetch>[1]) => {
      headers.push(init?.headers);
      return new Response('did:btcr2');
    }) as typeof fetch;
    try {
      await defaultApiFactory('regtest', { config: cfg }).cas.probe();
    } finally {
      globalThis.fetch = original;
    }
    expect(headers).to.deep.equal([{ Authorization: 'Basic YWxpY2U6czNjcmV0' }]);
  });
});

describe('defaults.cas (ADR 129)', () => {
  const tempDir = join(tmpdir(), 'btcr2-defaults-cas-test');
  const envKeys = [ ...Object.values(ENV_VARS), 'BTCR2_CAS_RPC_PASS_FILE' ];
  const saved: Record<string, string | undefined> = {};
  const auth = { username: 'alice', password: 's3cret' };
  const shared = { rpcUrl: 'https://ipfs.example', rpcUser: 'alice', rpcPass: 's3cret' };

  before(() => mkdirSync(tempDir, { recursive: true }));

  after(() => rmSync(tempDir, { recursive: true, force: true }));

  beforeEach(() => {
    for (const k of envKeys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] !== undefined) process.env[k] = saved[k]; else delete process.env[k];
    }
  });

  const writeCfg = (name: string, content: ConfigFile): string => {
    const p = join(tempDir, name);
    writeFileSync(p, JSON.stringify(content));
    return p;
  };

  it('maps defaults.cas to the CAS overrides only', () => {
    expect(defaultsToOverrides({ defaults: { cas: { gateway: 'https://gw.example', ...shared } } })).to.deep.equal({
      casGateway : 'https://gw.example',
      casRpcUrl  : 'https://ipfs.example',
      casRpcUser : 'alice',
      casRpcPass : 's3cret',
    });
    expect(defaultsToOverrides({ defaults: { network: 'signet' } })).to.deep.equal({});
  });

  it('gives the url, user, and password of defaults.cas to each network', () => {
    const cfg = writeCfg('all.json', { defaults: { cas: shared } });
    for (const network of [ 'bitcoin', 'signet', 'mutinynet', 'regtest' ] as const) {
      expect(resolveConnectionConfig(network, { config: cfg }).cas)
        .to.deep.equal({ rpcUrl: 'https://ipfs.example', rpcAuth: auth });
    }
  });

  it('gives the gateway and the timeout of defaults.cas to a network with no profile', () => {
    const cfg = writeCfg('gateway.json', { defaults: { cas: { gateway: 'https://gw.example', timeoutMs: 60000 } } });
    expect(resolveConnectionConfig('signet', { config: cfg }).cas)
      .to.deep.equal({ gateway: 'https://gw.example', timeoutMs: 60000 });
  });

  it('never gives the defaults.cas credentials to a profile url', () => {
    const cfg = writeCfg('profile-url.json', {
      defaults : { cas: shared },
      profiles : { regtest: { cas: { rpcUrl: 'http://127.0.0.1:5001' } } },
    });
    expect(resolveConnectionConfig('regtest', { config: cfg }).cas).to.deep.equal({ rpcUrl: 'http://127.0.0.1:5001' });
    expect(resolveConnectionConfig('signet', { config: cfg }).cas)
      .to.deep.equal({ rpcUrl: 'https://ipfs.example', rpcAuth: auth });
  });

  it('lets a profile value win for each key, and a blank profile value defer to defaults.cas', () => {
    const cfg = writeCfg('per-key.json', {
      defaults : { cas: { gateway: 'https://gw.example', timeoutMs: 60000 } },
      profiles : {
        signet  : { cas: { gateway: 'https://signet-gw.example' } },
        regtest : { cas: { gateway: '  ', timeoutMs: 0 } },
      },
    });
    expect(resolveConnectionConfig('signet', { config: cfg }).cas)
      .to.deep.equal({ gateway: 'https://signet-gw.example', timeoutMs: 60000 });
    expect(resolveConnectionConfig('regtest', { config: cfg }).cas)
      .to.deep.equal({ gateway: 'https://gw.example', timeoutMs: 0 });
  });

  it('lets the environment and the flag win over defaults.cas', () => {
    const cfg = writeCfg('env.json', { defaults: { cas: { gateway: 'https://gw.example', ...shared } } });
    process.env[ENV_VARS.CAS_GATEWAY] = 'https://env-gw.example';
    process.env[ENV_VARS.CAS_RPC_URL] = 'http://env-node:5001';
    expect(resolveConnectionConfig('signet', { config: cfg }).cas)
      .to.deep.equal({ gateway: 'https://env-gw.example', rpcUrl: 'http://env-node:5001' });
    expect(resolveConnectionConfig('signet', { config: cfg, casGateway: 'https://flag-gw.example' }).cas)
      .to.deep.equal({ gateway: 'https://flag-gw.example' });
  });

  it('lets a profile gateway win over the defaults.cas url', () => {
    const cfg = writeCfg('profile-gateway.json', {
      defaults : { cas: shared },
      profiles : { signet: { cas: { gateway: 'https://signet-gw.example' } } },
    });
    const cas = resolveConnectionConfig('signet', { config: cfg }).cas;
    expect(cas).to.deep.equal({ gateway: 'https://signet-gw.example' });
    expect(defaultApiFactory('signet', { config: cfg }).cas.writable).to.equal(false);
  });

  it('lets a flag gateway win over a profile url', () => {
    const cfg = writeCfg('flag-gateway.json', {
      profiles : { regtest: { cas: { rpcUrl: 'http://127.0.0.1:5001' } } },
    });
    expect(resolveConnectionConfig('regtest', { config: cfg, casGateway: 'https://gw.example' }).cas)
      .to.deep.equal({ gateway: 'https://gw.example' });
  });

  it('takes the gateway and the url of one layer together', () => {
    const cfg = writeCfg('same-layer.json', {
      defaults : { cas: { gateway: 'https://gw.example', rpcUrl: 'http://127.0.0.1:5001' } },
    });
    expect(resolveConnectionConfig('regtest', { config: cfg }).cas)
      .to.deep.equal({ gateway: 'https://gw.example', rpcUrl: 'http://127.0.0.1:5001' });
  });

  it('refuses incomplete credentials in defaults.cas', () => {
    const cfg = writeCfg('user-only.json', { defaults: { cas: { rpcUrl: 'https://ipfs.example', rpcUser: 'alice' } } });
    expect(() => resolveConnectionConfig('signet', { config: cfg }))
      .to.throw(CLIError, 'The CAS RPC credentials need a user and a password. Only the user is set for https://ipfs.example.');
  });

  it('changes no Bitcoin value', () => {
    const cfg = writeCfg('btc.json', { defaults: { cas: shared } });
    const plain = writeCfg('plain.json', {});
    expect(resolveConnectionConfig('regtest', { config: cfg }).btc)
      .to.deep.equal(resolveConnectionConfig('regtest', { config: plain }).btc);
  });
});

describe('profile identity wiring (keystore + default signing key)', () => {
  const tempDir = join(tmpdir(), 'btcr2-identity-test');

  before(() => mkdirSync(tempDir, { recursive: true }));

  after(() => rmSync(tempDir, { recursive: true, force: true }));

  const writeCfg = (name: string, content: ConfigFile): string => {
    const p = join(tempDir, name);
    writeFileSync(p, JSON.stringify(content));
    return p;
  };

  it('resolveKeystorePath honors the active profile identity.keystore', () => {
    const cfg = writeCfg('id-keystore.json', {
      defaults : { profile: 'custom' },
      profiles : { custom: { identity: { keystore: '/tmp/custom-keystore.json' } } },
    });
    expect(resolveKeystorePath({ config: cfg })).to.equal('/tmp/custom-keystore.json');
  });

  it('resolveKeystorePath lets the --keystore flag win over identity.keystore', () => {
    const cfg = writeCfg('id-keystore-flag.json', {
      defaults : { profile: 'custom' },
      profiles : { custom: { identity: { keystore: '/tmp/custom-keystore.json' } } },
    });
    expect(resolveKeystorePath({ config: cfg, keystore: '/tmp/flag-keystore.json' })).to.equal('/tmp/flag-keystore.json');
  });

  it('resolveKeystorePath falls back to the default when no profile identity is set', () => {
    const cfg = writeCfg('id-none.json', { defaults: { profile: 'custom' }, profiles: { custom: {} } });
    expect(resolveKeystorePath({ config: cfg })).to.match(/btcr2[/\\]keystore\.json$/);
  });

  it('resolveDefaultKeyRef falls back to the active profile identity.default', () => {
    const cfg = writeCfg('id-default.json', {
      defaults : { profile: 'custom' },
      profiles : { custom: { identity: { default: 'profile-key' } } },
    });
    expect(resolveDefaultKeyRef(undefined, { config: cfg })).to.equal('profile-key');
  });

  it('resolveDefaultKeyRef lets the explicit flag value win over identity.default', () => {
    const cfg = writeCfg('id-default-flag.json', {
      defaults : { profile: 'custom' },
      profiles : { custom: { identity: { default: 'profile-key' } } },
    });
    expect(resolveDefaultKeyRef('flag-key', { config: cfg })).to.equal('flag-key');
  });

  it('resolveDefaultKeyRef returns undefined when neither flag nor identity.default is set', () => {
    const cfg = writeCfg('id-default-none.json', { defaults: { profile: 'custom' }, profiles: { custom: {} } });
    expect(resolveDefaultKeyRef(undefined, { config: cfg })).to.be.undefined;
  });

  it('resolveKeystorePath aborts loudly on a malformed config by default', () => {
    // A keystore-mutating command must not silently fall back to the default
    // store under a broken config; that would strand key material in the wrong
    // keystore. So the default resolution throws rather than degrading.
    const bad = join(tempDir, 'id-malformed.json');
    writeFileSync(bad, '{ not valid json ');
    expect(() => resolveKeystorePath({ config: bad })).to.throw(CLIError, /not valid JSON/);
  });

  it('resolveKeystorePath degrades to the home default under a malformed config only when lenient', () => {
    // Diagnostic/recovery commands (`config path`, `keystore status`) opt in so
    // they can still report a path instead of crashing on the config you ran
    // them to fix.
    const bad = join(tempDir, 'id-malformed-lenient.json');
    writeFileSync(bad, '{ not valid json ');
    expect(() => resolveKeystorePath({ config: bad }, { lenient: true })).to.not.throw();
    expect(resolveKeystorePath({ config: bad }, { lenient: true })).to.match(/btcr2[/\\]keystore\.json$/);
  });

  it('the --keystore flag wins without reading a malformed config, even when strict', () => {
    // The flag short-circuits before any config read, so a broken config never
    // blocks an explicit keystore path.
    const bad = join(tempDir, 'id-malformed-flag.json');
    writeFileSync(bad, '{ not valid json ');
    expect(resolveKeystorePath({ config: bad, keystore: '/explicit/ks.json' })).to.equal('/explicit/ks.json');
  });

  it('resolveDefaultKeyRef aborts loudly on a malformed config', () => {
    // Never silently sign with the default/active key when the configured
    // signing identity cannot be read.
    const bad = join(tempDir, 'id-malformed-sign.json');
    writeFileSync(bad, '{ not valid json ');
    expect(() => resolveDefaultKeyRef(undefined, { config: bad })).to.throw(CLIError, /not valid JSON/);
  });
});
