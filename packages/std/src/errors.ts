/**
 * An enumeration of possible DID error codes.
 */
export enum MethodErrorCode {
  /** The DID supplied does not conform to valid syntax. */
  INVALID_DID = 'INVALID_DID',

  /** The supplied method name is not supported by the DID method and/or DID resolver implementation. */
  METHOD_NOT_SUPPORTED = 'METHOD_NOT_SUPPORTED',

  /** An unexpected error occurred during the requested DID operation. */
  INTERNAL_ERROR = 'INTERNAL_ERROR',

  /** The DID document supplied does not conform to valid syntax. */
  INVALID_DID_DOCUMENT = 'INVALID_DID_DOCUMENT',

  /** The DID Update supplied does not conform to valid syntax. */
  INVALID_DID_UPDATE = 'INVALID_DID_UPDATE',

  /** The DID URL supplied to the dereferencing function does not conform to valid syntax. */
  INVALID_DID_URL = 'INVALID_DID_URL',

  /** General: The resource requested was not found. */
  /** DID Resolution: The DID resolver was unable to find the DID document resulting from the resolution request.  */
  NOT_FOUND = 'NOT_FOUND',

  /**
   * The representation requested via the `accept` input metadata property is not supported by the
   * DID method and/or DID resolver implementation.
   */
  REPRESENTATION_NOT_SUPPORTED = 'REPRESENTATION_NOT_SUPPORTED',

  /** The proof verification operation failed. */
  PROOF_VERIFICATION_ERROR = 'PROOF_VERIFICATION_ERROR',

  /** The proof generation operation failed. */
  PROOF_GENERATION_ERROR = 'PROOF_GENERATION_ERROR',

  /** The transformation of a document into the data to hash failed. */
  PROOF_TRANSFORMATION_ERROR = 'PROOF_TRANSFORMATION_ERROR',

  /** The proof serialization operation failed. */
  PROOF_SERIALIZATION_ERROR = 'PROOF_SERIALIZATION_ERROR',

  /**
   * A secured document or its proof is not a map. Defined by
   * {@link https://www.w3.org/TR/vc-data-integrity/#verify-proof | VC Data Integrity 1.0, Verify Proof}.
   */
  PARSING_ERROR = 'PARSING_ERROR',

  /**
   * The challenge of a proof does not match the expected challenge. Defined by
   * {@link https://www.w3.org/TR/vc-data-integrity/#processing-errors | VC Data Integrity 1.0, Processing Errors}.
   */
  INVALID_CHALLENGE_ERROR = 'INVALID_CHALLENGE_ERROR',

  /** The verification method was formed improperly. */
  VERIFICATION_METHOD_ERROR = 'VERIFICATION_METHOD_ERROR',

  /** Something about the DID Update Payload indicates the potential for late publishing. */
  LATE_PUBLISHING = 'LATE_PUBLISHING',

  /** The update data required for resolution is missing. */
  MISSING_UPDATE_DATA = 'MISSING_UPDATE_DATA',

  /** The data for a Beacon Signal does not agree with its Signal Bytes. */
  INVALID_SIGNAL_DATA = 'INVALID_SIGNAL_DATA',

  /**
   * The domain value in a proof did not match the expected value. Defined by
   * {@link https://www.w3.org/TR/vc-data-integrity/#processing-errors | VC Data Integrity 1.0, Processing Errors}.
   */
  INVALID_DOMAIN_ERROR = 'INVALID_DOMAIN_ERROR',

  /**
   * A resolution option has an invalid value. Defined by
   * {@link https://www.w3.org/TR/did-resolution-1.0/#errors | DID Resolution v1.0}
   * and reused by did:btcr2 for its own resolution options.
   */
  INVALID_OPTIONS = 'INVALID_OPTIONS',

  /**
   * The resolver does not support a resolution option, or a value of it. Defined by
   * {@link https://www.w3.org/TR/did-resolution-1.0/#errors | DID Resolution v1.0}.
   */
  FEATURE_NOT_SUPPORTED = 'FEATURE_NOT_SUPPORTED'
}

export const {
  INVALID_DID,
  METHOD_NOT_SUPPORTED,
  INTERNAL_ERROR,
  INVALID_DID_DOCUMENT,
  INVALID_DID_UPDATE,
  INVALID_DID_URL,
  NOT_FOUND,
  PROOF_VERIFICATION_ERROR,
  PROOF_GENERATION_ERROR,
  PROOF_TRANSFORMATION_ERROR,
  PROOF_SERIALIZATION_ERROR,
  PARSING_ERROR,
  INVALID_CHALLENGE_ERROR,
  VERIFICATION_METHOD_ERROR,
  LATE_PUBLISHING,
  MISSING_UPDATE_DATA,
  INVALID_SIGNAL_DATA,
  INVALID_DOMAIN_ERROR,
  INVALID_OPTIONS,
  FEATURE_NOT_SUPPORTED
} = MethodErrorCode;

