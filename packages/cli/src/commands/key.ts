import type { KeyManager } from '@did-btcr2/key-manager';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { Command } from 'commander';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import type { ApiFactory } from '../config.js';
import { CLIError } from '../error.js';
import { resolveKeyRef } from '../keystore/resolve-key-ref.js';
import { formatResult } from '../output.js';
import type { CommandResult, GlobalOptions } from '../types.js';

/**
 * Registers the `key` command group for managing keypairs in the encrypted
 * keystore. All subcommands operate offline (no Bitcoin connection) through the
 * keystore-backed KeyManager injected by the factory.
 */
export function registerKeyCommand(
  program : Command,
  factory : ApiFactory,
  globals : () => GlobalOptions,
): void {
  const key = program.command('key').description('Manage keypairs in the encrypted keystore.');
  const print = (result: CommandResult): void => console.log(formatResult(result, globals()));

  key
    .command('generate')
    .description('Generate a new keypair and store it.')
    .option('--name <name>', 'A human-friendly name, stored as a tag and usable as a key reference.')
    .option('--set-active', 'Make this the active key.', false)
    .action((options: { name?: string; setActive?: boolean }) => {
      const api = factory(undefined, globals());
      assertNameAvailable(api.kms.kms, options.name);
      const setActive = options.setActive ?? false;
      const id = api.kms.generateKey({ ...(options.name && { tags: { name: options.name } }), setActive });
      print({ action: 'key-generate', data: { keyId: id, publicKey: bytesToHex(api.kms.getPublicKey(id)), active: setActive } });
    });

  key
    .command('list')
    .alias('ls')
    .description('List stored keys.')
    .action(() => {
      const kms = factory(undefined, globals()).kms.kms;
      const active = kms.activeKeyId;
      const data = kms.listKeys().map(id => {
        const entry = kms.getEntry(id);
        return {
          keyId       : id,
          fingerprint : id.split(':').pop() ?? id,
          ...(entry.tags?.name && { name: entry.tags.name }),
          active      : id === active,
        };
      });
      print({ action: 'key-list', data });
    });

  key
    .command('show <ref>')
    .description('Show a key\'s public material and tags. Never prints the secret.')
    .action((ref: string) => {
      const kms = factory(undefined, globals()).kms.kms;
      const id = resolveKeyRef(kms, ref);
      const entry = kms.getEntry(id);
      print({ action: 'key-show', data: { keyId: id, publicKey: bytesToHex(entry.publicKey), ...(entry.tags && { tags: entry.tags }) } });
    });

  key
    .command('import')
    .description('Import a key: a secret from a hex file, or a public key as watch-only.')
    .option('--secret-file <path>', 'Path to a file containing a 32-byte secret key as hex.')
    .option('--public <hex>', 'A 33-byte compressed public key as hex (imported watch-only).')
    .option('--name <name>', 'A human-friendly name, stored as a tag.')
    .option('--set-active', 'Make this the active key.', false)
    .action((options: { secretFile?: string; public?: string; name?: string; setActive?: boolean }) => {
      if (Boolean(options.secretFile) === Boolean(options.public)) {
        throw new CLIError('Provide exactly one of --secret-file or --public.', 'INVALID_ARGUMENT_ERROR');
      }
      const api = factory(undefined, globals());
      assertNameAvailable(api.kms.kms, options.name);
      const keyPair = options.secretFile
        ? new SchnorrKeyPair({ secretKey: readHexFile(options.secretFile, 32, '--secret-file') })
        : new SchnorrKeyPair({ publicKey: parseHex(options.public ?? '', 33, '--public') });
      const setActive = options.setActive ?? false;
      const id = api.kms.import(keyPair, { ...(options.name && { tags: { name: options.name } }), setActive });
      print({ action: 'key-import', data: { keyId: id, publicKey: bytesToHex(api.kms.getPublicKey(id)), watchOnly: !options.secretFile, active: setActive } });
    });

  key
    .command('export <ref>')
    .description('Export a key. Public material by default; --secret writes the secret to a file.')
    .option('--secret', 'Export the secret key. Requires --out.', false)
    .option('--out <path>', 'Write the exported secret to this file (created 0600).')
    .action((ref: string, options: { secret?: boolean; out?: string }) => {
      const api = factory(undefined, globals());
      const id = resolveKeyRef(api.kms.kms, ref);
      if (!options.secret) {
        print({ action: 'key-export', data: { keyId: id, publicKey: bytesToHex(api.kms.getPublicKey(id)) } });
        return;
      }
      if (!options.out) {
        throw new CLIError('Exporting a secret requires --out <file> so it is not written to the terminal.', 'INVALID_ARGUMENT_ERROR');
      }
      const keyPair = api.kms.export(id);
      if (!keyPair.hasSecretKey) {
        throw new CLIError(`Key ${id} is watch-only and has no secret to export.`, 'INVALID_ARGUMENT_ERROR', { keyId: id });
      }
      process.stderr.write('warning: writing an unencrypted secret key to disk. Protect this file and delete it when done.\n');
      writeSecretFile(options.out, bytesToHex(keyPair.secretKey.bytes));
      print({ action: 'key-export', data: { keyId: id, secretWrittenTo: options.out } });
    });

  key
    .command('delete <ref>')
    .alias('rm')
    .description('Delete a key from the keystore.')
    .option('--force', 'Delete even if it is the active key.', false)
    .action((ref: string, options: { force?: boolean }) => {
      const api = factory(undefined, globals());
      const id = resolveKeyRef(api.kms.kms, ref);
      api.kms.removeKey(id, { force: options.force ?? false });
      print({ action: 'key-delete', data: { keyId: id, deleted: true } });
    });

  key
    .command('use <ref>')
    .description('Set the active key, persisted across invocations.')
    .action((ref: string) => {
      const api = factory(undefined, globals());
      const id = resolveKeyRef(api.kms.kms, ref);
      api.kms.setActive(id);
      print({ action: 'key-use', data: { keyId: id, active: true } });
    });
}

