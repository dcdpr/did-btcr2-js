/**
 * On-the-wire version of the HTTP transport envelope. Separate from
 * {@link AGGREGATION_WIRE_VERSION} (which versions the aggregation protocol
 * payloads) so transport-layer changes don't force a protocol bump.
 */
export const HTTP_ENVELOPE_VERSION = 1;

/**
 * HTTP routes served by {@link HttpServerTransport}. The `{did}` placeholder
 * in {@link HTTP_ROUTE.ACTOR_INBOX} is substituted with a URL-safe DID at
 * request time.
 */
export const HTTP_ROUTE = {
  ADVERTS     : '/v1/adverts',
  MESSAGES    : '/v1/messages',
  ACTOR_INBOX : '/v1/actors/{did}/inbox',
  WELL_KNOWN  : '/v1/.well-known/aggregation',
} as const;

/** Server-Sent Events event names used by the broadcast + inbox streams. */
export const SSE_EVENT = {
  ADVERT    : 'advert',
  MESSAGE   : 'message',
  HEARTBEAT : 'heartbeat',
} as const;

/** Default clock-skew tolerance for envelope timestamps (seconds). */
export const DEFAULT_CLOCK_SKEW_SEC = 60;

/** Default length of the per-envelope anti-replay nonce (bytes). */
export const DEFAULT_NONCE_LEN_BYTES = 16;

/**
 * Tamper-evident wrapper around an aggregation {@link BaseMessage}. Every
 * authenticated HTTP request and inbox SSE event carries one of these.
 *
 * The signature is BIP340 Schnorr over the SHA-256 of the JCS-canonicalized
 * envelope **excluding** the `sig` field. Receivers reconstruct the same
 * canonical form, verify the signature against the sender's registered
 * communication public key, and reject outside-skew timestamps.
 */
export interface SignedEnvelope {
  /** Envelope format version; must equal {@link HTTP_ENVELOPE_VERSION}. */
  v: number;
  /** Sender DID. */
  from: string;
  /** Recipient DID. Omitted for broadcasts (e.g. COHORT_ADVERT). */
  to?: string;
  /** Unix seconds at which the envelope was produced. */
  timestamp: number;
  /** Hex-encoded random nonce, {@link DEFAULT_NONCE_LEN_BYTES} bytes. */
  nonce: string;
  /** Aggregation message payload (plain-JSON form, `toJSON`-normalized). */
  message: Record<string, unknown>;
  /** Hex-encoded 64-byte BIP340 Schnorr signature. */
  sig: string;
}
