import { toBase64 } from '@did-btcr2/bitcoin';
import type { HashBytes } from '@did-btcr2/std';
import { canonicalize, decode as decodeHash, encode as encodeHash, MISSING_UPDATE_DATA, ResolveError } from '@did-btcr2/std';
import { equals as equalBytes } from 'multiformats/bytes';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { create as createDigest } from 'multiformats/hashes/digest';
import { identity } from 'multiformats/hashes/identity';
import { sha256 } from 'multiformats/hashes/sha2';
import { messageText } from './helpers.js';

/**
 * Default IPFS HTTP gateway used for CAS reads when no CAS config is provided.
 * It is a public {@link https://specs.ipfs.tech/http-gateways/trustless-gateway/ | Trustless Gateway}:
 * it serves the raw blocks that {@link HttpGatewayCasExecutor} requests, with CORS
 * headers, so a browser can read from it. `CasApi.retrieve` verifies the hash of each block.
 */
export const DEFAULT_CAS_GATEWAY = 'https://trustless-gateway.link';

/**
 * Executor interface for content-addressed storage.
 *
 * Implementations handle the actual I/O (IPFS, HTTP gateway, local store, etc.).
 * All hashes are base64url-encoded SHA-256 digests (no padding).
 * @public
 */
export interface CasExecutor {
  /**
   * Retrieve raw bytes by their base64url SHA-256 hash. Returns `null` if the
   * executor does not find the content.
   * @param signal Aborts the read. The built-in executors then reject with the
   *   reason of the signal. They do not return `null`.
   */
  retrieve(hash: string, signal?: AbortSignal): Promise<Uint8Array | null>;
  /**
   * Publish raw bytes and return the base64url SHA-256 hash.
   * @param signal Aborts the write.
   */
  publish(data: Uint8Array, signal?: AbortSignal): Promise<string>;
  /**
   * Whether this executor supports publishing. `undefined` MUST be treated as
   * `true`: an executor that does not declare the capability is assumed
   * writable, so existing custom executors keep working unchanged. Read-only
   * executors (e.g. {@link HttpGatewayCasExecutor}) set `false`, letting
   * callers route around `publish()` instead of discovering the limitation
   * as a thrown error mid-operation.
   */
  readonly canPublish?: boolean;
  /**
   * Optional check of the backend, for a health report. It reads a fixed identity
   * block through the same request as {@link CasExecutor.retrieve} and compares the
   * bytes. The backend answers that block from the CID itself, with no network
   * retrieval, and the check writes nothing. Resolves if the backend answers with the
   * block. Rejects with the reason otherwise.
   * @param signal Aborts the check.
   */
  probe?(signal?: AbortSignal): Promise<void>;
}

/** The bytes of {@link PROBE_CID}. */
const PROBE_BYTES = new TextEncoder().encode('did:btcr2');

/**
 * The block that a probe reads: an identity CID (raw codec) that holds
 * {@link PROBE_BYTES} in its digest. An IPFS node or gateway answers it from the CID
 * itself. So a probe tests the endpoint, and not the availability of content.
 */
const PROBE_CID = CID.create(1, raw.code, identity.digest(PROBE_BYTES));

/** Throw if the bytes of a probe response are not the probe block. */
function assertProbeBlock(bytes: Uint8Array): void {
  if (!equalBytes(bytes, PROBE_BYTES)) {
    throw new Error(`The response is not the probe block ${PROBE_CID.toString()} (${bytes.length} bytes).`);
  }
}

/**
 * The result of a read that fails: `null`, for content that is not available.
 * After an abort, the read has no result, so the function throws the reason of the signal.
 */
function failedRead(signal: AbortSignal | undefined): null {
  signal?.throwIfAborted();
  return null;
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
  /**
   * Retrieve a raw block by CID. The method must throw if it does not find the block.
   * `options.signal` aborts the read.
   */
  get(cid: CID, options?: { signal?: AbortSignal }): Promise<Uint8Array>;
  /** Store a raw block under the given CID. `options.signal` aborts the write. */
  put(cid: CID, block: Uint8Array, options?: { signal?: AbortSignal }): Promise<unknown>;
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

  async retrieve(hash: string, signal?: AbortSignal): Promise<Uint8Array | null> {
    try {
      return await this.#blockstore.get(cidForHash(hash), { signal });
    } catch {
      return failedRead(signal);
    }
  }

  async publish(data: Uint8Array, signal?: AbortSignal): Promise<string> {
    const digest = await sha256.digest(data);
    const cid = CID.createV1(raw.code, digest);
    await this.#blockstore.put(cid, data, { signal });
    return encodeHash(digest.digest, 'base64urlnopad');
  }
}

