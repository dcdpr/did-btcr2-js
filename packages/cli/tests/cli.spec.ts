import { DidMethodError } from '@did-btcr2/common';
import { Identifier } from '@did-btcr2/method';
import { expect } from 'chai';
import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CLIError, DidBtcr2Cli } from '../src/cli.js';

/**
 * DidBtcr2 CLI Test
 */
describe('CLI Tests', () => {
  const tmpDir = path.join(fileURLToPath(new URL('.', import.meta.url)), 'tmp');

  before(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('CLIError preserves DidMethodError properties', () => {
    const error = new CLIError('boom', 'TEST_ERROR', { reason: 'unit-test' });
    expect(error).to.be.instanceOf(DidMethodError);
    expect(error.type).to.equal('TEST_ERROR');
    expect(error.name).to.equal('TEST_ERROR');
    expect(error.data).to.deep.equal({ reason: 'unit-test' });
  });

  describe('command parsing', () => {
    let cli: DidBtcr2Cli;
    let invokeCalls: any[];
    let originalInvoke: any;
    let originalDecode: any;

    const parse = (args: string[]) => (cli as any).CLI.parseAsync(args, { from: 'user' });

    beforeEach(() => {
      cli = new DidBtcr2Cli();
      invokeCalls = [];
      originalInvoke = (cli as any).invokeCommand;
      (cli as any).invokeCommand = async (payload: any) => {
        invokeCalls.push(payload);
      };
      originalDecode = Identifier.decode;
      Identifier.decode = (() => ({})) as any;
    });

    afterEach(() => {
      (cli as any).invokeCommand = originalInvoke;
      Identifier.decode = originalDecode;
    });

    it('routes create command with validated options', async () => {
      await parse(['create', '-t', 'k', '-n', 'bitcoin', '-b', 'abcd']);

      expect(invokeCalls).to.have.length(1);
      const { action, options } = invokeCalls[0];
      expect(action).to.equal('create');
      expect(options).to.include({ type: 'k', network: 'bitcoin', bytes: 'abcd' });
    });

    it('throws CLIError for invalid create type', async () => {
      let caught;
      try {
        await parse(['create', '-t', 'z', '-n', 'bitcoin', '-b', 'abcd']);
      } catch (error) {
        caught = error;
      }

      expect(caught).to.be.instanceOf(CLIError);
      expect((caught as CLIError).message).to.contain('Invalid type');
      expect(invokeCalls).to.be.empty;
    });

    it('parses resolution options from string and file path', async () => {
      const filePath = path.join(tmpDir, 'resolution-options.json');
      await writeFile(filePath, JSON.stringify({ fromFile: true }), 'utf-8');

      await parse([
        'resolve',
        '-i',
        'did:btcr2:abc',
        '-r',
        '{"from":"string"}',
        '-p',
        filePath,
      ]);

      expect(invokeCalls).to.have.length(1);
      const payload = invokeCalls[0];
      expect(payload.action).to.equal('resolve');
      expect(payload.options.identifier).to.equal('did:btcr2:abc');
      expect(payload.options.resolutionOptions).to.deep.equal({ fromFile: true });
    });

    it('throws CLIError for invalid identifier on resolve', async () => {
      Identifier.decode = (() => {
        throw new Error('bad id');
      }) as any;

      let caught;
      try {
        await parse(['resolve', '-i', 'invalid']);
      } catch (error) {
        caught = error;
      }

      expect(caught).to.be.instanceOf(CLIError);
      expect(invokeCalls).to.be.empty;
    });

    it('parses update options as JSON before invoking command', async () => {
      await parse([
        'update',
        '-i',
        'did:btcr2:abc',
        '-s',
        '{"id":"doc"}',
        '-v',
        '1',
        '-p',
        '[{"op":"add","path":"/foo","value":"bar"}]',
        '-m',
        'did:btcr2:abc#key-1',
        '-b',
        '["beacon-1"]',
      ]);

      expect(invokeCalls).to.have.length(1);
      const { options } = invokeCalls[0];
      expect(options.sourceDocument).to.deep.equal({ id: 'doc' });
      expect(options.patch).to.deep.equal([{ op: 'add', path: '/foo', value: 'bar' }]);
      expect(options.beaconIds).to.deep.equal(['beacon-1']);
    });

    it('throws CLIError on invalid update patch JSON', async () => {
      let caught;
      try {
        await parse([
          'update',
          '-i',
          'did:btcr2:abc',
          '-s',
          '{"id":"doc"}',
          '-v',
          '1',
          '-p',
          'not-json',
          '-m',
          'did:btcr2:abc#key-1',
          '-b',
          '["beacon-1"]',
        ]);
      } catch (error) {
        caught = error;
      }

      expect(caught).to.be.instanceOf(CLIError);
      expect((caught as CLIError).message).to.contain('Invalid options');
      expect(invokeCalls).to.be.empty;
    });
  });
});
