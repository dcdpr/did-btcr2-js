import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { createApi } from '@did-btcr2/api';
import type { ApiFactory } from '../src/config.js';
import type { ArgonParams } from '../src/keystore/envelope.js';
import { FileBackedKeyManager } from '../src/keystore/file-backed-key-manager.js';

chai.use(chaiAsPromised);
export const { expect } = chai;

export const originalConsoleLog = console.log;
export const originalConsoleError = console.error;
export const originalConsoleWarn = console.warn;

/** Low-cost argon2id parameters so keystore-backed tests stay fast. */
const FAST_ARGON: ArgonParams = { t: 1, m: 256, p: 1, dkLen: 32 };

/**
 * Creates an {@link ApiFactory} for testing.
 * No Bitcoin or CAS configured - suitable for create-only tests and
 * argument-validation tests (which throw before reaching the API).
 */
export function createTestApiFactory(): ApiFactory {
  return () => createApi();
}

/**
 * Creates a keystore-backed {@link ApiFactory} for testing, using a temporary
 * keystore path, a fixed passphrase, and low-cost argon parameters so signing
 * key tests do not pay the production key-derivation cost.
 */
export function createKeystoreTestApiFactory(keystorePath: string, passphrase: string): ApiFactory {
  return () => createApi({
    kms : new FileBackedKeyManager({
      path          : keystorePath,
      getPassphrase : () => passphrase,
      argonParams   : FAST_ARGON,
    }),
  });
}
