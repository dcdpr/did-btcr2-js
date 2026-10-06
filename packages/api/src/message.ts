import { MethodError, PROOF_GENERATION_ERROR, VERIFICATION_METHOD_ERROR } from '@did-btcr2/common';
import type { DataIntegrityProofObject, DataIntegrityProofOptions } from '@did-btcr2/cryptosuite';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import type { Signer } from '@did-btcr2/keypair';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import type { Btcr2DidDocument } from '@did-btcr2/method';
import { Appendix } from '@did-btcr2/method';
import type { DidVerificationMethod } from '@web5/dids';

/**
 * A text message and its `bip340-jcs-2025` assertion proof (ADR 137).
 * @public
 */
export interface SignedMessage {
  /** Always `BTCR2Message`. It separates a message from other signed documents. */
  type    : 'BTCR2Message';
  /** The text that the DID asserts, exactly as signed. */
  message : string;
  /**
   * Exactly five members: `type`, `cryptosuite`, `verificationMethod` (an
   * absolute DID URL), `proofPurpose` (`assertionMethod`), and `proofValue`.
   */
  proof   : DataIntegrityProofObject;
}

/**
 * Options of {@link DidMethodApi.signMessage}.
 * @public
 */
export interface SignMessageOptions {
  /**
   * The verification method that signs. Default: the one `assertionMethod`
   * method of the document that publishes the key of the signer.
   */
  verificationMethodId? : string;
}

/**
 * The name of a check of {@link DidMethodApi.verifyMessage}. The names are in run order.
 * @public
 */
export type MessageCheckName = 'structure' | 'signer' | 'active' | 'assertionMethod' | 'signature';

/**
 * The result of one check of {@link DidMethodApi.verifyMessage}.
 * @public
 */
export interface MessageCheck {
  /** The name of the check. */
  name    : MessageCheckName;
  /** True if the check passed. */
  ok      : boolean;
  /** What the check found. */
  detail? : string;
}

/**
 * The report of {@link DidMethodApi.verifyMessage}.
 * @public
 */
export interface MessageReport {
  /** The id of the DID document: the DID that must have signed. */
  did                 : string;
  /** True if every check passed. */
  verified            : boolean;
  /** The verification method that the proof names. Known after the `structure` check. */
  verificationMethod? : string;
  /** The message. Present only if `verified` is true. */
  message?            : string;
  /** The checks that ran, in run order. The run stops at the first failed check. */
  checks              : MessageCheck[];
}

/** The `type` of a signed message. */
const MESSAGE_TYPE = 'BTCR2Message';

/** The proof type, the cryptosuite, and the proof purpose of a signed message. */
const PROOF_TYPE = 'DataIntegrityProof';
const CRYPTOSUITE = 'bip340-jcs-2025';
const PROOF_PURPOSE = 'assertionMethod';

/** The members of a signed message and of its proof, sorted. */
const MESSAGE_MEMBERS = [ 'message', 'proof', 'type' ];
const PROOF_MEMBERS = [ 'cryptosuite', 'proofPurpose', 'proofValue', 'type', 'verificationMethod' ];

/** A lone surrogate. JCS (RFC 8785) cannot encode it. A surrogate pair is one code point and does not match. */
const LONE_SURROGATE = /\p{Cs}/u;

/**
 * A `proofValue`: `z` (base58btc) and 64 to 88 base58btc characters. Each
 * 64-byte signature encodes to 64 to 88 characters: 64 zero bytes give 64
 * characters "1". The check runs before the decode, because the time of the
 * base58 decode grows with the square of the length.
 */
const PROOF_VALUE = /^z[1-9A-HJ-NP-Za-km-z]{64,88}$/;

/**
 * Signs a text message as an assertion of the DID of `document` (ADR 137).
 *
 * The signer gets only the hash of the closed format: the proof purpose is
 * always `assertionMethod`, and the scheme is always `bip340`. No caller bytes
 * reach the signer, so a message signature is never valid as an update proof
 * or as a transaction signature.
 * @param document The current DID document of the DID that signs.
 * @param message The text to sign.
 * @param signer The signer with the key of an `assertionMethod` method.
 * @param options The options. See {@link SignMessageOptions}.
 * @returns The signed message.
 * @throws {MethodError} `VERIFICATION_METHOD_ERROR` if zero or several methods match.
 * @throws {MethodError} `PROOF_GENERATION_ERROR` if the message is not well-formed
 *   text, the document is deactivated, or the result fails its own verification.
 */
