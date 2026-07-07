import type { HashBytes } from '@did-btcr2/common';
import { canonicalize, decode as decodeHash, encode as encodeHash } from '@did-btcr2/common';
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
  /**
   * Whether this executor supports publishing. `undefined` MUST be treated as
   * `true`: an executor that does not declare the capability is assumed
   * writable, so existing custom executors keep working unchanged. Read-only
   * executors (e.g. {@link HttpGatewayCasExecutor}) set `false`, letting
   * callers route around `publish()` instead of discovering the limitation
   * as a thrown error mid-operation.
   */
  readonly canPublish?: boolean;
}

/**
 * Derive the CIDv1 (raw codec, SHA-256) for a base64url-encoded content hash.
 * The CID is deterministic in the content hash, so lookups by base64url
 * SHA-256 hash translate directly to CID lookups.
 */
function cidForHash(hash: string): CID {
  const hashBytes = decodeHash(hash, 'base64urlnopad');
  return CID.create(1, raw.code, createDigest(sha256.code, hashBytes));
}

/**
 * Minimal structural view of an IPFS blockstore: get/put raw blocks by CID.
 *
 * Matches the `blockstore` property of an in-process IPFS node (e.g. a Helia
 * instance), so one can be plugged in without this package depending on an
 * IPFS implementation.
 * @public
 */
export interface BlockstoreLike {
  /** Retrieve a raw block by CID. Expected to throw if the block is not found. */
  get(cid: CID): Promise<Uint8Array>;
  /** Store a raw block under the given CID. */
  put(cid: CID, block: Uint8Array): Promise<unknown>;
}

/**
 * Anything exposing a {@link BlockstoreLike} `blockstore` property,
 * e.g. an in-process IPFS node instance.
 * @public
 */
export interface BlockstoreProviderLike {
  blockstore: BlockstoreLike;
}

/**
 * {@link CasExecutor} backed by a caller-supplied in-process blockstore.
 *
 * Stores/retrieves data as raw blocks (`0x55` codec) with SHA-256 hashing.
 * The CID is deterministically derived from the content hash, so lookups
 * by base64url SHA-256 hash translate directly to CID lookups.
 * @public
 */
export class BlockstoreCasExecutor implements CasExecutor {
  readonly #blockstore: BlockstoreLike;

  constructor(store: BlockstoreLike | BlockstoreProviderLike) {
    this.#blockstore = 'blockstore' in store ? store.blockstore : store;
  }

  async retrieve(hash: string): Promise<Uint8Array | null> {
    try {
      return await this.#blockstore.get(cidForHash(hash));
    } catch {
      return null;
    }
  }

  async publish(data: Uint8Array): Promise<string> {
    const digest = await sha256.digest(data);
    const cid = CID.createV1(raw.code, digest);
    await this.#blockstore.put(cid, data);
    return encodeHash(digest.digest, 'base64urlnopad');
  }
}

/**
 * Read-write {@link CasExecutor} backed by the IPFS HTTP RPC API
 * (the interface a Kubo node exposes, default port 5001).
 *
 * Publishes raw blocks via `block/put` (pinned, raw codec, SHA-256) and
 * retrieves them via `block/get`, using plain `fetch`: no in-process IPFS
 * node required. `publish` verifies that the CID returned by the node
 * matches the CID derived locally from the content hash, so a misconfigured
 * node cannot silently store content under a different address.
 * @public
 */
export class IpfsRpcCasExecutor implements CasExecutor {
  readonly #rpcUrl: string;

  constructor(rpcUrl: string) {
    this.#rpcUrl = rpcUrl.replace(/\/+$/, '');
  }

