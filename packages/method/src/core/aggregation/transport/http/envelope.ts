import { canonicalHashBytes } from '@did-btcr2/common';
import type { CompressedSecp256k1PublicKey, SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';

import type { BaseMessage } from '../../messages/base.js';
import { HttpTransportError } from './errors.js';
import {
  DEFAULT_CLOCK_SKEW_SEC,
  DEFAULT_NONCE_LEN_BYTES,
  HTTP_ENVELOPE_VERSION,
  type SignedEnvelope,
} from './protocol.js';

/** Any shape acceptable as an envelope payload. `BaseMessage` instances are
 *  `toJSON`-normalized before signing so class vs. POJO callers produce the
 *  same canonical form. */
export type EnvelopeMessage = BaseMessage | Record<string, unknown>;

export interface SignEnvelopeOptions {
  /** Recipient DID. Omit for broadcasts. */
  to?: string;
  /** Override the random nonce (tests). */
  nonce?: string;
  /** Override the unix-seconds timestamp (tests). */
  timestamp?: number;
}

export interface VerifyEnvelopeOptions {
  /** Reject if `envelope.from` doesn't match. */
  expectedFrom?: string;
  /** Reject if `envelope.to` doesn't match. Pass `undefined` to require a broadcast. */
  expectedTo?: string;
  /** Clock-skew tolerance (seconds). Defaults to {@link DEFAULT_CLOCK_SKEW_SEC}. */
  clockSkewSec?: number;
  /** Clock override (tests). Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Build a {@link SignedEnvelope} around `message`.
 *
 * Pure function — no I/O beyond `randomBytes` for nonce generation (which
 * uses the platform's cryptographic RNG: `crypto.getRandomValues` in browsers,
 * `node:crypto` in Node). Deterministic when both `nonce` and `timestamp` are
 * supplied via {@link SignEnvelopeOptions}.
 */
export function signEnvelope(
  message: EnvelopeMessage,
  sender:  { did: string; keys: SchnorrKeyPair },
  opts:    SignEnvelopeOptions = {},
): SignedEnvelope {
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce     = opts.nonce ?? bytesToHex(randomBytes(DEFAULT_NONCE_LEN_BYTES));
  const messageJson = normalizeForWire(normalizeMessage(message)) as Record<string, unknown>;

  const unsigned: Omit<SignedEnvelope, 'sig'> = {
    v         : HTTP_ENVELOPE_VERSION,
    from      : sender.did,
    ...(opts.to !== undefined ? { to: opts.to } : {}),
    timestamp,
    nonce,
    message   : messageJson,
  };

  const digest = canonicalHashBytes(unsigned);
  const sig    = sender.keys.secretKey.sign(digest, { scheme: 'schnorr' });

  return { ...unsigned, sig: bytesToHex(sig) };
}

/**
 * Verify a {@link SignedEnvelope} against the sender's compressed secp256k1
 * communication public key. Throws {@link HttpTransportError} on any failure;
 * returns normally on success.
 *
 * Does NOT check nonce uniqueness — replay protection is the caller's
 * responsibility (the server-side transport maintains an LRU cache).
 */
export function verifyEnvelope(
  envelope: SignedEnvelope,
  senderPk: CompressedSecp256k1PublicKey,
  opts:     VerifyEnvelopeOptions = {},
): void {
  if(envelope.v !== HTTP_ENVELOPE_VERSION) {
    throw new HttpTransportError(
      `Unsupported envelope version: ${envelope.v}`,
      'ENVELOPE_VERSION_MISMATCH',
      { version: envelope.v, expected: HTTP_ENVELOPE_VERSION },
    );
  }

  if(opts.expectedFrom !== undefined && envelope.from !== opts.expectedFrom) {
    throw new HttpTransportError(
      `Envelope from mismatch: expected ${opts.expectedFrom}, got ${envelope.from}`,
      'ENVELOPE_FROM_MISMATCH',
      { expected: opts.expectedFrom, got: envelope.from },
    );
  }

  if('expectedTo' in opts && envelope.to !== opts.expectedTo) {
    throw new HttpTransportError(
      `Envelope to mismatch: expected ${opts.expectedTo ?? '<broadcast>'}, got ${envelope.to ?? '<broadcast>'}`,
      'ENVELOPE_TO_MISMATCH',
      { expected: opts.expectedTo, got: envelope.to },
    );
  }

  const skewSec = opts.clockSkewSec ?? DEFAULT_CLOCK_SKEW_SEC;
  const nowMs   = opts.now ? opts.now() : Date.now();
  const nowSec  = Math.floor(nowMs / 1000);
  const diff    = Math.abs(nowSec - envelope.timestamp);
  if(diff > skewSec) {
    throw new HttpTransportError(
      `Envelope timestamp out of skew: ${diff}s > ${skewSec}s`,
      'ENVELOPE_TIMESTAMP_SKEW',
      { diff, skewSec, timestamp: envelope.timestamp, now: nowSec },
    );
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = hexToBytes(envelope.sig);
  } catch {
    throw new HttpTransportError(
      'Envelope signature is not valid hex',
      'ENVELOPE_SIG_HEX',
    );
  }
  if(sigBytes.length !== 64) {
    throw new HttpTransportError(
      `Invalid signature length: ${sigBytes.length} (expected 64)`,
      'ENVELOPE_SIG_LENGTH',
      { length: sigBytes.length },
    );
  }

  const { sig: _sig, ...unsigned } = envelope;
  const digest = canonicalHashBytes(unsigned);

  const ok = senderPk.verify(sigBytes, digest, { scheme: 'schnorr' });
  if(!ok) {
    throw new HttpTransportError(
      'Envelope signature verification failed',
      'ENVELOPE_SIG_INVALID',
    );
  }
}

function normalizeMessage(message: EnvelopeMessage): Record<string, unknown> {
  const maybeToJSON = (message as { toJSON?: () => unknown }).toJSON;
  if(typeof maybeToJSON === 'function') {
    return maybeToJSON.call(message) as Record<string, unknown>;
  }
  return message as Record<string, unknown>;
}

/**
 * Recursively replace `Uint8Array` values with `{ __bytes: hex }` sentinel
 * objects so they survive JSON canonicalization / HTTP body serialization.
 * Pairs with {@link reviveFromWire}.
 *
 * Without this, `JSON.stringify` serializes a `Uint8Array` as an index-keyed
 * object (`{"0":1,"1":2,...}`), which `canonicalize` then re-parses into a
 * plain object — the receiver cannot reconstruct the original bytes even
 * though the signature still verifies.
 */
export function normalizeForWire(value: unknown): unknown {
  if(value instanceof Uint8Array) {
    return { __bytes: bytesToHex(value) };
  }
  if(Array.isArray(value)) {
    return value.map((v) => normalizeForWire(v));
  }
  if(value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for(const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeForWire(v);
    }
    return out;
  }
  return value;
}

/**
 * Recursively convert `{ __bytes: hex }` sentinels back into `Uint8Array`
 * values. Call on `envelope.message` *after* successful verification and
 * before handing the payload to a runner's handler.
 */
export function reviveFromWire(value: unknown): unknown {
  if(value && typeof value === 'object' && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec);
    if(keys.length === 1 && keys[0] === '__bytes' && typeof rec.__bytes === 'string') {
      return hexToBytes(rec.__bytes);
    }
    const out: Record<string, unknown> = {};
    for(const [k, v] of Object.entries(rec)) out[k] = reviveFromWire(v);
    return out;
  }
  if(Array.isArray(value)) {
    return value.map((v) => reviveFromWire(v));
  }
  return value;
}
