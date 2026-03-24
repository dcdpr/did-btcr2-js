import { canonicalize, decode as decodeHash } from '@did-btcr2/common';
import type { Helia } from 'helia';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { create as createDigest } from 'multiformats/hashes/digest';
import { sha256 } from 'multiformats/hashes/sha2';
import { assertString } from './helpers.js';

/**
 * Executor interface for content-addressed storage.
 *
 * Implementations handle the actual I/O (IPFS, HTTP gateway, local store, etc.).
 * All hashes are base64url-encoded SHA-256 digests (no padding).
 * @public
 */
export interface CasExecutor {
  /** Retrieve raw bytes by base64url SHA-256 hash. Returns null if not found. */
  retrieve(hash: string): Promise<Uint8Array | null>;
  /** Publish raw bytes and return the base64url SHA-256 hash. */
  publish(data: Uint8Array): Promise<string>;
}

/**
 * Default {@link CasExecutor} backed by IPFS via Helia.
 *
 * Stores/retrieves data as raw blocks (`0x55` codec) with SHA-256 hashing.
 * The CID is deterministically derived from the content hash, so lookups
 * by base64url SHA-256 hash translate directly to CID lookups.
 * @public
 */
export class IpfsCasExecutor implements CasExecutor {
  readonly #helia: Helia;

  constructor(helia: Helia) {
    this.#helia = helia;
  }

  async retrieve(hash: string): Promise<Uint8Array | null> {
    const hashBytes = decodeHash(hash, 'base64url');
    const cid = CID.create(1, raw.code, createDigest(sha256.code, hashBytes));
    try {
      return await this.#helia.blockstore.get(cid);
    } catch {
      return null;
    }
  }

  async publish(data: Uint8Array): Promise<string> {
    const digest = await sha256.digest(data);
    const cid = CID.createV1(raw.code, digest);
    await this.#helia.blockstore.put(cid, data);
    // Return base64url-encoded hash (no padding)
    return btoa(String.fromCharCode(...digest.bytes.slice(2)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}

/**
 * Configuration for the CAS (Content-Addressed Storage) driver.
 * @public
 */
export type CasConfig = {
  /** Custom executor implementation (overrides the default IPFS executor). */
  executor?: CasExecutor;
  /** Pre-existing Helia instance for the default IPFS executor. */
  helia?: Helia;
};

/**
 * Content-Addressed Storage API sub-facade.
 *
 * Provides `publish` and `retrieve` for JSON objects using their
 * JCS-canonicalized SHA-256 hash as the content address.
 *
 * By default uses IPFS (via Helia). Inject a custom {@link CasExecutor}
 * to use a different CAS backend.
 *
 * Lazily initialized by {@link DidBtcr2Api} to avoid startup overhead
 * when CAS features are not used.
 * @public
 */
export class CasApi {
  readonly #executor: CasExecutor;

  constructor(config: CasConfig) {
    if (config.executor) {
      this.#executor = config.executor;
    } else if (config.helia) {
      this.#executor = new IpfsCasExecutor(config.helia);
    } else {
      throw new Error(
        'CAS configuration requires either an executor or a Helia instance. '
        + 'Example: createApi({ cas: { helia: await createHelia() } })'
      );
    }
  }

  /**
   * Retrieve a JSON object from the CAS by its base64url SHA-256 hash.
   * @param hash Base64url-encoded SHA-256 hash of the JCS-canonicalized object.
   * @returns The parsed JSON object, or `null` if not found.
   */
  async retrieve(hash: string): Promise<object | null> {
    assertString(hash, 'hash');
    const bytes = await this.#executor.retrieve(hash);
    if (!bytes) return null;
    return JSON.parse(new TextDecoder().decode(bytes)) as object;
  }

  /**
   * Publish a JSON object to the CAS.
   * The object is JCS-canonicalized before storage; the returned hash
   * matches what {@link canonicalHash} would produce.
   * @param object The JSON object to publish.
   * @returns The base64url-encoded SHA-256 hash (content address).
   */
  async publish(object: object): Promise<string> {
    const bytes = new TextEncoder().encode(canonicalize(object as Record<string, any>));
    return await this.#executor.publish(bytes);
  }
}
