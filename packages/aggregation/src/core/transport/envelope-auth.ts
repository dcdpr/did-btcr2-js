import type { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { equalBytes } from '@noble/curves/utils.js';
import type { Logger } from '../logger.js';
import { CONSOLE_LOGGER } from '../logger.js';
import { reviveFromWire, verifyEnvelope } from './http/envelope.js';
import type { SignedEnvelope } from './http/protocol.js';
import { DEFAULT_CLOCK_SKEW_SEC } from './http/protocol.js';

/** Dependencies for {@link authenticateEnvelopeContent}. */
export interface EnvelopeAuthOptions {
  /**
   * Resolve a sender DID to its communication public key (registered peer key,
   * or a DID-aware resolver such as `resolveBtcr2SenderPk` from
   * `@did-btcr2/method`).
   */
  resolveSenderPk: (
    did: string,
    opts?: { genesisDocument?: object },
  ) => CompressedSecp256k1PublicKey | undefined;
  /** Require the envelope's `to` field to equal this DID (directed messages). */
  expectedTo?: string;
  /** Envelope timestamp tolerance in seconds. Defaults to {@link DEFAULT_CLOCK_SKEW_SEC}. */
  clockSkewSec?: number;
  /** Diagnostic logger. Defaults to {@link CONSOLE_LOGGER}. */
  logger?: Logger;
}

/** True if `value` is a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Merge a message's `body` fields into the top level for handler access. */
function flattenMessage(msg: Record<string, unknown>): Record<string, unknown> {
  if(msg.body && typeof msg.body === 'object') {
    return { ...msg, ...(msg.body as Record<string, unknown>) };
  }
  return msg;
}

/**
 * Parse, authenticate, and flatten a signed-envelope payload received on any
 * transport. Returns the flattened message with `from` bound to the verified
 * envelope sender, or `undefined` when the content must be dropped:
 * unparseable, unresolvable sender, self-advertised key contradicting the
 * authenticated key, failed signature verification, stale timestamp, or wrong
 * recipient.
 *
 * The inner message is inspected BEFORE verification only to derive a bootstrap
 * key candidate (an x1 sender's in-band genesis document); nothing from it is
 * trusted until the envelope verifies.
 */
export function authenticateEnvelopeContent(
  content: string,
  options: EnvelopeAuthOptions,
): Record<string, unknown> | undefined {
  const logger = options.logger ?? CONSOLE_LOGGER;

  let envelope: SignedEnvelope;
  try {
    envelope = JSON.parse(content) as SignedEnvelope;
  } catch {
    return undefined;
  }
  if(!envelope || typeof envelope !== 'object'
    || typeof envelope.from !== 'string'
    || !envelope.message || typeof envelope.message !== 'object') {
    return undefined;
  }

  const flat = flattenMessage(reviveFromWire(envelope.message) as Record<string, unknown>);
  const genesisDocument = isRecord(flat.genesisDocument) ? flat.genesisDocument : undefined;
  const senderPk = options.resolveSenderPk(envelope.from, genesisDocument ? { genesisDocument } : undefined);
  if(!senderPk) {
    logger.debug(`Message from unresolvable DID: ${envelope.from}`);
    return undefined;
  }

  // A self-advertised communication key must equal the authenticated key: a
  // sender may not authenticate as one key while advertising another.
  const advertised = flat.communicationPk;
  if(advertised !== undefined && (!(advertised instanceof Uint8Array) || !equalBytes(advertised, senderPk.compressed))) {
    return undefined;
  }

  try {
    verifyEnvelope(envelope, senderPk, {
      clockSkewSec : options.clockSkewSec ?? DEFAULT_CLOCK_SKEW_SEC,
      ...(options.expectedTo !== undefined ? { expectedTo: options.expectedTo } : {}),
    });
  } catch(err) {
    logger.debug('Envelope verification failed:', err);
    return undefined;
  }

  // The dispatched sender is the authenticated envelope sender, never the
  // (previously untrusted) inner claim.
  if(flat.from !== undefined && flat.from !== envelope.from) return undefined;
  return { ...flat, from: envelope.from };
}
