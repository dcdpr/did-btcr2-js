import type { Command } from 'commander';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DidBtcr2Cli } from '../src/cli.js';
import { CLIError } from '../src/error.js';
import { createTestApi, expect, originalConsoleLog } from './helpers.js';

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
      const cli = new DidBtcr2Cli(createTestApi());
      const create = getSubcommand(cli, 'create');
      await expect(
        create.parseAsync(['-t', 'z', '-n', 'bitcoin', '-b', 'aa'.repeat(33)], { from: 'user' })
      ).to.be.rejectedWith(CLIError);
    });

    it('rejects invalid network', async () => {
      const cli = new DidBtcr2Cli(createTestApi());
      const create = getSubcommand(cli, 'create');
      await expect(
        create.parseAsync(['-t', 'k', '-n', 'not-a-network', '-b', 'aa'.repeat(33)], { from: 'user' })
      ).to.be.rejectedWith(CLIError);
    });

    it('rejects empty bytes', async () => {
      const cli = new DidBtcr2Cli(createTestApi());
      const create = getSubcommand(cli, 'create');
      await expect(
        create.parseAsync(['-t', 'k', '-n', 'bitcoin', '-b', ''], { from: 'user' })
      ).to.be.rejectedWith(CLIError);
    });

    it('rejects wrong byte length for type=k', async () => {
      const cli = new DidBtcr2Cli(createTestApi());
      const create = getSubcommand(cli, 'create');
      await expect(
        create.parseAsync(['-t', 'k', '-n', 'bitcoin', '-b', 'aa'], { from: 'user' })
      ).to.be.rejectedWith(CLIError, /expected.*33 bytes/i);
    });

    it('rejects wrong byte length for type=x', async () => {
      const cli = new DidBtcr2Cli(createTestApi());
      const create = getSubcommand(cli, 'create');
      await expect(
        create.parseAsync(['-t', 'x', '-n', 'bitcoin', '-b', 'aa'.repeat(33)], { from: 'user' })
      ).to.be.rejectedWith(CLIError, /expected.*32 bytes/i);
    });

    it('creates a deterministic DID with valid input', async () => {
      const cli = new DidBtcr2Cli(createTestApi());
      const messages: string[] = [];
      console.log = (msg?: any) => { if (msg !== undefined) messages.push(String(msg)); };

      // Valid 33-byte compressed pubkey (starts with 02 or 03)
      const validKey = '02' + 'aa'.repeat(32);
      await cli.run(['node', 'btcr2', 'create', '-t', 'k', '-n', 'regtest', '-b', validKey]);

      expect(messages[0]).to.include('did:btcr2:');
    });

    it('creates an external DID with valid input', async () => {
      const cli = new DidBtcr2Cli(createTestApi());
      const messages: string[] = [];
      console.log = (msg?: any) => { if (msg !== undefined) messages.push(String(msg)); };

      const validHash = 'bb'.repeat(32);
      await cli.run(['node', 'btcr2', 'create', '-t', 'x', '-n', 'regtest', '-b', validHash]);

      expect(messages[0]).to.include('did:btcr2:');
    });
  });

  describe('resolve', () => {
    it('rejects invalid identifiers', async () => {
      const cli = new DidBtcr2Cli(createTestApi());
      const resolve = getSubcommand(cli, 'resolve');
      await expect(
        resolve.parseAsync(['-i', 'not-a-did'], { from: 'user' })
      ).to.be.rejected;
    });

    it('rejects invalid resolution options JSON', async () => {
      const validDid = 'did:btcr2:k1qqpyerymt5aaxm2jyh7za2594hgrq24uhqanxe5h94rf42flxkwhvmqd03t47';
      const cli = new DidBtcr2Cli(createTestApi());
      const resolve = getSubcommand(cli, 'resolve');
      await expect(
        resolve.parseAsync(['-i', validDid, '-r', 'not json'], { from: 'user' })
      ).to.be.rejectedWith(CLIError);
    });

    it('reads resolution options from a file', async () => {
      const validDid = 'did:btcr2:k1qqpyerymt5aaxm2jyh7za2594hgrq24uhqanxe5h94rf42flxkwhvmqd03t47';
      const cli = new DidBtcr2Cli(createTestApi());
      const tempPath = join(tmpdir(), 'btcr2-resolve-test.json');
      await writeFile(tempPath, '{"versionId":"1"}', 'utf-8');

      try {
        const resolve = getSubcommand(cli, 'resolve');
        // Resolving requires a Bitcoin connection, so this will reject
        await expect(
          resolve.parseAsync(['-i', validDid, '-p', tempPath], { from: 'user' })
        ).to.be.rejected;
      } finally {
        await rm(tempPath, { force: true });
      }
    });

    it('rejects invalid resolution options file path', async () => {
      const validDid = 'did:btcr2:k1qqpyerymt5aaxm2jyh7za2594hgrq24uhqanxe5h94rf42flxkwhvmqd03t47';
      const cli = new DidBtcr2Cli(createTestApi());
      const resolve = getSubcommand(cli, 'resolve');
      await expect(
        resolve.parseAsync(['-i', validDid, '-p', '/no/file/here.json'], { from: 'user' })
      ).to.be.rejectedWith(CLIError);
    });
  });

  describe('update', () => {
    it('rejects invalid JSON for --source-document', async () => {
      const cli = new DidBtcr2Cli(createTestApi());
      const update = getSubcommand(cli, 'update');
      await expect(
        update.parseAsync(['-s', '{bad', '--source-version-id', '1', '-p', '[]', '-m', 'vm', '-b', '[]'], { from: 'user' })
      ).to.be.rejectedWith(CLIError, /--source-document/);
    });

    it('rejects invalid JSON for --patches', async () => {
      const cli = new DidBtcr2Cli(createTestApi());
      const update = getSubcommand(cli, 'update');
      await expect(
        update.parseAsync(['-s', '{}', '--source-version-id', '1', '-p', 'not json', '-m', 'vm', '-b', '[]'], { from: 'user' })
      ).to.be.rejectedWith(CLIError, /--patches/);
    });

    it('rejects invalid JSON for --beacon-id', async () => {
      const cli = new DidBtcr2Cli(createTestApi());
      const update = getSubcommand(cli, 'update');
      await expect(
        update.parseAsync(['-s', '{}', '--source-version-id', '1', '-p', '[]', '-m', 'vm', '-b', 'not json'], { from: 'user' })
      ).to.be.rejectedWith(CLIError, /--beacon-id/);
    });
  });

  describe('deactivate', () => {
    it('rejects invalid JSON for --source-document', async () => {
      const cli = new DidBtcr2Cli(createTestApi());
      const deactivate = getSubcommand(cli, 'deactivate');
      await expect(
        deactivate.parseAsync(['-s', '{bad', '--source-version-id', '1', '-m', 'vm', '-b', '[]'], { from: 'user' })
      ).to.be.rejectedWith(CLIError, /--source-document/);
    });

    it('rejects invalid JSON for --beacon-id', async () => {
      const cli = new DidBtcr2Cli(createTestApi());
      const deactivate = getSubcommand(cli, 'deactivate');
      await expect(
        deactivate.parseAsync(['-s', '{}', '--source-version-id', '1', '-m', 'vm', '-b', 'not json'], { from: 'user' })
      ).to.be.rejectedWith(CLIError, /--beacon-id/);
    });
  });
});
