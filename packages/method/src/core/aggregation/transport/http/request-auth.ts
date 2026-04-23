import { canonicalHashBytes } from '@did-btcr2/common';
import type { CompressedSecp256k1PublicKey, SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';

import { HttpTransportError } from './errors.js';
import { DEFAULT_CLOCK_SKEW_SEC, DEFAULT_NONCE_LEN_BYTES, HTTP_ENVELOPE_VERSION } from './protocol.js';

/**
 * `Authorization`-header scheme used to authenticate SSE subscription
 * requests. The header value takes the form
 * `BTCR2-Sig v=<n>,did=<did>,ts=<unix>,nonce=<hex>,sig=<hex>`.
 *
 * Used only for GET endpoints (SSE inbox subscribe). POST endpoints carry a
 * full {@link SignedEnvelope} in the request body instead.
 */
export const REQUEST_AUTH_SCHEME = 'BTCR2-Sig';

export interface ParsedRequestAuth {
  /** Transport envelope format version. */
  v: number;
  /** Subscriber DID. */
  did: string;
  /** Unix-seconds timestamp. */
  ts: number;
  /** Hex-encoded anti-replay nonce. */
  nonce: string;
  /** Hex-encoded 64-byte BIP340 signature. */
  sig: string;
}

export interface BuildRequestAuthOptions {
  nonce?: string;
  timestamp?: number;
}

/**
 * Build an `Authorization` header value proving the caller controls the
 * private key for `did`. Covers a specific request path so the signature
 * can't be replayed against a different endpoint.
 */
export function buildRequestAuth(
  did:  string,
  keys: SchnorrKeyPair,
  path: string,
  opts: BuildRequestAuthOptions = {},
): string {
  const ts    = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = opts.nonce ?? bytesToHex(randomBytes(DEFAULT_NONCE_LEN_BYTES));

  const digest = canonicalHashBytes({
    v : HTTP_ENVELOPE_VERSION,
    did,
    ts,
    nonce,
    path,
  });
  const sig = keys.secretKey.sign(digest, { scheme: 'schnorr' });

  return `${REQUEST_AUTH_SCHEME} v=${HTTP_ENVELOPE_VERSION},did=${did},ts=${ts},nonce=${nonce},sig=${bytesToHex(sig)}`;
}

/**
 * Parse a `BTCR2-Sig` auth header value into its structured fields. Does NOT
 * verify the signature — call {@link verifyRequestAuth} for that.
 */
export function parseRequestAuth(headerValue: string): ParsedRequestAuth {
  const prefix = `${REQUEST_AUTH_SCHEME} `;
  if(!headerValue.startsWith(prefix)) {
    throw new HttpTransportError(
      `Unexpected auth scheme (want ${REQUEST_AUTH_SCHEME})`,
      'REQUEST_AUTH_SCHEME',
    );
  }

  const params: Record<string, string> = {};
  for(const piece of headerValue.slice(prefix.length).split(',')) {
    const eq = piece.indexOf('=');
    if(eq === -1) continue;
    const key = piece.slice(0, eq).trim();
    const val = piece.slice(eq + 1).trim();
    if(key.length > 0) params[key] = val;
  }

  const v  = Number(params.v);
  const ts = Number(params.ts);
  if(!Number.isInteger(v) || !Number.isInteger(ts) || !params.did || !params.nonce || !params.sig) {
    throw new HttpTransportError(
      'Malformed auth header (missing or invalid field)',
      'REQUEST_AUTH_MALFORMED',
      { received: Object.keys(params) },
    );
  }
  return { v, did: params.did, ts, nonce: params.nonce, sig: params.sig };
}

export interface VerifyRequestAuthOptions {
  clockSkewSec?: number;
  now?: () => number;
}

/**
 * Parse + verify an auth header. Throws {@link HttpTransportError} on any
 * failure; returns the parsed fields on success.
 *
 * `expectedPath` must match the path the signature commits to. `senderPk`
 * must correspond to the DID the signer claims.
 */
export function verifyRequestAuth(
  headerValue:  string,
  expectedPath: string,
  senderPk:     CompressedSecp256k1PublicKey,
  opts:         VerifyRequestAuthOptions = {},
): ParsedRequestAuth {
  const parsed = parseRequestAuth(headerValue);

  if(parsed.v !== HTTP_ENVELOPE_VERSION) {
    throw new HttpTransportError(
      `Unsupported auth version: ${parsed.v}`,
      'REQUEST_AUTH_VERSION_MISMATCH',
      { version: parsed.v, expected: HTTP_ENVELOPE_VERSION },
    );
  }

  const skewSec = opts.clockSkewSec ?? DEFAULT_CLOCK_SKEW_SEC;
  const nowMs   = opts.now ? opts.now() : Date.now();
  const nowSec  = Math.floor(nowMs / 1000);
  const diff    = Math.abs(nowSec - parsed.ts);
  if(diff > skewSec) {
    throw new HttpTransportError(
      `Auth timestamp out of skew: ${diff}s > ${skewSec}s`,
      'REQUEST_AUTH_TIMESTAMP_SKEW',
      { diff, skewSec },
    );
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = hexToBytes(parsed.sig);
  } catch {
    throw new HttpTransportError('Auth signature is not valid hex', 'REQUEST_AUTH_SIG_HEX');
  }
  if(sigBytes.length !== 64) {
    throw new HttpTransportError(
      `Invalid auth signature length: ${sigBytes.length}`,
      'REQUEST_AUTH_SIG_LENGTH',
      { length: sigBytes.length },
    );
  }

  const digest = canonicalHashBytes({
    v     : parsed.v,
    did   : parsed.did,
    ts    : parsed.ts,
    nonce : parsed.nonce,
    path  : expectedPath,
  });

  const ok = senderPk.verify(sigBytes, digest, { scheme: 'schnorr' });
  if(!ok) {
    throw new HttpTransportError('Auth signature verification failed', 'REQUEST_AUTH_SIG_INVALID');
  }

  return parsed;
}
