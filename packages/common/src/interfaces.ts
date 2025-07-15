export type JsonPatch = Array<PatchOperation>;
export type PatchOpCode = 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test' | string;
/**
 * A JSON Patch operation, as defined in {@link https://datatracker.ietf.org/doc/html/rfc6902 | RFC 6902}.
 */
export interface PatchOperation {
  op: PatchOpCode;
  path: string;
  value?: any; // Required for add, replace, test
  from?: string; // Required for move, copy
}

/**
 * The unsigned payload object containing instructions for how to update a
 * did:btcr2 DID Document. Once signed, it becomes a
 * {@link DidUpdateInvocation | DID Update Invocation}
 *
 * DID BTCR2
 * {@link https://dcdpr.github.io/did-btcr2/#construct-did-update-payload | 4.3.1 Construct DID Update Payload}.
 *
 * Found in DID BTCR2 Specification {@link https://dcdpr.github.io/did-btcr2/#dereference-root-capability-identifier | Section 9.4.2}
 * @example
 * ```
 * {
 *  "@context": [
 *    "https://w3id.org/zcap/v1",
 *    "https://w3id.org/security/data-integrity/v2",
 *    "https://w3id.org/json-ld-patch/v1"
 *  ],
 *  "patch": [
 *    {
 *      "op": "add",
 *      "path": "/service/4",
 *      "value": {
 *        "id": "#linked-domain",
 *        "type": "LinkedDomains",
 *        "serviceEndpoint": "https://contact-me.com"
 *      }
 *    }
 *   ],
 *   "proof":{
 *   "type": "DataIntegrityProof,
 *   "cryptosuite": "schnorr-secp256k1-jcs-2025,
 *   "verificationMethod": "did:btcr2:k1qqpuwwde82nennsavvf0lqfnlvx7frrgzs57lchr02q8mz49qzaaxmqphnvcx#initialKey,
 *   "invocationTarget": "did:btcr2:k1qqpuwwde82nennsavvf0lqfnlvx7frrgzs57lchr02q8mz49qzaaxmqphnvcx,
 *   "capability": "urn:zcap:root:did%3Abtcr2%3Ak1qqpuwwde82nennsavvf0lqfnlvx7frrgzs57lchr02q8mz49qzaaxmqphnvcx,
 *   "capabilityAction": "Write,
 *   "proofPurpose": "assertionMethod,
 *   "proofValue": "z381yXYmxU8NudZ4HXY56DfMN6zfD8syvWcRXzT9xD9uYoQToo8QsXD7ahM3gXTzuay5WJbqTswt2BKaGWYn2hHhVFKJLXaD
 *  }
 * }
 * ```
 */
export interface DidUpdatePayload {
    /**
     * JSON-LD context URIs for interpreting this payload, including contexts
     * for ZCAP (capabilities), Data Integrity proofs, and JSON-LD patch ops.
     */
    '@context': string[];

    /**
     * A JSON Patch (or JSON-LD Patch) object defining the mutations to apply to
     * the DID Document. Applying this patch to the current DID Document yields
     * the new DID Document (which must remain valid per DID Core spec).
     */
    patch: JsonPatch;

    /**
     * The multihash of the current (source) DID Document, encoded as a multibase
     * base58-btc string. This is a SHA-256 hash of the canonicalized source DID
     * Document, used to ensure the patch is applied to the correct document state.
     */
    sourceHash: string;

    /**
     * The multihash of the updated (target) DID Document, encoded as multibase
     * base58-btc. This is the SHA-256 hash of the canonicalized
     * DID Document after applying the patch, used to verify the update result.
     */
    targetHash: string;

    /**
     * The version number of the DID Document after this update.
     * It is equal to the previous document version + 1.
     */
    targetVersionId: number;

    /**
     * A proof object (Data Integrity proof) that authorizes this update.
     * It is a JSON-LD proof indicating a capability invocation on the DID's
     * root capability, typically signed with the DID's verification key (using
     * Schnorr secp256k1 in did:btcr2).
     */
    proof?: Proof;
}

/**
 * An extension of {@link DidUpdatePayload | DID Update Payload} containing a
 * Data Integrity proof that authorizes the update. Once signed, the spec calls
 * this an 'invoked DID Update Payload' or 'didUpdateInvocation'.
 *
 * DID BTCR2
 * {@link https://dcdpr.github.io/did-btcr2/#invoke-did-update-payload | 4.3.2 Invoke DID Update Payload}
 * and
 * {@link https://dcdpr.github.io/did-btcr2/#root-didbtcr2-update-capabilities | 9.4 Root did:btcr2 Update Capabilities}.
 */
export interface DidUpdateInvocation extends DidUpdatePayload {
  proof: Proof;
}

/**
 * Proof is the Data Integrity proof (ZCAP-LD style) added to a did:btcr2 DID
 * Update Payload.
 *
 * Verifiable Credential Data Integrity
 * {@link https://w3c.github.io/vc-data-integrity/#proofs | 2.1 Proofs}.
 *
 * DID BTCR2
 * {@link https://dcdpr.github.io/did-btcr2/#invoke-did-update-payload | 4.3.2 Invoke DID Update Payload}.
 */