  async retrieve(hash: string): Promise<Uint8Array | null> {
    const cid = cidForHash(hash);
    try {
      // The RPC API accepts POST only.
      const res = await fetch(`${this.#rpcUrl}/api/v0/block/get?arg=${cid.toString()}`, {
        method : 'POST',
      });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  async publish(data: Uint8Array): Promise<string> {
    const digest = await sha256.digest(data);
    const cid = CID.createV1(raw.code, digest);
    const body = new FormData();
    body.append('file', new Blob([Uint8Array.from(data)]));
    const res = await fetch(`${this.#rpcUrl}/api/v0/block/put?cid-codec=raw&mhtype=sha2-256&pin=true`, {
      method : 'POST',
      body,
    });
    if (!res.ok) {
      throw new Error(`IPFS RPC block/put failed: ${res.status} ${res.statusText}`);
    }
    const { Key: returnedCid } = await res.json() as { Key?: string };
    if (returnedCid !== cid.toString()) {
      throw new Error(
        `IPFS RPC block/put returned unexpected CID: expected ${cid.toString()}, got ${returnedCid}`
      );
    }
    return encodeHash(digest.digest, 'base64urlnopad');
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
 * Publishing is not supported: use {@link IpfsRpcCasExecutor} against a
 * node's RPC endpoint, or {@link BlockstoreCasExecutor} with an in-process
 * blockstore, for writes.
 * @public
 */
export class HttpGatewayCasExecutor implements CasExecutor {
  readonly canPublish = false;
  readonly #gatewayUrl: string;

  constructor(gatewayUrl: string) {
    this.#gatewayUrl = gatewayUrl.replace(/\/+$/, '');
  }

  async retrieve(hash: string): Promise<Uint8Array | null> {
    const cid = cidForHash(hash);
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
      + 'Publishing requires an IPFS node (use IpfsRpcCasExecutor or BlockstoreCasExecutor).'
    );
  }
}

/** Default timeout (ms) for CAS operations. */
export const DEFAULT_CAS_TIMEOUT_MS = 30_000;

/**
 * Configuration for the CAS (Content-Addressed Storage) driver.
 *
 * Provide exactly one of `executor`, `blockstore`, `rpcUrl`, or `gateway`.
 * Priority if multiple are set: `executor` > `blockstore` > `rpcUrl` > `gateway`.
 * @public
 */
export type CasConfig = {
  /** Custom executor implementation (overrides all other options). */
  executor?: CasExecutor;
  /** In-process blockstore, or anything exposing one (e.g. an IPFS node instance). */
  blockstore?: BlockstoreLike | BlockstoreProviderLike;
  /** IPFS HTTP RPC API endpoint for read-write CAS access (e.g. `'http://127.0.0.1:5001'`). */
  rpcUrl?: string;
  /** IPFS HTTP gateway URL for read-only CAS access (e.g. `'https://ipfs.io'`). */
  gateway?: string;
  /**
   * Timeout in milliseconds for CAS operations. Prevents indefinite hangs
   * when a blockstore lookup, RPC call, or gateway request stalls.
   * Default: 30 000 ms. Set to `0` to disable.
   */
  timeoutMs?: number;
};

/**
 * Content-Addressed Storage API sub-facade.
 *
 * Provides `publish` and `retrieve` for JSON objects using their
 * JCS-canonicalized SHA-256 hash as the content address.
 *
 * The backend is selected from {@link CasConfig}: a custom executor, an
 * in-process blockstore, an IPFS RPC endpoint, or a read-only HTTP gateway.
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
    } else if (config.blockstore) {
      this.#executor = new BlockstoreCasExecutor(config.blockstore);
    } else if (config.rpcUrl) {
      this.#executor = new IpfsRpcCasExecutor(config.rpcUrl);
    } else if (config.gateway) {
      this.#executor = new HttpGatewayCasExecutor(config.gateway);
    } else {
      throw new Error(
        'CAS configuration requires an executor, blockstore, RPC URL, or gateway URL. '
        + 'Example: createApi({ cas: { gateway: \'https://ipfs.io\' } })'
      );
    }
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_CAS_TIMEOUT_MS;
  }

  /**
   * Whether the configured executor supports publishing. `true` unless the
   * executor explicitly declares `canPublish: false` (an executor that does
   * not declare the capability is assumed writable, per {@link CasExecutor}).
   */
  get writable(): boolean {
    return this.#executor.canPublish !== false;
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