/**
 * The HTTP Basic credentials of an IPFS HTTP RPC endpoint, for a node behind a
 * reverse proxy that requires authentication.
 * @public
 */
export type IpfsRpcAuth = {
  username: string;
  password: string;
};

/**
 * Options of {@link IpfsRpcCasExecutor}.
 * @public
 */
export type IpfsRpcCasExecutorOptions = {
  /** The Basic credentials. The executor sends them with each RPC request. */
  auth?: IpfsRpcAuth;
};

/**
 * Read-write {@link CasExecutor} backed by the IPFS HTTP RPC API
 * (the interface a Kubo node exposes, default port 5001).
 *
 * Publishes raw blocks via `block/put` (pinned, raw codec, SHA-256) and
 * retrieves them via `block/get`, using plain `fetch`: no in-process IPFS
 * node required. `publish` verifies that the CID returned by the node
 * matches the CID derived locally from the content hash, so a misconfigured
 * node cannot silently store content under a different address.
 *
 * With `options.auth`, each request has an HTTP Basic `Authorization` header.
 * @public
 */
export class IpfsRpcCasExecutor implements CasExecutor {
  readonly #rpcUrl: string;
  readonly #headers: Record<string, string>;

  constructor(rpcUrl: string, options: IpfsRpcCasExecutorOptions = {}) {
    this.#rpcUrl = rpcUrl.replace(/\/+$/, '');
    const { auth } = options;
    this.#headers = auth
      ? { Authorization: `Basic ${toBase64(`${auth.username}:${auth.password}`)}` }
      : {};
  }

  async retrieve(hash: string, signal?: AbortSignal): Promise<Uint8Array | null> {
    try {
      return await this.#blockGet(cidForHash(hash), signal);
    } catch {
      return failedRead(signal);
    }
  }