export interface Proof extends ProofOptions {
  /**
   * The cryptographic signature value. The exact property name may be defined
   * by the cryptosuite (for instance, `proofValue` for a raw signature) and
   * contains the actual signature bytes in an encoded form.
   */
  proofValue: string;
}

/**
 * Proof Options used when adding a Data Integrity proof (ZCAP-LD style)
 * to a did:btcr2 DID Update Payload.
 *
 * Verifiable Credential Data Integrity
 * {@link https://w3c.github.io/vc-data-integrity/#proofs | 2.1 Proofs}.
 *
 * DID BTCR2
 * {@link https://dcdpr.github.io/did-btcr2/#invoke-did-update-payload | 4.3.2 Invoke DID Update Payload}.
 */
export interface ProofOptions {
  /**
   * The proof type—per the spec’s example, "DataIntegrityProof".
   */
  type: string;

  /**
   * The cryptographic suite used, e.g. "schnorr-secp256k1-jcs-2025".
   */
  cryptosuite: string;

  /**
   * DID URL of the key invoking the capability, i.e. the DID
   * Document's verificationMethod.id used to sign this update.
   */
  verificationMethod: string;

  /**
   * The purpose of the proof, which the spec sets to "capabilityInvocation".
   */
  proofPurpose: string;

  /**
   * The root capability being invoked. In did:btcr2, this is typically
   * `urn:zcap:root:<urlencoded-did>` (see Section 9.4.1).
   */
  capability?: string;

  /**
   * The action performed under the capability—set to "Write" in the spec
   * for DID document updates.
   */
  capabilityAction?: string;

  /**
   * (Optional) Some cryptosuites or proofs may include a timestamp, domain,
   * or challenge. Although not explicitly required in the doc's steps, they
   * often appear in Data Integrity proofs and may be included as needed.
   */
  created?: string;
  domain?: string;
  challenge?: string;
}

/**
 * A JSON object that maps did:btcr2 identifiers to the CID of the corresponding
 * DID Update Payload.
 *
 * DID BTCR2
 * {@link https://dcdpr.github.io/did-btcr2/#cidaggregate-beacon | 5.2 CIDAggregate Beacons}.
 */
export interface DidUpdateBundle {
  /**
   * The keys are did:btcr2 identifiers as strings. The values are
   * IPFS CIDs (or other CAS IDs) referencing the actual DID Update Payload.
   */
  [didbtcr2Identifier: string]: string;
}

/**
 * Sidecar data for a specific Beacon Signal. Different Beacon types store different fields.
 * - SingletonBeacon might just store one `updatePayload`.
 * - CIDAggregateBeacon might store `updateBundle` + an `updatePayload`.
 * - SMTAggregateBeacon might store `updatePayload` + a `smtProof`.
 */
export interface SignalSidecarData {
  updatePayload?: DidUpdateInvocation;   // or DidUpdatePayload if not yet invoked
  updateBundle?: DidUpdateBundle;        // for CIDAggregateBeacon
  /**
   * For SMTAggregateBeacon, a Merkle proof that the `updatePayload`
   * is included (or not included) in the aggregator's Sparse Merkle Tree.
   */
  smtProof?: SmtProof;
}

/**
 * A placeholder for the actual Sparse Merkle Tree inclusion/non-inclusion proof.
 *
 * DID BTCR2
 * {@link https://dcdpr.github.io/did-btcr2/#smtaggregate-beacon | 5.3 SMTAggregate Beacon}.
 */
export interface SmtProof {
  // Implementation-specific structure for SMT proofs, e.g.:
  siblingHashes: string[];
  leafIndex?: string;
}

/**
 * The known Beacon types from the spec.
 */
export type BeaconType =
  | 'SingletonBeacon'
  | 'CIDAggregateBeacon'
  | 'SMTAggregateBeacon';

/**
 * A ZCAP-LD root capability object that authorizes updates for a particular did:btc1.
 *
 * DID BTCR2
 * {@link https://dcdpr.github.io/did-btcr2/#derive-root-capability-from-didbtcr2-identifier | 9.4.1 Derive Root Capability from did:btcr2 Identifier}.
 *
 * @example Found in DID BTCR2 Specification Section 9.4.1
 * ```
 * {
 *   "@context": "https://w3id.org/zcap/v1",
 *   "id": "urn:zcap:root:did%3Abtcr2%3Ak1qq...",
 *   "controller": "did:btcr2:k1qq...",
 *   "invocationTarget": "did:btcr2:k1qq..."
 * }
 * ```
 */
export interface DidBtcr2RootCapability {
  '@context': string | string[]; // e.g. "https://w3id.org/zcap/v1"
  id: string;                    // e.g. "urn:zcap:root:<urlencoded-did>"
  controller: string;           // the DID
  invocationTarget: string;     // same as DID
}
