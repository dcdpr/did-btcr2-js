import type { HashBytes } from '@did-btcr2/common';
import { canonicalize, decode as decodeHash, encode as encodeHash } from '@did-btcr2/common';
import type { Helia } from 'helia';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { create as createDigest } from 'multiformats/hashes/digest';
import { sha256 } from 'multiformats/hashes/sha2';

/** Default IPFS HTTP gateway used for CAS reads when no CAS config is provided. */
export const DEFAULT_CAS_GATEWAY = 'https://ipfs.io';

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
    const hashBytes = decodeHash(hash, 'base64urlnopad');
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
 * Read-only {@link CasExecutor} backed by an IPFS HTTP gateway.
 *
 * Converts the base64url SHA-256 hash to a CIDv1 (raw codec) and fetches
 * the raw block via the
 * {@link https://specs.ipfs.tech/http-gateways/trustless-gateway/ | Trustless Gateway}
 * protocol.
 *
 * Publishing is not supported — use {@link IpfsCasExecutor} with a Helia
 * instance for writes.
 * @public
 */
export class HttpGatewayCasExecutor implements CasExecutor {
  readonly #gatewayUrl: string;

  constructor(gatewayUrl: string) {
    this.#gatewayUrl = gatewayUrl.replace(/\/+$/, '');
  }

  async retrieve(hash: string): Promise<Uint8Array | null> {
    const hashBytes = decodeHash(hash, 'base64urlnopad');
    const cid = CID.create(1, raw.code, createDigest(sha256.code, hashBytes));
    try {
      const res = await fetch(`${this.#gatewayUrl}/ipfs/${cid.toString()}?format=raw`, {
        headers : { Accept: 'application/vnd.ipld.raw' },
      });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  async publish(): Promise<string> {
    throw new Error(
      'HttpGatewayCasExecutor is read-only. '
      + 'Publishing requires a full IPFS node (use IpfsCasExecutor with Helia).'
    );
  }
}

/** Default timeout (ms) for CAS operations. */
export const DEFAULT_CAS_TIMEOUT_MS = 30_000;

/**
 * Configuration for the CAS (Content-Addressed Storage) driver.
 *
 * Provide exactly one of `executor`, `helia`, or `gateway`.
 * Priority if multiple are set: `executor` > `helia` > `gateway`.
 * @public
 */
export type CasConfig = {
  /** Custom executor implementation (overrides all other options). */
  executor?: CasExecutor;
  /** Pre-existing Helia instance for the default IPFS executor. */
  helia?: Helia;
  /** IPFS HTTP gateway URL for read-only CAS access (e.g. `'https://ipfs.io'`). */
  gateway?: string;
  /**
   * Timeout in milliseconds for CAS operations. Prevents indefinite hangs
   * when a Helia DHT lookup or gateway request stalls. Default: 30 000 ms.
   * Set to `0` to disable.
   */
  timeoutMs?: number;
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
  readonly #timeoutMs: number;

  constructor(config: CasConfig) {
    if (config.executor) {
      this.#executor = config.executor;
    } else if (config.helia) {
      this.#executor = new IpfsCasExecutor(config.helia);
    } else if (config.gateway) {
      this.#executor = new HttpGatewayCasExecutor(config.gateway);
    } else {
      throw new Error(
        'CAS configuration requires an executor, Helia instance, or gateway URL. '
        + 'Example: createApi({ cas: { gateway: \'https://ipfs.io\' } })'
      );
    }
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_CAS_TIMEOUT_MS;
  }

  /**
   * Retrieve a JSON object from the CAS by its SHA-256 hash bytes.
   * @param hashBytes Raw SHA-256 hash bytes of the JCS-canonicalized object.
   * @returns The parsed JSON object, or `null` if not found.
   */
  async retrieve(hashBytes: HashBytes): Promise<object | null> {
    const hash = encodeHash(hashBytes, 'base64urlnopad');
    const bytes = await this.#withTimeout(this.#executor.retrieve(hash));
    if (!bytes) return null;
    return JSON.parse(new TextDecoder().decode(bytes)) as object;
  }

  /**
   * Publish a JSON object to the CAS.
   * The object is JCS-canonicalized before storage; the returned hash
   * matches what `canonicalHash` (from @did-btcr2/common) would produce.
   * @param object The JSON object to publish.
   * @returns The base64url-encoded SHA-256 hash (content address).
   */
  async publish(object: object): Promise<string> {
    const bytes = new TextEncoder().encode(canonicalize(object as Record<string, any>));
    return await this.#withTimeout(this.#executor.publish(bytes));
  }

  /**
   * Wraps a promise with a timeout. If `#timeoutMs` is 0, no timeout is applied.
   */
  #withTimeout<T>(promise: Promise<T>): Promise<T> {
    if (!this.#timeoutMs) return promise;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`CAS operation timed out after ${this.#timeoutMs}ms`)),
        this.#timeoutMs
      );
      promise.then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  }
}