  /**
   * Read the probe block with `block/get`, the request of {@link retrieve}.
   * The check does not call `block/put`, so it does not prove that a write works.
   * @throws {Error} If the node does not answer with the probe block.
   */
  async probe(signal?: AbortSignal): Promise<void> {
    assertProbeBlock(await this.#blockGet(PROBE_CID, signal));
  }

  /** Get a raw block with `block/get`. Throws on a status that is not OK. */
  async #blockGet(cid: CID, signal?: AbortSignal): Promise<Uint8Array> {
    // The RPC API accepts POST only.
    const res = await fetch(`${this.#rpcUrl}/api/v0/block/get?arg=${cid.toString()}`, {
      method  : 'POST',
      headers : this.#headers,
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async publish(data: Uint8Array, signal?: AbortSignal): Promise<string> {
    const digest = await sha256.digest(data);
    const cid = CID.createV1(raw.code, digest);
    const body = new FormData();
    body.append('file', new Blob([Uint8Array.from(data)]));
    const res = await fetch(`${this.#rpcUrl}/api/v0/block/put?cid-codec=raw&mhtype=sha2-256&pin=true`, {
      method  : 'POST',
      headers : this.#headers,
      body,
      signal,
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

  async retrieve(hash: string, signal?: AbortSignal): Promise<Uint8Array | null> {
    try {
      return await this.#getBlock(cidForHash(hash), signal);
    } catch {
      return failedRead(signal);
    }
  }

  /**
   * Read the probe block through the request of {@link retrieve}.
   * @throws {Error} If the gateway does not answer with the probe block.
   */
  async probe(signal?: AbortSignal): Promise<void> {
    assertProbeBlock(await this.#getBlock(PROBE_CID, signal));
  }

  /** Get a raw block by the Trustless Gateway protocol. Throws on a status that is not OK. */
  async #getBlock(cid: CID, signal?: AbortSignal): Promise<Uint8Array> {
    const res = await fetch(`${this.#gatewayUrl}/ipfs/${cid.toString()}?format=raw`, {
      headers : { Accept: 'application/vnd.ipld.raw' },
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
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
 * Set one of `executor`, `blockstore`, `rpcUrl`, or `gateways`. If a config sets more
 * than one, `CasApi` uses this priority: `executor` > `blockstore` > `rpcUrl` > `gateways`.
 * @public
 */
export type CasConfig = {
  /** Custom executor implementation (overrides all other options). */
  executor?: CasExecutor;
  /** In-process blockstore, or anything exposing one (e.g. an IPFS node instance). */
  blockstore?: BlockstoreLike | BlockstoreProviderLike;
  /** IPFS HTTP RPC API endpoint for read-write CAS access (e.g. `'http://127.0.0.1:5001'`). */
  rpcUrl?: string;
  /**
   * The HTTP Basic credentials of `rpcUrl`, for a node behind a reverse proxy
   * that requires authentication. Only `rpcUrl` uses them.
   */
  rpcAuth?: IpfsRpcAuth;
  /**
   * The URLs of IPFS HTTP gateways for read-only CAS access, in the order of the reads.
   * For example: `['https://trustless-gateway.link']`. `CasApi.retrieve` reads from the
   * next gateway if a gateway has no content, does not answer in time, or gives bytes
   * with a different hash. An empty list is not a backend.
   */
  gateways?: readonly string[];
  /**
   * Timeout in milliseconds for CAS operations. At the timeout, `CasApi` aborts a
   * blockstore lookup, an RPC call, or a gateway request that does not answer. The
   * timeout applies to the read of each gateway in `gateways`.
   * Default: 30 000 ms. If the value is `0`, no timeout applies.
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
 * in-process blockstore, an IPFS RPC endpoint, or a list of read-only HTTP gateways.
 *
 * Lazily initialized by {@link DidBtcr2Api} to avoid startup overhead
 * when CAS features are not used.
 * @public
 */
export class CasApi {
  /**
   * The sources, in the order of the reads. Only a list of gateways has more than
   * one source, and a gateway cannot publish. So `publish` uses only the first source.
   */
  readonly #sources: CasSource[];
  readonly #timeoutMs: number;

  constructor(config: CasConfig) {
    if (config.executor) {
      this.#sources = [{ name: 'executor', executor: config.executor }];
    } else if (config.blockstore) {
      this.#sources = [{ name: 'blockstore', executor: new BlockstoreCasExecutor(config.blockstore) }];
    } else if (config.rpcUrl) {
      this.#sources = [{ name: config.rpcUrl, executor: new IpfsRpcCasExecutor(config.rpcUrl, { auth: config.rpcAuth }) }];
    } else if (config.gateways?.length) {
      this.#sources = config.gateways.map((url) => ({ name: url, executor: new HttpGatewayCasExecutor(url) }));
    } else {
      throw new Error(
        'CAS configuration requires an executor, blockstore, RPC URL, or gateway URL. '
        + 'Example: createApi({ cas: { gateways: [\'https://trustless-gateway.link\'] } })'
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
    return this.#sources[0].executor.canPublish !== false;
  }

  /**
   * Retrieve a JSON object from the CAS by its SHA-256 hash bytes.
   *
   * The specification requires a resolver to compute the SHA-256 hash of the
   * retrieved content, to compare it to the hash used for the retrieval, and
   * to not use the content if the hashes differ. This method hashes the raw
   * bytes before it parses them.
   *
   * With a list of gateways, the method reads from each gateway in order. It stops
   * at the first bytes with the requested hash. The CAS timeout applies to the read
   * of each gateway.
   * @param hashBytes Raw SHA-256 hash bytes of the JCS-canonicalized object.
   * @returns The parsed JSON object, or `null` if each source returns `null`.
   * @throws {ResolveError} `MISSING_UPDATE_DATA` if no source gives bytes with the
   *         requested hash and one or more reads fail. A read fails if it times out,
   *         if the executor throws or rejects, or if the bytes do not hash to
   *         `hashBytes`. The content is then not available from the CAS. For a list
   *         of gateways, the message names each gateway and its result.
   * @throws {ResolveError} `MISSING_UPDATE_DATA` if the retrieved bytes are not
   *         UTF-8 JSON text of an object.
   */
  async retrieve(hashBytes: HashBytes): Promise<object | null> {
    const hash = encodeHash(hashBytes, 'base64urlnopad');
    let bytes: Uint8Array | null = null;
    // The reads that give no bytes with the requested hash, in the order of the sources.
    const misses: CasMiss[] = [];
    let failed = false;
    for (const { name, executor } of this.#sources) {
      let read: Uint8Array | null;
      try {
        read = await this.#withTimeout((signal) => executor.retrieve(hash, signal));
      } catch (cause) {
        // The read fails. The next source can give the content.
        misses.push({ gateway: name, cause });
        failed = true;
        continue;
      }
      if (!read) {
        misses.push({ gateway: name });
        continue;
      }
      const actual = (await sha256.digest(read)).digest;
      if (!equalBytes(actual, hashBytes)) {
        // The resolver must not use these bytes. The next source can give the content.
        misses.push({ gateway: name, actual: encodeHash(actual, 'base64urlnopad') });
        failed = true;
        continue;
      }
      bytes = read;
      break;
    }
    if (!bytes) {
      if (!failed) return null;
      throw readError(hash, misses);
    }
    // The bytes have the requested hash. Each source that has these bytes gives the same bytes.
    let parsed: unknown;
    try {
      // RFC 8259, section 8.1: JSON text is UTF-8. A byte sequence that is not UTF-8 is not JSON.
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new ResolveError(`CAS content for ${hash} is not JSON.`, MISSING_UPDATE_DATA, { hash });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ResolveError(`CAS content for ${hash} is not a JSON object.`, MISSING_UPDATE_DATA, { hash });
    }
    return parsed;
  }

  /**
   * Check that the CAS backend answers a read, for a health report (for example
   * `btcr2 config doctor`). The executor reads a fixed identity block and compares
   * the bytes. The check aborts at the CAS timeout, and it writes nothing.
   * With a list of gateways, the method checks each gateway at the same time.
   * @throws {Error} If the executor has no `probe` method, if the backend does not
   *   answer with the block, or at the timeout. For a list of gateways, the error
   *   names each gateway that does not answer.
   */
  async probe(): Promise<void> {
    const results = await Promise.allSettled(this.#sources.map(({ executor }) => this.#withTimeout((signal) => {
      if (!executor.probe) throw new Error('The CAS executor has no probe method.');
      return executor.probe(signal);
    })));
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected' ? [{ gateway: this.#sources[index].name, cause: result.reason as unknown }] : []
    );
    if (!failures.length) return;
    if (this.#sources.length === 1) throw failures[0].cause;
    const reasons = failures.map(({ gateway, cause }) => `${gateway}: ${failureText(cause) ?? 'no answer'}`);
    throw new Error(`One or more CAS gateways do not answer: ${reasons.join('; ')}.`);
  }

  /**
   * Publish a JSON object to the CAS.
   * The object is JCS-canonicalized before storage; the returned hash
   * matches what `canonicalHash` (from @did-btcr2/std) would produce.
   * @param object The JSON object to publish.
   * @returns The base64url-encoded SHA-256 hash (content address).
   * @throws {CanonicalizationError} If the object has no JCS form (RFC 8785),
   *   for example if it holds NaN or a lone surrogate. The api then publishes nothing.
   */
  async publish(object: object): Promise<string> {
    const bytes = new TextEncoder().encode(canonicalize(object as Record<string, any>));
    return await this.#withTimeout((signal) => this.#sources[0].executor.publish(bytes, signal));
  }

  /**
   * Run one CAS operation with the CAS timeout. At the timeout, the method aborts
   * the signal of the operation and rejects. An executor that uses the signal then
   * aborts its request. The method also rejects at the timeout if an executor does
   * not use the signal. If `#timeoutMs` is 0, no timeout applies and the signal is
   * `undefined`.
   */
  #withTimeout<T>(run: (signal?: AbortSignal) => Promise<T>): Promise<T> {
    // If `run` throws before it returns a promise, the operation rejects.
    const start = (signal?: AbortSignal) => new Promise<T>((resolve) => resolve(run(signal)));
    if (!this.#timeoutMs) return start();
    const controller = new AbortController();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(`CAS operation timed out after ${this.#timeoutMs}ms`);
        controller.abort(error);
        reject(error);
      }, this.#timeoutMs);
      start(controller.signal).then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  }
}

/** A source of {@link CasApi}. In the errors of a list of gateways, the name is the gateway URL. */
type CasSource = { name: string; executor: CasExecutor };

/**
 * A read from one source that gives no bytes with the requested hash. Cases: the executor
 * returns `null`, the read fails (`cause`), or the bytes have a different hash (`actual`).
 */
type CasMiss = { gateway: string; cause?: unknown; actual?: string };

/** The text of a failure, or `undefined` for a cause with no text. */
function failureText(cause: unknown): string | undefined {
  return cause instanceof Error ? cause.message : messageText(cause);
}

/**
 * The error of a read that gives no bytes with the requested hash. With one source, the
 * error shows the failure of that source. With a list of gateways, the error names each
 * gateway and its result.
 */
function readError(hash: string, misses: CasMiss[]): ResolveError {
  if (misses.length === 1) {
    const [{ cause, actual }] = misses;
    if (actual !== undefined) {
      return new ResolveError(
        `CAS content for ${hash} hashes to ${actual}; the resolver must not use it.`,
        MISSING_UPDATE_DATA, { hash, actual }
      );
    }
    const text = failureText(cause);
    return new ResolveError(
      `CAS content for ${hash} cannot be retrieved` + (text === undefined ? '.' : `: ${text}`),
      MISSING_UPDATE_DATA, { hash, cause }
    );
  }
  const results = misses.map((miss) => `${miss.gateway}: ${
    miss.actual !== undefined ? `the content hashes to ${miss.actual}`
      : 'cause' in miss ? failureText(miss.cause) ?? 'the read fails'
        : 'no content'
  }`);
  return new ResolveError(
    `CAS content for ${hash} cannot be retrieved from the gateways: ${results.join('; ')}.`,
    MISSING_UPDATE_DATA, { hash, gateways: misses }
  );
}
