import { expect } from './helpers.js';
import { formatResult, isSecretKey, REDACTED, redactSecrets } from '../src/output.js';
import type { CommandResult, GlobalOptions } from '../src/types.js';

const textOpts: GlobalOptions = { output: 'text', verbose: false, quiet: false };
const jsonOpts: GlobalOptions = { output: 'json', verbose: false, quiet: false };

describe('formatResult', () => {
  it('formats create result in text mode as plain string', () => {
    const result: CommandResult = { action: 'create', data: 'did:btcr2:abc' };
    expect(formatResult(result, textOpts)).to.equal('did:btcr2:abc');
  });

  it('formats resolve result in text mode as JSON', () => {
    const resolution = { didDocument: { id: 'did:btcr2:abc' } } as any;
    const result: CommandResult = { action: 'resolve', data: resolution };
    const output = formatResult(result, textOpts);
    expect(JSON.parse(output)).to.deep.equal(resolution);
  });

  it('formats update result in text mode as JSON', () => {
    const signed = { proof: { type: 'test' } } as any;
    const result: CommandResult = { action: 'update', data: signed };
    const output = formatResult(result, textOpts);
    expect(JSON.parse(output)).to.deep.equal(signed);
  });

  it('formats deactivate result in text mode as JSON', () => {
    const signed = { proof: { type: 'deactivation' } } as any;
    const result: CommandResult = { action: 'deactivate', data: signed };
    const output = formatResult(result, textOpts);
    expect(JSON.parse(output)).to.deep.equal(signed);
  });

  it('formats any result in json mode as full result object', () => {
    const result: CommandResult = { action: 'create', data: 'did:btcr2:abc' };
    const output = formatResult(result, jsonOpts);
    const parsed = JSON.parse(output);
    expect(parsed.action).to.equal('create');
    expect(parsed.data).to.equal('did:btcr2:abc');
  });
});

describe('redactSecrets', () => {
  it('redacts secret-named keys in a nested object', () => {
    const out = redactSecrets({ btc: { rpcUser: 'u', rpcPass: 's3cret' } }) as { btc: { rpcUser: string; rpcPass: string } };
    expect(out.btc.rpcUser).to.equal('u');
    expect(out.btc.rpcPass).to.equal(REDACTED);
  });

  it('redacts a directly-passed secret leaf value', () => {
    expect(redactSecrets('s3cret', 'rpcPass')).to.equal(REDACTED);
  });

  it('leaves a non-secret leaf value untouched', () => {
    expect(redactSecrets('http://x', 'rest')).to.equal('http://x');
  });

  it('does not mutate the input object', () => {
    const input = { rpcPass: 's3cret' };
    redactSecrets(input);
    expect(input.rpcPass).to.equal('s3cret');
  });

  it('isSecretKey matches pass/secret/token/auth/apikey names, not others', () => {
    expect(isSecretKey('rpcPass')).to.equal(true);
    expect(isSecretKey('apiToken')).to.equal(true);
    expect(isSecretKey('clientSecret')).to.equal(true);
    expect(isSecretKey('Authorization')).to.equal(true);
    expect(isSecretKey('X-Api-Key')).to.equal(true);
    expect(isSecretKey('rpcUser')).to.equal(false);
    expect(isSecretKey('rest')).to.equal(false);
  });

  it('scrubs a password embedded in a URL value (any key)', () => {
    const out = redactSecrets({ btc: { rpcUrl: 'http://alice:s3cret@node:8332' } }) as { btc: { rpcUrl: string } };
    expect(out.btc.rpcUrl).to.equal('http://alice:********@node:8332');
  });

  it('redacts header credentials inside a headers map', () => {
    const out = redactSecrets({ btc: { headers: { Authorization: 'Bearer xyz', 'X-Api-Key': 'k' } } }) as { btc: { headers: Record<string, string> } };
    expect(out.btc.headers.Authorization).to.equal(REDACTED);
    expect(out.btc.headers['X-Api-Key']).to.equal(REDACTED);
  });

  it('does not wholesale-redact an object under a secret-named key (e.g. a profile named with a secret word)', () => {
    const out = redactSecrets({ profiles: { 'access-token': { btc: { rest: 'http://x' } } } }) as { profiles: Record<string, { btc: { rest: string } }> };
    expect(out.profiles['access-token'].btc.rest).to.equal('http://x');
  });
});
