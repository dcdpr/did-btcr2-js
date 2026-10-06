import type { Btcr2DidDocument, DidBtcr2Api, ResolutionOptions } from '@did-btcr2/api';
import { createApi, DEFAULT_MIN_CONF, DidApi } from '@did-btcr2/api';
import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { assertKeystoreAllowedForNetwork, deriveNetwork, type ApiFactory } from '../config.js';
import { CLIError } from '../error.js';
import { IdentifierRecords, withRecordSidecar } from '../identifier-records.js';
import { warnProfileNetworkMismatch } from '../network-option.js';
import { formatCheckResult, formatResult } from '../output.js';
import { parseMinConf } from '../resolution-options.js';
import { readSidecarFile } from '../sidecar-file.js';
import { blankToUndef, type GlobalOptions, type MessageVerifyData } from '../types.js';
import { IDENTIFIER_REF_HELP } from './resolve.js';
import { resolveSigningKey } from './write.js';

/** The offline identifier operations of the api. They need no connection and no key. */
const didApi = new DidApi();

/** The help text of `--sidecar` on `message sign` and `message verify`. */
const SIDECAR_HELP = 'Path to a JSON file with sidecar data (genesisDocument, updates, casUpdates, smtProofs) '
  + 'for the resolution, as "identifier sidecar" prints it. Its data wins over the data of the identifier record';

/** The help text of `--min-conf` on `message sign` and `message verify`. */
const MIN_CONF_HELP = 'Minimum block confirmations a beacon signal needs before resolution applies it '
  + `(positive integer, default: ${DEFAULT_MIN_CONF})`;

/** A control character (C0, DEL, or C1). A terminal can run a sequence that starts with one. */
const CONTROL_CHARACTER = /\p{Cc}/gu;

/** The resolution flags that `message sign` and `message verify` share. */
type ResolutionFlags = {
  identifier : string;
  sidecar?   : string;
  minConf?   : number;
};

/**
 * Registers the `message` command group (ADR 137). `sign` signs a text message
 * as an assertion of an identifier. `verify` checks a signed message against
 * the current DID document of an identifier, or against the initial document
 * under `--offline`.
 *
 * Both commands resolve the identifier. The resolution data comes from the
 * identifier record and from `--sidecar`. Only `--min-conf` sets `minConf`, so
 * a file from the signer cannot pin an old version of the document.
 */
