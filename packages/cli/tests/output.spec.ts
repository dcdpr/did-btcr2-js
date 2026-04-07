import { expect } from './helpers.js';
import { formatResult } from '../src/output.js';
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