type ErrorOptions = {
  type?: string;
  name?: string;
  data?: any;
}

/**
 * Normalized shape for the `data` payload on {@link DidMethodError} subclasses.
 *
 * Existing throws may still pass any `Record<string, any>` shape, but new and
 * refactored throws should converge on these keys so downstream callers can
 * inspect errors without guessing at the schema. Fields are all optional:
 * each throw site populates only what is relevant.
 *
 * Reserved keys (use these names rather than synonyms):
 * - `address`        : Bitcoin address being operated on (avoid `bitcoinAddress`,
 *                       `beaconAddress`, `signerAddress` distinctions in the payload,
 *                       prefer one `address` plus `kind` if disambiguation is needed)
 * - `kind`            : Script kind (e.g. `'p2pkh' | 'p2wpkh' | 'p2tr'`) or other
 *                       enumeration label
 * - `feeSats`         : Transaction fee in sats, as `bigint` (no `.toString()`)
 * - `valueSats`       : UTXO value in sats, as `number` or `bigint`
 * - `phase`           : State-machine phase tag
 * - `did`             : DID string
 * - `verificationMethodId` : Verification method id (full)
 * - `keyId`           : Key identifier (URN or other adapter form)
 * - `utxoCount`       : Number of UTXOs observed
 */
export type ErrorContext = {
  address?: string;
  kind?: string;
  feeSats?: bigint;
  valueSats?: number | bigint;
  phase?: string;
  did?: string;
  verificationMethodId?: string;
  keyId?: string;
  utxoCount?: number;
  [extra: string]: unknown;
};

// V8-specific Error.captureStackTrace, not in standard JS, declared here as an
// optional type augmentation so browser-compat packages don't need @types/node.
type V8ErrorConstructor = ErrorConstructor & {
  captureStackTrace?: (target: object, ctor: Function) => void;
};

export class DidMethodError extends Error {
  override name: string = 'DidMethodError';
  type: string = 'DidMethodError';
  data?: Record<string, any>;

  constructor(message: string, options: ErrorOptions = {}) {
    super(message);
    this.type = options.type ?? this.type;
    this.name = options.name ?? this.name;
    this.data = options.data;

    // Ensures that instanceof works properly, the correct prototype chain when using inheritance,
    // and that V8 stack traces (like Chrome, Edge, and Node.js) are more readable and relevant.
    Object.setPrototypeOf(this, new.target.prototype);

    // Captures the stack trace in V8 engines (like Chrome, Edge, and Node.js).
    // In non-V8 environments, the stack trace will still be captured.
    (Error as V8ErrorConstructor).captureStackTrace?.(this, DidMethodError);
  }
}

export class MethodError extends DidMethodError {
  constructor(message: string, type: string = 'MethodError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class NotImplementedError extends DidMethodError {
  constructor(message: string, type: string = 'NotImplementedError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class IdentifierError extends DidMethodError {
  constructor(message: string, type: string = 'IdentifierError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class UpdateError extends DidMethodError {
  constructor(message: string, type: string = 'UpdateError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class ResolveError extends DidMethodError {
  constructor(message: string, type: string = 'ResolveError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class KeyManagerError extends DidMethodError {
  constructor(message: string, type: string = 'KeyManagerError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class DidDocumentError extends DidMethodError {
  constructor(message: string, type: string = 'DidDocumentError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class CryptosuiteError extends DidMethodError {
  constructor(message: string, type: string = 'CryptosuiteError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class DataIntegrityProofError extends DidMethodError {
  constructor(message: string, type: string = 'DataIntegrityProofError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class KeyPairError extends DidMethodError {
  constructor(message: string, type: string = 'KeyPairError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class SecretKeyError extends DidMethodError {
  constructor(message: string, type: string = 'SecretKeyError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class PublicKeyError extends DidMethodError {
  constructor(message: string, type: string = 'PublicKeyError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class MultikeyError extends DidMethodError {
  constructor(message: string, type: string = 'MultikeyError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class ProofError extends DidMethodError {
  constructor(message: string, type: string = 'ProofError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class SingletonBeaconError extends DidMethodError {
  constructor(message: string, type: string = 'SingletonBeaconError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class CIDAggregateBeaconError extends DidMethodError {
  constructor(message: string, type: string = 'CIDAggregateBeaconError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class CanonicalizationError extends DidMethodError {
  constructor(message: string, type: string = 'CanonicalizationError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}