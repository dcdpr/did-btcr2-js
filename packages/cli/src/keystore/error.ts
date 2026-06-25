import { DidMethodError } from '@did-btcr2/common';

/**
 * Error raised by the CLI keystore layer: secret-envelope encryption and
 * decryption, on-disk file permission enforcement, and passphrase acquisition.
 *
 * Unlike {@link CLIError} (whose `name` is fixed to `'CLIError'`), this follows
 * the {@link DidMethodError} sibling convention where `name` mirrors the `type`
 * code, so a thrown error's `name` reflects the specific failure category
 * (for example `DECRYPT_ERROR` or `KEYSTORE_PERMISSION_ERROR`).
 */
export class KeyStoreError extends DidMethodError {
  constructor(message: string, type: string = 'KeyStoreError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}
