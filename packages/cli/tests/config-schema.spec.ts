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
      expect(isKnownConfigPath('defaults.cas')).to.equal(true);
      expect(isKnownConfigPath('defaults.cas.rpcPass')).to.equal(true);
    });

    it('rejects unknown paths', () => {
      expect(isKnownConfigPath('defaults.netwrok')).to.equal(false);
      expect(isKnownConfigPath('profiles.regtest.btc.rset')).to.equal(false);
      expect(isKnownConfigPath('nope')).to.equal(false);
      expect(isKnownConfigPath('defaults.cas.rpcurl')).to.equal(false);
      expect(isKnownConfigPath('defaults.btc')).to.equal(false);
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

    it('rejects an invalid signalDiscovery enum value', () => {
      expect(() => validateConfigSet('profiles.regtest.btc.signalDiscovery', 'esplora'))
        .to.throw(CLIError, /"indexer" or "fullnode"/);
    });

    it('accepts a valid signalDiscovery enum value', () => {
      expect(validateConfigSet('profiles.regtest.btc.signalDiscovery', 'fullnode'))
        .to.deep.equal({ unknownPath: false });
    });

    it('an enum message prints a primitive value in quotes', () => {
      expect(() => validateConfigSet('defaults.output', 'yaml'))
        .to.throw(CLIError, 'Invalid value for defaults.output: "yaml". Expected "json" or "text".');
      expect(() => validateConfigSet('profiles.regtest.btc.signalDiscovery', 42))
        .to.throw(CLIError, 'Invalid value for profiles.regtest.btc.signalDiscovery: "42". Expected "indexer" or "fullnode".');
    });

    it('rejects an enum object with no text form with a CLIError; the message has no value (ADR 156)', () => {
      // `config set <path> '{"toString":1}'` gives this value. String() throws for it.
      const cases: Array<[ string, RegExp ]> = [
        [ 'defaults.network', /^Invalid value for defaults\.network\. Expected one of / ],
        [ 'defaults.output', /^Invalid value for defaults\.output\. Expected "json" or "text"\.$/ ],
        [ 'profiles.regtest.btc.signalDiscovery', /^Invalid value for profiles\.regtest\.btc\.signalDiscovery\. Expected "indexer" or "fullnode"\.$/ ],
      ];
      for (const [ path, message ] of cases) {
        const value = JSON.parse('{"toString":1,"valueOf":1}');
        let thrown: any;
        try {
          validateConfigSet(path, value);
        } catch (error) {
          thrown = error;
        }
        expect(thrown, path).to.be.instanceOf(CLIError);
        expect(thrown.type).to.equal('INVALID_ARGUMENT_ERROR');
        expect(thrown.message).to.match(message);
        expect(thrown.data).to.deep.equal({ path, value });
      }
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

    it('reports an enum object with no text form with the enum message, not a TypeError (ADR 156)', () => {
      const issues = findConfigIssues({ defaults: { output: JSON.parse('{"toString":1,"valueOf":1}') } }, 1);
      expect(issues).to.deep.equal([ { path: 'defaults.output', issue: 'Invalid value for defaults.output. Expected "json" or "text".' } ]);
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
