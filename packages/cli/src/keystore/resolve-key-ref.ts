import type { KeyIdentifier, KeyManager } from '@did-btcr2/key-manager';
import { CLIError } from '../error.js';

/** Extracts the 32-hex fingerprint from a `urn:kms:secp256k1:<hex>` identifier. */
function fingerprintOf(id: KeyIdentifier): string | undefined {
  return /^urn:kms:secp256k1:([0-9a-f]{32})$/.exec(id)?.[1];
}

/**
 * Resolves a user-supplied key reference to a key identifier. Resolution order:
 * 1. No reference: the active key (errors if none is set).
 * 2. Exact URN identifier match.
 * 3. Unique `name` tag match (an exact name wins over a fuzzy fingerprint prefix,
 *    so a hex-looking name like "cafe" is never shadowed by another key's fingerprint).
 * 4. Unique fingerprint-prefix match (against the hex tail of the URN).
 *
 * Reads only public material (listKeys + getEntry), so resolving a reference
 * never decrypts a secret or prompts for a passphrase.
 *
 * @param kms The key manager to resolve against.
 * @param ref The reference to resolve. When omitted, the active key is used.
 * @returns The resolved key identifier.
 * @throws {CLIError} If no key matches, the reference is ambiguous, or no
 *   reference is given and no active key is set.
 */
export function resolveKeyRef(kms: KeyManager, ref?: string): KeyIdentifier {
  if (!ref) {
    if (!kms.activeKeyId) {
      throw new CLIError(
        'No key specified and no active key is set. Use --key <ref> or set one with `btcr2 key use <ref>`.',
        'INVALID_ARGUMENT_ERROR',
      );
    }
    return kms.activeKeyId;
  }

  const ids = kms.listKeys();

  if (ids.includes(ref)) return ref;

  // An exact name match takes precedence over a fuzzy fingerprint prefix: a name
  // the caller chose is more specific than a partial fingerprint, and a name can
  // itself be valid hex (e.g. "cafe") that must not be shadowed by another key's
  // fingerprint.
  const byName = ids.filter(id => kms.getEntry(id).tags?.name === ref);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new CLIError(
      `Ambiguous key name "${ref}" matches ${byName.length} keys.`,
      'KEY_REF_AMBIGUOUS_ERROR',
      { ref },
    );
  }

  const prefix = ref.toLowerCase();
  const byPrefix = ids.filter(id => fingerprintOf(id)?.startsWith(prefix));
  if (byPrefix.length === 1) return byPrefix[0];
  if (byPrefix.length > 1) {
    throw new CLIError(
      `Ambiguous key reference "${ref}" matches ${byPrefix.length} keys by fingerprint.`,
      'KEY_REF_AMBIGUOUS_ERROR',
      { ref },
    );
  }

  throw new CLIError(`No key matches reference "${ref}".`, 'KEY_NOT_FOUND_ERROR', { ref });
}
