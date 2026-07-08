import { findConfigIssues, isKnownConfigPath, validateConfigSet } from '../src/config-schema.js';
import { CLIError } from '../src/error.js';
import { expect } from './helpers.js';

describe('config-schema', () => {
  describe('isKnownConfigPath', () => {
    it('recognizes known leaf and intermediate paths', () => {
      expect(isKnownConfigPath('defaults.network')).to.equal(true);
      expect(isKnownConfigPath('profiles.regtest.btc.rest')).to.equal(true);
      expect(isKnownConfigPath('profiles.anyname.cas.rpcUrl')).to.equal(true);
      expect(isKnownConfigPath('profiles.anyname.btc')).to.equal(true);
      expect(isKnownConfigPath('profiles.anyname.identity.keystore')).to.equal(true);
    });

    it('rejects unknown paths', () => {
      expect(isKnownConfigPath('defaults.netwrok')).to.equal(false);
      expect(isKnownConfigPath('profiles.regtest.btc.rset')).to.equal(false);
      expect(isKnownConfigPath('nope')).to.equal(false);
    });
  });

  describe('validateConfigSet', () => {
    it('flags an unknown path (still writable)', () => {
      expect(validateConfigSet('profiles.regtest.btc.rset', 'x')).to.deep.equal({ unknownPath: true });
    });

    it('accepts a known non-enum path', () => {
      expect(validateConfigSet('profiles.regtest.btc.rest', 'http://x')).to.deep.equal({ unknownPath: false });
    });

    it('rejects an invalid network enum value', () => {
      expect(() => validateConfigSet('defaults.network', 'mainnett')).to.throw(CLIError, /Expected one of/);
    });

    it('accepts a valid network enum value', () => {
      expect(validateConfigSet('defaults.network', 'signet')).to.deep.equal({ unknownPath: false });
    });

    it('rejects an invalid output enum value', () => {
      expect(() => validateConfigSet('defaults.output', 'yaml')).to.throw(CLIError, /"json" or "text"/);
    });
  });

  describe('findConfigIssues', () => {
    it('returns no issues for a clean config', () => {
      const issues = findConfigIssues({
        schemaVersion : 1,
        defaults      : { network: 'regtest', output: 'text' },
        profiles      : { regtest: { btc: { rest: 'http://x' } } },
      }, 1);
      expect(issues).to.deep.equal([]);
    });

    it('reports an unknown key', () => {
      const issues = findConfigIssues({ profiles: { regtest: { btc: { rset: 'http://x' } } } }, 1);
      expect(issues).to.have.length(1);
      expect(issues[0].path).to.equal('profiles.regtest.btc.rset');
      expect(issues[0].issue).to.match(/unknown/);
    });

    it('reports an invalid enum value', () => {
      const issues = findConfigIssues({ defaults: { network: 'mainnett' } }, 1);
      expect(issues.some(i => i.path === 'defaults.network')).to.equal(true);
    });

    it('reports a newer-than-supported schemaVersion', () => {
      const issues = findConfigIssues({ schemaVersion: 99 }, 1);
      expect(issues.some(i => i.path === 'schemaVersion')).to.equal(true);
    });

    it('reports an unknown subtree once, without descending into it', () => {
      const issues = findConfigIssues({ weird: { a: 1, b: 2 } }, 1);
      expect(issues).to.deep.equal([ { path: 'weird', issue: 'unknown key' } ]);
    });
  });
});
