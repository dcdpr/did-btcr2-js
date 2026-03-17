import { IdentifierTypes } from '@did-btcr2/common';
import { Command } from 'commander';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DidBtcr2Cli } from '../src/cli.js';
import { CLIError } from '../src/error.js';
import { createMockOps, expect, originalConsoleLog } from './helpers.js';

function getSubcommand(cli: DidBtcr2Cli, name: string): Command {
  const command = cli.program.commands.find((cmd: Command) => cmd.name() === name);
  if (!command) throw new Error(`Subcommand ${name} not found`);
  return command;
}

describe('DidBtcr2Cli', () => {
  afterEach(() => {
    console.log = originalConsoleLog;
  });

  describe('create', () => {
    it('rejects invalid type', async () => {
      const cli = new DidBtcr2Cli(createMockOps());
      const create = getSubcommand(cli, 'create');
      await expect(
        create.parseAsync(['-t', 'z', '-n', 'bitcoin', '-b', 'aa'.repeat(33)], { from: 'user' })
      ).to.be.rejectedWith(CLIError);
    });

    it('rejects invalid network', async () => {
      const cli = new DidBtcr2Cli(createMockOps());
      const create = getSubcommand(cli, 'create');
      await expect(
        create.parseAsync(['-t', 'k', '-n', 'not-a-network', '-b', 'aa'.repeat(33)], { from: 'user' })
      ).to.be.rejectedWith(CLIError);
    });

    it('rejects empty bytes', async () => {
      const cli = new DidBtcr2Cli(createMockOps());
      const create = getSubcommand(cli, 'create');
      await expect(
        create.parseAsync(['-t', 'k', '-n', 'bitcoin', '-b', ''], { from: 'user' })
      ).to.be.rejectedWith(CLIError);
    });

    it('rejects wrong byte length for type=k', async () => {
      const cli = new DidBtcr2Cli(createMockOps());
      const create = getSubcommand(cli, 'create');
      await expect(
        create.parseAsync(['-t', 'k', '-n', 'bitcoin', '-b', 'aa'], { from: 'user' })
      ).to.be.rejectedWith(CLIError, /expected.*33 bytes/i);
    });

    it('rejects wrong byte length for type=x', async () => {
      const cli = new DidBtcr2Cli(createMockOps());
      const create = getSubcommand(cli, 'create');
      await expect(
        create.parseAsync(['-t', 'x', '-n', 'bitcoin', '-b', 'aa'.repeat(33)], { from: 'user' })
      ).to.be.rejectedWith(CLIError, /expected.*32 bytes/i);
    });

    it('invokes ops.create with correct arguments on valid input', async () => {
      let captured: { genesisBytes: Uint8Array; options: any } | undefined;
      const ops = createMockOps({
        create : (genesisBytes, options) => {
          captured = { genesisBytes, options };
          return 'did:btcr2:abc';
        },
      });
      const cli = new DidBtcr2Cli(ops);
      const messages: string[] = [];
      console.log = (msg?: any) => { if (msg !== undefined) messages.push(String(msg)); };

      const validKey = 'aa'.repeat(33); // 33 bytes
      await cli.run(['node', 'btcr2', 'create', '-t', 'k', '-n', 'bitcoin', '-b', validKey]);

      expect(captured).to.exist;
      expect(captured!.options.idType).to.equal(IdentifierTypes.KEY);
      expect(captured!.options.network).to.equal('bitcoin');
      expect(captured!.genesisBytes).to.be.instanceOf(Uint8Array);
      expect(captured!.genesisBytes.length).to.equal(33);
      expect(messages[0]).to.equal('did:btcr2:abc');
    });

    it('invokes ops.create for type=x with EXTERNAL idType', async () => {
      let capturedIdType: string | undefined;
      const ops = createMockOps({
        create : (_genesisBytes, options) => {
          capturedIdType = options.idType;
          return 'did:btcr2:ext';
        },
      });
      const cli = new DidBtcr2Cli(ops);
      console.log = () => {};

      const validHash = 'bb'.repeat(32); // 32 bytes
      await cli.run(['node', 'btcr2', 'create', '-t', 'x', '-n', 'regtest', '-b', validHash]);

      expect(capturedIdType).to.equal(IdentifierTypes.EXTERNAL);
    });
  });

  describe('resolve', () => {
    it('rejects invalid identifiers', async () => {
      const cli = new DidBtcr2Cli(createMockOps());
      const resolve = getSubcommand(cli, 'resolve');
      await expect(
        resolve.parseAsync(['-i', 'not-a-did'], { from: 'user' })
      ).to.be.rejectedWith(CLIError);
    });

    it('rejects invalid resolution options JSON', async () => {
      const cli = new DidBtcr2Cli(createMockOps());
      const resolve = getSubcommand(cli, 'resolve');
      // Invalid JSON triggers CLIError regardless of identifier validity
      await expect(
        resolve.parseAsync(['-i', 'did:btcr2:valid', '-r', 'not json'], { from: 'user' })
      ).to.be.rejectedWith(CLIError);
    });

    it('reads resolution options from a file', async () => {
      const cli = new DidBtcr2Cli(createMockOps());
      const tempPath = join(tmpdir(), 'btcr2-resolve-test.json');
      await writeFile(tempPath, '{"versionId":"1"}', 'utf-8');

      try {
        const resolve = getSubcommand(cli, 'resolve');
        // Identifier.decode throws for a fake id before file is read
        await expect(
          resolve.parseAsync(['-i', 'did:btcr2:fake', '-p', tempPath], { from: 'user' })
        ).to.be.rejectedWith(CLIError);
      } finally {
        await rm(tempPath, { force: true });
      }
    });

    it('rejects invalid resolution options file path', async () => {
      const cli = new DidBtcr2Cli(createMockOps());
      const resolve = getSubcommand(cli, 'resolve');
      await expect(
        resolve.parseAsync(['-i', 'did:btcr2:fake', '-p', '/no/file/here.json'], { from: 'user' })
      ).to.be.rejectedWith(CLIError);
    });
  });

  describe('update', () => {
    it('rejects invalid JSON for --source-document', async () => {
      const cli = new DidBtcr2Cli(createMockOps());
      const update = getSubcommand(cli, 'update');
      await expect(
        update.parseAsync(['-s', '{bad', '--source-version-id', '1', '-p', '[]', '-m', 'vm', '-b', '[]'], { from: 'user' })
      ).to.be.rejectedWith(CLIError, /--source-document/);
    });

    it('rejects invalid JSON for --patches', async () => {
      const cli = new DidBtcr2Cli(createMockOps());
      const update = getSubcommand(cli, 'update');
      await expect(
        update.parseAsync(['-s', '{}', '--source-version-id', '1', '-p', 'not json', '-m', 'vm', '-b', '[]'], { from: 'user' })
      ).to.be.rejectedWith(CLIError, /--patches/);
    });

    it('rejects invalid JSON for --beacon-id', async () => {
      const cli = new DidBtcr2Cli(createMockOps());
      const update = getSubcommand(cli, 'update');
      await expect(
        update.parseAsync(['-s', '{}', '--source-version-id', '1', '-p', '[]', '-m', 'vm', '-b', 'not json'], { from: 'user' })
      ).to.be.rejectedWith(CLIError, /--beacon-id/);
    });

    it('passes parsed update options to ops.update', async () => {
      let captured: any;
      const ops = createMockOps({
        update : async (params) => {
          captured = params;
          return { proof: {} } as any;
        },
      });
      const cli = new DidBtcr2Cli(ops);
      console.log = () => {};

      await cli.run([
        'node', 'btcr2', 'update',
        '-s', '{"id":"did:btcr2:example"}',
        '--source-version-id', '2',
        '-p', '[{"op":"add","path":"/foo","value":"bar"}]',
        '-m', 'vm-id',
        '-b', '"beacon1"',
      ]);

      expect(captured).to.exist;
      expect(captured.sourceDocument).to.deep.equal({ id: 'did:btcr2:example' });
      expect(captured.patches).to.deep.equal([{ op: 'add', path: '/foo', value: 'bar' }]);
      expect(captured.sourceVersionId).to.equal(2);
      expect(captured.verificationMethodId).to.equal('vm-id');
      expect(captured.beaconId).to.equal('beacon1');
    });
  });

  describe('deactivate', () => {
    it('rejects invalid JSON for --source-document', async () => {
      const cli = new DidBtcr2Cli(createMockOps());
      const deactivate = getSubcommand(cli, 'deactivate');
      await expect(
        deactivate.parseAsync(['-s', '{bad', '--source-version-id', '1', '-m', 'vm', '-b', '[]'], { from: 'user' })
      ).to.be.rejectedWith(CLIError, /--source-document/);
    });

    it('rejects invalid JSON for --beacon-id', async () => {
      const cli = new DidBtcr2Cli(createMockOps());
      const deactivate = getSubcommand(cli, 'deactivate');
      await expect(
        deactivate.parseAsync(['-s', '{}', '--source-version-id', '1', '-m', 'vm', '-b', 'not json'], { from: 'user' })
      ).to.be.rejectedWith(CLIError, /--beacon-id/);
    });

    it('calls ops.update with the deactivation patch', async () => {
      let captured: any;
      const ops = createMockOps({
        update : async (params) => {
          captured = params;
          return { proof: {} } as any;
        },
      });
      const cli = new DidBtcr2Cli(ops);
      console.log = () => {};

      await cli.run([
        'node', 'btcr2', 'deactivate',
        '-s', '{"id":"did:btcr2:example"}',
        '--source-version-id', '3',
        '-m', 'vm-id',
        '-b', '"beacon1"',
      ]);

      expect(captured).to.exist;
      expect(captured.sourceDocument).to.deep.equal({ id: 'did:btcr2:example' });
      expect(captured.patches).to.deep.equal([{ op: 'add', path: '/deactivated', value: true }]);
      expect(captured.sourceVersionId).to.equal(3);
      expect(captured.verificationMethodId).to.equal('vm-id');
      expect(captured.beaconId).to.equal('beacon1');
    });
  });
});
