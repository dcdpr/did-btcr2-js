import { DidDocumentError, INVALID_DID_DOCUMENT } from '@did-btcr2/common';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import type { DidDocument, DidVerificationMethod } from '../utils/did-document.js';
import { Identifier } from './identifier.js';
import { Resolver } from './resolver.js';

/**
 * Derive the aggregation communication public key from a resolved did:btcr2 DID Document.
 *
 * The communication key is the verification method referenced by
 * `capabilityInvocation[0]`, resolved to its public key. This is the exact relationship
 * the method already enforces for DID updates (construct and sign require the signing
 * method to be in `capabilityInvocation`, the update proof is built and verified with
 * `proofPurpose: 'capabilityInvocation'`), so binding the transport communication key to
 * it yields the invariant "transport-authenticated as D implies authorized to update D."
 * For a KEY (`k1`) document the single deterministic key is already the sole
 * `capabilityInvocation` entry, so this is a no-op for KEY DIDs.
 *
 * There is deliberately no `verificationMethod[0]` fallback: a document without
 * `capabilityInvocation` cannot be updated at all, so it is useless for aggregation and is
 * rejected here rather than bound to an unrelated key.
 *
 * @param {DidDocument} document The resolved DID Document (placeholder id already replaced).
 * @returns {CompressedSecp256k1PublicKey} The compressed public key of the communication method.
 * @throws {DidDocumentError} If `capabilityInvocation` is absent or its first entry does not
 *   resolve to a verification method in the document.
 */
export function getAggregationCommunicationKey(
  document: DidDocument,
): CompressedSecp256k1PublicKey {
  const invocation = document.capabilityInvocation?.[0];
  if(invocation === undefined) {
    throw new DidDocumentError(
      'Cannot derive aggregation communication key: capabilityInvocation is absent',
      INVALID_DID_DOCUMENT, { id: document.id }
    );
  }

  // Resolve capabilityInvocation[0] to a verification method: a string reference is
  // dereferenced by id against verificationMethod; an embedded method is used directly.
  // A local id lookup is used rather than getSigningMethod, which defaults to #initialKey
  // and does not resolve embedded methods.
  const vm: DidVerificationMethod | undefined = typeof invocation === 'string'
    ? document.verificationMethod?.find(method => method.id === invocation)
    : invocation;

  if(!vm) {
    throw new DidDocumentError(
      `Cannot derive aggregation communication key: capabilityInvocation[0] "${invocation}" `
        + 'does not resolve to a verification method',
      INVALID_DID_DOCUMENT, { id: document.id, invocation }
    );
  }

  return SchnorrMultikey.fromVerificationMethod(vm).publicKey;
}

/**
 * Resolve a did:btcr2 sender's communication public key from its DID, for the
 * aggregation HTTP transport's `resolveSenderPk` option.
 *
 * A KEY (`k1`) identifier decodes directly to its genesis public key: the DID string is
 * the key. An EXTERNAL (`x1`) identifier is a commitment to the hash of a genesis
 * document, so there is no key in the DID string. When the genesis document is supplied
 * in-band (via `opts.genesisDocument`), it is self-verifying against the DID: `Resolver`'s
 * external path recomputes its canonical hash, compares it to the identifier's genesis
 * bytes (throwing on mismatch), and resolves it, after which the communication key is
 * derived from `capabilityInvocation[0]` ({@link getAggregationCommunicationKey}). Without
 * a genesis document, an `x1` DID still resolves to `undefined`, so callers that pass no
 * second argument behave exactly as before.
 *
 * The aggregation transport is DID-method-agnostic and does not name `Identifier`; method
 * supplies this resolver when it wires the transport so a sender that is not a
 * pre-registered peer can still be authenticated from its DID.
 *
 * @param {string} did The sender's DID.
 * @param {object} [opts] Optional resolution inputs.
 * @param {object} [opts.genesisDocument] The `x1` sender's genesis document, carried in-band
 *   on the bootstrap opt-in. Ignored for KEY identifiers.
 * @returns {CompressedSecp256k1PublicKey | undefined} The sender's compressed public key, or
 *   `undefined` when the DID is not a decodable did:btcr2 identifier, is an `x1` identifier
 *   with no (or a non-matching) genesis document, or has no usable communication key.
 */
export function resolveBtcr2SenderPk(
  did: string,
  opts?: { genesisDocument?: object },
): CompressedSecp256k1PublicKey | undefined {
  try {
    const components = Identifier.decode(did);
    if(components.idType === 'KEY') {
      return new CompressedSecp256k1PublicKey(components.genesisBytes);
    }
    // EXTERNAL (x1): the DID commits to the hash of a genesis document. With the genesis
    // supplied in-band, verify it hashes to the DID and derive the communication key from
    // it; without it, there is no key to return.
    if(opts?.genesisDocument) {
      const document = Resolver.external(components, opts.genesisDocument);
      return getAggregationCommunicationKey(document);
    }
  } catch {
    // Not a decodable did:btcr2 identifier, the genesis does not hash to the DID, or the
    // document has no usable capabilityInvocation communication key.
  }
  return undefined;
}