export function signMessage(
  document : Btcr2DidDocument,
  message  : string,
  signer   : Signer,
  options  : SignMessageOptions = {},
): SignedMessage {
  if (typeof message !== 'string' || LONE_SURROGATE.test(message)) {
    throw new MethodError(
      'The message must be a string of well-formed Unicode text (no lone surrogate).',
      PROOF_GENERATION_ERROR,
    );
  }
  if (document.deactivated === true) {
    throw new MethodError(
      `The DID document of ${document.id} is deactivated. A deactivated DID signs no message.`,
      PROOF_GENERATION_ERROR,
      { did: document.id },
    );
  }
  const verificationMethod = signingMethodId(document, signer, options.verificationMethodId);
  // New objects: addProof writes the proof into both of its arguments.
  const unsigned = { type: MESSAGE_TYPE, message };
  const config: DataIntegrityProofOptions = {
    type         : PROOF_TYPE,
    cryptosuite  : CRYPTOSUITE,
    verificationMethod,
    proofPurpose : PROOF_PURPOSE,
  };
  const secured = SchnorrMultikey.fromSigner(verificationMethod, document.id, signer)
    .toCryptosuite()
    .toDataIntegrityProof()
    .addProof(unsigned, config);
  // The JSON round trip drops the `@context: undefined` member that createProof adds.
  const signed = JSON.parse(JSON.stringify(secured)) as SignedMessage;
  const report = verifyMessage(document, signed);
  if (!report.verified) {
    const failed = report.checks[report.checks.length - 1];
    throw new MethodError(
      `The signed message fails its own verification (${failed.name} check): ${failed.detail ?? 'failed'}`,
      PROOF_GENERATION_ERROR,
      { did: document.id, check: failed.name },
    );
  }
  return signed;
}

/**
 * Verifies a signed message against a DID document (ADR 137). The checks run
 * in order, and the run stops at the first failed check. The function never
 * throws for a bad signed message. The caller resolves the document: an old
 * document gives a check against that old document.
 * @param document The DID document of the DID that must have signed.
 * @param signedMessage The signed message, as parsed from JSON.
 * @returns The report.
 */
export function verifyMessage(document: Btcr2DidDocument, signedMessage: unknown): MessageReport {
  const checks: MessageCheck[] = [];
  let verificationMethod: string | undefined;
  const fail = (name: MessageCheckName, detail: string): MessageReport => {
    checks.push({ name, ok: false, detail });
    return { did: document.id, verified: false, ...(verificationMethod !== undefined && { verificationMethod }), checks };
  };
  const pass = (name: MessageCheckName): void => {
    checks.push({ name, ok: true });
  };

  const problem = structureProblem(signedMessage);
  if (problem) return fail('structure', problem);
  const signed = signedMessage as SignedMessage;
  verificationMethod = signed.proof.verificationMethod;
  pass('structure');

  const prefix = `${document.id}#`;
  if (!verificationMethod.startsWith(prefix) || verificationMethod.length === prefix.length) {
    return fail('signer', `The proof names the method ${verificationMethod}, which is not a method of ${document.id}.`);
  }
  pass('signer');

  if (document.deactivated === true) {
    return fail('active', `The DID document of ${document.id} is deactivated.`);
  }
  pass('active');

  const entry = document.assertionMethod?.find(
    candidate => Appendix.relationshipMethodId(candidate, document.id) === verificationMethod
  );
  if (entry === undefined) {
    return fail('assertionMethod', `${verificationMethod} is not in the assertionMethod of the DID document.`);
  }
  const method = Appendix.verificationMethodOfEntry(document, entry);
  if (method === undefined) {
    return fail('assertionMethod', `The DID document has no verification method ${verificationMethod}.`);
  }
  const methodProblem = assertionMethodProblem(document, method, verificationMethod);
  if (methodProblem) return fail('assertionMethod', methodProblem);
  let multikey: SchnorrMultikey;
  try {
    multikey = SchnorrMultikey.fromVerificationMethod({ ...method, id: verificationMethod });
  } catch (error) {
    return fail('assertionMethod', `The method ${verificationMethod} has no valid secp256k1 Multikey: ${(error as Error).message}`);
  }
  pass('assertionMethod');

  let verified: boolean;
  try {
    verified = multikey.toCryptosuite()
      .verifyProof({ type: signed.type, message: signed.message, proof: signed.proof })
      .verified;
  } catch (error) {
    return fail('signature', `The proof does not verify: ${(error as Error).message}`);
  }
  if (!verified) {
    return fail('signature', 'The signature does not match the message and the key of the method.');
  }
  pass('signature');

  return { did: document.id, verified: true, verificationMethod, message: signed.message, checks };
}

/**
 * The absolute id of the one `assertionMethod` method that publishes the key
 * of the signer, or the method that `requested` names.
 */