export function registerMessageCommand(
  program         : Command,
  factory         : ApiFactory,
  keystoreFactory : ApiFactory,
  globals         : () => GlobalOptions,
): void {
  const message = program
    .command('message')
    .description('Sign a text message with a did:btcr2 identifier, and verify a signed message.');

  message
    .command('sign <message>')
    .description('Sign a text message as an assertion of a did:btcr2 identifier. Prints the signed message as JSON. '
      + 'The signing key must be the key of an assertionMethod method of the current DID document.')
    .requiredOption('-i, --identifier <identifier>', `The identifier that signs: ${IDENTIFIER_REF_HELP}`)
    .option(
      '--signing-key <ref>',
      'Key that signs the message: a URN, fingerprint prefix, or name '
        + '(default: the signing key of the identifier record, else the profile identity.default, else the active key)',
    )
    .option(
      '-m, --verification-method-id <id>',
      'Verification method that signs the message '
        + '(default: the one assertionMethod method of the document that publishes the signing key)',
    )
    .option('--sidecar <path>', SIDECAR_HELP)
    .option('--min-conf <n>', MIN_CONF_HELP, parseMinConf)
    .action(async (text: string, options: ResolutionFlags & { signingKey?: string; verificationMethodId?: string }) => {
      const g = globals();
      const records = IdentifierRecords.forHome(g);
      const did = records.resolveRef(options.identifier);
      const record = records.get(did);
      const network = deriveNetwork(did);
      const flagOptions = readFlagOptions(options);
      assertKeystoreAllowedForNetwork(network, g);
      warnProfileNetworkMismatch(g, network, g);
      const api = keystoreFactory(network, g);
      // The key reference and the resolution read public data only. The
      // passphrase prompt comes at the signature, after the resolution.
      const keyId = resolveSigningKey(api, options.signingKey, record?.signingKey, did, g);
      const { document } = await resolveCurrent(api, did, withRecordSidecar(flagOptions, record));
      const data = api.btcr2.signMessage(document, text, api.kms.signer(keyId), {
        verificationMethodId : blankToUndef(options.verificationMethodId),
      });
      console.log(formatResult({ action: 'message-sign', data }, g));
    });

  message
    .command('verify <path>')
    .description('Verify a signed message file against the current DID document of the identifier. '
      + 'Exit code 1 if the message does not verify.')
    .requiredOption('-i, --identifier <identifier>', `The identifier that must have signed: ${IDENTIFIER_REF_HELP}`)
    .option('--sidecar <path>', SIDECAR_HELP)
    .option('--min-conf <n>', MIN_CONF_HELP, parseMinConf)
    .option(
      '--offline',
      'Check against the initial DID document, with no resolution. The check does not see a later key rotation or deactivation',
      false,
    )
    .action(async (path: string, options: ResolutionFlags & { offline: boolean }) => {
      const g = globals();
      const signed = readSignedMessageFile(path);
      if (options.offline && options.minConf !== undefined) {
        throw new CLIError('--min-conf applies only without --offline.', 'INVALID_ARGUMENT_ERROR');
      }
      const records = IdentifierRecords.forHome(g);
      const did = records.resolveRef(options.identifier);
      const record = records.get(did);
      const network = deriveNetwork(did);
      const { hrp } = didApi.decode(did);
      if (options.offline && options.sidecar !== undefined && hrp === 'k') {
        throw new CLIError(
          '--sidecar with --offline applies only to external identifiers (x): the file gives the genesis document.',
          'INVALID_ARGUMENT_ERROR',
          { did },
        );
      }
      const flagOptions = readFlagOptions(options);
      let api: DidBtcr2Api;
      let document: Btcr2DidDocument;
      let basis: Pick<MessageVerifyData, 'checkedAgainst' | 'versionId'>;
      if (options.offline) {
        // An api with no connection: --offline reads no endpoint, so a bad
        // connection setting does not stop it.
        api = createApi();
        const genesisDocument = flagOptions?.sidecar?.genesisDocument ?? record?.sidecar.genesisDocument;
        if (hrp === 'x' && genesisDocument === undefined) {
          throw new CLIError(
            `An external identifier (x) needs its genesis document for --offline. Give it in the --sidecar file, `
              + `or add it to the record with "btcr2 identifier add ${did} --sidecar <path>".`,
            'INVALID_ARGUMENT_ERROR',
            { did },
          );
        }
        document = api.btcr2.getInitialDocument(did, genesisDocument);
        basis = { checkedAgainst: 'initial' };
        if (!g.quiet) {
          process.stderr.write(
            'Warning: --offline checks the initial DID document only. It does not see a later key rotation or deactivation.\n'
          );
        }
      } else {
        api = factory(network, g);
        warnProfileNetworkMismatch(g, network, g);
        const resolved = await resolveCurrent(api, did, withRecordSidecar(flagOptions, record));
        document = resolved.document;
        basis = { checkedAgainst: 'current', ...(resolved.versionId !== undefined && { versionId: resolved.versionId }) };
      }
      const report = api.btcr2.verifyMessage(document, signed);
      // Text mode prints the full report. `-q/--quiet` prints OK, or the failed
      // check (ADR 130). The detail can hold text of the file, so the line
      // escapes each control character.
      const failures = report.checks
        .filter(check => !check.ok)
        .map(check => escapeControlCharacters(`Message not verified (${check.name} check): ${check.detail ?? 'failed'}`));
      console.log(formatCheckResult({ action: 'message-verify', data: { ...report, ...basis } }, g, failures));
      if (!report.verified) process.exitCode = 1;
    });
}

/** The text with each control character as a `\uXXXX` escape, so that a terminal shows it and does not run it. */
function escapeControlCharacters(text: string): string {
  return text.replace(CONTROL_CHARACTER, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * The resolution options of the flags: the sidecar data of `--sidecar` and the
 * `minConf` of `--min-conf`. Returns `undefined` if neither flag is set.
 */
function readFlagOptions(flags: ResolutionFlags): ResolutionOptions | undefined {
  const sidecar = flags.sidecar === undefined ? undefined : readSidecarFile(flags.sidecar);
  if (sidecar === undefined && flags.minConf === undefined) return undefined;
  return {
    ...(sidecar !== undefined && { sidecar }),
    ...(flags.minConf !== undefined && { minConf: flags.minConf }),
  };
}

/**
 * Resolves the current DID document of an identifier. A failure throws a
 * `CLIError` with the resolution error code and one line of text.
 */
async function resolveCurrent(
  api     : DidBtcr2Api,
  did     : string,
  options : ResolutionOptions | undefined,
): Promise<{ document: Btcr2DidDocument; versionId?: string }> {
  const result = await api.tryResolveDid(did, options);
  if (!result.ok) {
    throw new CLIError(`Could not resolve ${did}: ${result.errorMessage ?? result.error}`, result.error, { did });
  }
  return { document: result.document, versionId: result.metadata?.versionId };
}

/**
 * Reads a signed message file as JSON. A `-o json` output of `message sign`
 * wraps the signed message in its envelope, so the function unwraps it. It
 * unwraps only an object with exactly the members `action` and `data`. Any
 * other object goes to the `structure` check unchanged, so a file cannot show a
 * member that the checks do not read.
 */
function readSignedMessageFile(path: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new CLIError(
      `Could not read the signed message file ${path}: ${(error as Error).message}`,
      'INVALID_ARGUMENT_ERROR',
      { path },
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return parsed;
  const envelope = parsed as Record<string, unknown>;
  const members = Object.keys(envelope).sort();
  if (members.length === 2 && members[0] === 'action' && members[1] === 'data' && envelope.action === 'message-sign') {
    return envelope.data;
  }
  return parsed;
}
