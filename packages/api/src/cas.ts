import type { HashBytes } from '@did-btcr2/common';
import { canonicalize, decode as decodeHash, encode as encodeHash, MethodError } from '@did-btcr2/common';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { create as createDigest } from 'multiformats/hashes/digest';
import { sha256 } from 'multiformats/hashes/sha2';

/** Default IPFS HTTP gateway used for CAS reads when no CAS config is provided. */
export const DEFAULT_CAS_GATEWAY = 'https://ipfs.io';

/**
 * Default maximum accepted CAS response body size (1 MiB). Unbounded
 * `res.arrayBuffer()` on a hostile gateway is a memory-DoS (audit N4); btcr2
 * CAS artifacts (updates, announcements, genesis documents) are far below
 * this bound. Configurable via {@link CasConfig.maxResponseBytes}.
 */
export const DEFAULT_MAX_CAS_RESPONSE_BYTES = 1024 * 1024;

/**
 * Read a fetch response body as bytes, rejecting bodies larger than
 * `maxBytes` (audit N4). Streams when possible so an over-limit body is cut
 * off before it is fully buffered.
 *
 * @throws {Error} If the body exceeds `maxBytes`.
 */
async function readBytesWithLimit(res: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = res.headers.get('Content-Length');
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`CAS response exceeds ${maxBytes}-byte limit (declared Content-Length: ${declared})`);
    }
  }

  const body = res.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value?.byteLength ?? 0;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch { /* best effort */ }
          throw new Error(`CAS response exceeds ${maxBytes}-byte limit`);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new Error(`CAS response exceeds ${maxBytes}-byte limit`);
  }
  return bytes;
}

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
  readonly #maxResponseBytes: number;

  constructor(rpcUrl: string, maxResponseBytes: number = DEFAULT_MAX_CAS_RESPONSE_BYTES) {
    this.#rpcUrl = rpcUrl.replace(/\/+$/, '');
    this.#maxResponseBytes = maxResponseBytes;
  }

  async retrieve(hash: string): Promise<Uint8Array | null> {
    const cid = cidForHash(hash);
    try {
      // The RPC API accepts POST only.
      const res = await fetch(`${this.#rpcUrl}/api/v0/block/get?arg=${cid.toString()}`, {
        method : 'POST',
      });
      if (!res.ok) return null;
      // Size-capped read: an unbounded buffer on a hostile node is a
      // memory-DoS; an over-limit block is treated as unusable (audit N4).
      return await readBytesWithLimit(res, this.#maxResponseBytes);
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
  readonly #maxResponseBytes: number;

  constructor(gatewayUrl: string, maxResponseBytes: number = DEFAULT_MAX_CAS_RESPONSE_BYTES) {
    this.#gatewayUrl = gatewayUrl.replace(/\/+$/, '');
    this.#maxResponseBytes = maxResponseBytes;
  }

  async retrieve(hash: string): Promise<Uint8Array | null> {
    const cid = cidForHash(hash);
    try {
      const res = await fetch(`${this.#gatewayUrl}/ipfs/${cid.toString()}?format=raw`, {
        headers : { Accept: 'application/vnd.ipld.raw' },
      });
      if (!res.ok) return null;
      // Size-capped read: an unbounded buffer on a hostile gateway is a
      // memory-DoS; an over-limit block is treated as unusable (audit N4).
      return await readBytesWithLimit(res, this.#maxResponseBytes);
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
   * Maximum accepted CAS response body size in bytes (audit N4). Applies to
   * the HTTP-backed executors (`rpcUrl`, `gateway`). Default: 1 MiB.
   */
  maxResponseBytes?: number;
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
      this.#executor = new IpfsRpcCasExecutor(config.rpcUrl, config.maxResponseBytes);
    } else if (config.gateway) {
      this.#executor = new HttpGatewayCasExecutor(config.gateway, config.maxResponseBytes);
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
   *
   * The retrieved bytes are verified against the requested hash before
   * parsing (audit N5): content-addressed storage must return the content
   * that hashes to the address, and anything else is an integrity failure.
   * @param hashBytes Raw SHA-256 hash bytes of the JCS-canonicalized object.
   * @returns The parsed JSON object, or `null` if not found.
   * @throws {MethodError} `CAS_INTEGRITY_ERROR` if the retrieved bytes do not
   *   hash to the requested address.
   */
  async retrieve(hashBytes: HashBytes): Promise<object | null> {
    const hash = encodeHash(hashBytes, 'base64urlnopad');
    const bytes = await this.#withTimeout(this.#executor.retrieve(hash));
    if (!bytes) return null;
    const actual = await sha256.digest(bytes);
    if (actual.digest.length !== hashBytes.length || !actual.digest.every((b, i) => b === hashBytes[i])) {
      throw new MethodError(
        'CAS integrity check failed: retrieved bytes do not hash to the requested address',
        'CAS_INTEGRITY_ERROR',
        { hash }
      );
    }
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