/** Throws if a name tag is already used by another key. */
function assertNameAvailable(kms: KeyManager, name?: string): void {
  if (!name) return;
  if (kms.listKeys().some(id => kms.getEntry(id).tags?.name === name)) {
    throw new CLIError(`A key named "${name}" already exists.`, 'INVALID_ARGUMENT_ERROR', { name });
  }
}

/** Parses and length-checks a hex string into bytes. */
function parseHex(hex: string, expectedBytes: number, label: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = hexToBytes(hex.trim());
  } catch {
    throw new CLIError(`Invalid hex for ${label}.`, 'INVALID_ARGUMENT_ERROR', { label });
  }
  if (bytes.length !== expectedBytes) {
    throw new CLIError(
      `${label} must be ${expectedBytes} bytes (${expectedBytes * 2} hex chars), got ${bytes.length}.`,
      'INVALID_ARGUMENT_ERROR',
      { label },
    );
  }
  return bytes;
}

/** Reads a file and parses its contents as length-checked hex bytes. */
function readHexFile(path: string, expectedBytes: number, label: string): Uint8Array {
  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    throw new CLIError(`Cannot read ${label} at ${path}.`, 'INVALID_ARGUMENT_ERROR', { label, path });
  }
  return parseHex(content, expectedBytes, label);
}

/**
 * Writes an exported secret to a new file, created exclusively (O_CREAT|O_EXCL,
 * mode 0600). The exclusive flag refuses to clobber an existing file or follow
 * a pre-placed symlink, so the secret never lands in a loose-permissions or
 * redirected target.
 */
function writeSecretFile(path: string, contents: string): void {
  let fd: number;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (error) {
    if ((error as { code?: string }).code === 'EEXIST') {
      throw new CLIError(`Refusing to overwrite existing file ${path}. Choose a new --out path.`, 'INVALID_ARGUMENT_ERROR', { path });
    }
    throw error;
  }
  try {
    writeFileSync(fd, contents);
  } finally {
    closeSync(fd);
  }
}