function signingMethodId(document: Btcr2DidDocument, signer: Signer, requested?: string): string {
  const signerKey = new CompressedSecp256k1PublicKey(signer.publicKey).multibase.encoded;
  const methods = (document.assertionMethod ?? [])
    .map(entry => Appendix.verificationMethodOfEntry(document, entry))
    .filter((method): method is DidVerificationMethod => method !== undefined)
    .map(method => ({ method, id: Appendix.absoluteDidUrl(method.id, document.id) }))
    .filter((candidate): candidate is { method: DidVerificationMethod; id: string } =>
      candidate.id !== undefined && !assertionMethodProblem(document, candidate.method, candidate.id));
  if (requested !== undefined) {
    const requestedId = Appendix.absoluteDidUrl(requested, document.id);
    const match = methods.find(candidate => candidate.id === requestedId);
    if (match === undefined) {
      throw new MethodError(
        `${requested} is not a usable assertionMethod method of ${document.id}.`,
        VERIFICATION_METHOD_ERROR,
        { did: document.id, verificationMethodId: requested },
      );
    }
    if (match.method.publicKeyMultibase !== signerKey) {
      throw new MethodError(
        `The verification method ${match.id} does not publish the key of the signer.`,
        VERIFICATION_METHOD_ERROR,
        { did: document.id, verificationMethodId: match.id, signerKey },
      );
    }
    return match.id;
  }
  const matches = methods.filter(candidate => candidate.method.publicKeyMultibase === signerKey);
  if (matches.length === 1) return matches[0].id;
  if (matches.length === 0) {
    throw new MethodError(
      `No assertionMethod method of ${document.id} publishes the key of the signer. `
      + 'Sign with a key that the document lists under assertionMethod.',
      VERIFICATION_METHOD_ERROR,
      { did: document.id, signerKey },
    );
  }
  const ids = matches.map(candidate => candidate.id);
  throw new MethodError(
    `${matches.length} assertionMethod methods of ${document.id} publish the key of the signer: `
    + `${ids.join(', ')}. Pass verificationMethodId to choose one.`,
    VERIFICATION_METHOD_ERROR,
    { did: document.id, signerKey, verificationMethodIds: ids },
  );
}

/**
 * The reason that a method of the document cannot sign a message, or
 * `undefined`. The id must name a fragment of the DID, the type must be
 * `Multikey`, and the controller must be the DID (Controlled Identifiers 1.0,
 * section 3.3).
 */
function assertionMethodProblem(
  document : Btcr2DidDocument,
  method   : DidVerificationMethod,
  id       : string,
): string | undefined {
  const prefix = `${document.id}#`;
  if (!id.startsWith(prefix) || id.length === prefix.length) {
    return `The method ${id} is not a fragment of ${document.id}.`;
  }
  if (method.type !== 'Multikey') {
    return `The method ${id} has the type ${String(method.type)}, not Multikey.`;
  }
  if (Appendix.absoluteDidUrl(method.controller, document.id) !== document.id) {
    return `The controller of the method ${id} is ${String(method.controller)}, not ${document.id}.`;
  }
  return undefined;
}

/** The reason that a value is not a signed message of the closed format, or `undefined`. */
function structureProblem(value: unknown): string | undefined {
  if (!isPlainObject(value)) {
    return 'The signed message must be a JSON object.';
  }
  if (!hasExactly(value, MESSAGE_MEMBERS)) {
    return 'The signed message must have exactly the members type, message, and proof.';
  }
  if (value.type !== MESSAGE_TYPE) {
    return `The type of the signed message must be ${MESSAGE_TYPE}.`;
  }
  if (typeof value.message !== 'string' || LONE_SURROGATE.test(value.message)) {
    return 'The message must be a string of well-formed Unicode text (no lone surrogate).';
  }
  const proof = value.proof;
  if (!isPlainObject(proof)) {
    return 'The proof must be a JSON object.';
  }
  if (!hasExactly(proof, PROOF_MEMBERS)) {
    return 'The proof must have exactly the members type, cryptosuite, verificationMethod, proofPurpose, and proofValue.';
  }
  const nonString = PROOF_MEMBERS.find(member => typeof proof[member] !== 'string');
  if (nonString) {
    return `The proof member ${nonString} must be a string.`;
  }
  if (proof.type !== PROOF_TYPE) {
    return `The proof type must be ${PROOF_TYPE}.`;
  }
  if (proof.cryptosuite !== CRYPTOSUITE) {
    return `The proof cryptosuite must be ${CRYPTOSUITE}.`;
  }
  if (proof.proofPurpose !== PROOF_PURPOSE) {
    return `The proof purpose must be ${PROOF_PURPOSE}.`;
  }
  if (!PROOF_VALUE.test(proof.proofValue as string)) {
    return 'The proofValue must be z and 64 to 88 base58btc characters.';
  }
  return undefined;
}

/** True if the value is a non-null object that is not an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True if the object has exactly the members of `sortedMembers`. */
function hasExactly(value: Record<string, unknown>, sortedMembers: string[]): boolean {
  const members = Object.keys(value).sort();
  return members.length === sortedMembers.length && members.every((member, index) => member === sortedMembers[index]);
}
