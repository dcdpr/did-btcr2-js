import { getNetwork } from '@did-btcr2/bitcoin';
import type {
  HashBytes,
  JSONObject,
  KeyBytes
} from '@did-btcr2/std';
import {
  CanonicalizationError,
  canonicalize,
  DidDocumentError,
  hash,
  INVALID_DID_DOCUMENT,
  JSONUtils
} from '@did-btcr2/std';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keys';
import type { DidDocument as W3CDidDocument, DidVerificationMethod as W3CDidVerificationMethod } from '@web5/dids';
import { p2pkh } from '@scure/btc-signer';
import type { BeaconService } from '../core/beacon/interfaces.js';
import { Identifier } from '../core/identifier.js';
import { didCoreProblem, isJsonMap, NOT_A_JSON_OBJECT, type ConformanceRole } from './did-core-conformance.js';
import { errorCause } from './error-cause.js';

/**
 * The context URLs that the `@context` array of a did:btcr2 DID document must hold. The array is
 * frozen, because a write to the shared value changes the check of each later document. A caller
 * that builds a document copies the array. See
 * {@link https://dcdpr.github.io/did-btcr2/data-structures.html#did-document | DID Document (data structure)}.
 */
export const BTCR2_DID_DOCUMENT_CONTEXT = Object.freeze([
  'https://www.w3.org/ns/did/v1.1',
  'https://btcr2.dev/context/v1',
] as const);

/** The `type` of the verification method that signs an update. */
export const MULTIKEY_VERIFICATION_METHOD_TYPE = 'Multikey';
export const ID_PLACEHOLDER_VALUE = 'did:btcr2:_';
export const BECH32M_CHARS = '';
export const DID_REGEX = /did:btcr2:(x1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]*)/g;

export type ExternalData = {
  id: string,
  '@context': Array<string | JSONObject>,
  verificationMethod?: Array<DidVerificationMethod>,
  authentication?: Array<string | DidVerificationMethod>,
  assertionMethod?: Array<string | DidVerificationMethod>,
  capabilityInvocation?: Array<string | DidVerificationMethod>,
  capabilityDelegation?: Array<string | DidVerificationMethod>,
  service?: Array<BeaconService>
}
export type VerificationRelationships = {
  authentication?: Array<string | DidVerificationMethod>;
  assertionMethod?: Array<string | DidVerificationMethod>;
  capabilityInvocation?: Array<string | DidVerificationMethod>;
  capabilityDelegation?: Array<string | DidVerificationMethod>;
}

/** Loose type for unvalidated DID / Genesis document-like input objects. */
export type DidDocumentLike = Partial<Btcr2DidDocument>;
export type GenesisDocumentLike = Partial<Btcr2DidDocument>;

export interface Btcr2VerificationMethod extends W3CDidVerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase?: string;
  secretKeyMultibase?: string | undefined;
}

/**
 * DID BTCR2 Verification Method extends the DidVerificationMethod class adding helper methods and properties
 * @class DidVerificationMethod
 * @type {DidVerificationMethod}
 *
 */
export class DidVerificationMethod implements Btcr2VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase?: string;
  secretKeyMultibase?: string | undefined;

  constructor(method: Btcr2VerificationMethod) {
    // Keep every property as the input holds it, also a property that this class does not
    // name, for example publicKeyJwk or expires. The class does not check the type or the
    // key: only the method that signs an update must be a secp256k1 Multikey.
    // defineProperty keeps a "__proto__" property as data. It does not change the prototype.
    for (const [key, value] of Object.entries(method)) {
      Object.defineProperty(this, key, { value, enumerable: true, writable: true, configurable: true });
    }
    this.id = method.id;
    this.type = method.type;
    this.controller = method.controller;

    // Remove each undefined value, also the value of a field that the input does not hold.
    const own = this as Record<string, unknown>;
    for (const key of Object.keys(own)) {
      if (own[key] === undefined) delete own[key];
    }
  }
  // TODO: Add helper methods and properties
}

/**
 * BTCR2 DID Document Interface
 * @interface Btcr2DidDocument
 * @type {Btcr2DidDocument}
 * @extends {W3CDidDocument}
 * @property {string} id - The identifier of the DID Document.
 * @property {Array<string | JSONObject>} '@context' - The context of the DID Document.
 * @property {Array<DidVerificationMethod>} [verificationMethod] - The verification methods of the DID Document.
 * @property {Array<string | DidVerificationMethod>} [authentication] - The authentication methods of the DID Document.
 * @property {Array<string | DidVerificationMethod>} [assertionMethod] - The assertion methods of the DID Document.
 * @property {Array<string | DidVerificationMethod>} [capabilityInvocation] - The capability invocation methods of the DID Document.
 * @property {Array<string | DidVerificationMethod>} [capabilityDelegation] - The capability delegation methods of the DID Document.
 * @property {Array<BeaconService>} [service] - The services of the DID Document.
 */
export interface Btcr2DidDocument extends W3CDidDocument {
  id: string;
  '@context': Array<string | JSONObject>;
  verificationMethod?: Array<DidVerificationMethod>;
  authentication?: Array<string | DidVerificationMethod>;
  assertionMethod?: Array<string | DidVerificationMethod>;
  capabilityInvocation?: Array<string | DidVerificationMethod>;
  capabilityDelegation?: Array<string | DidVerificationMethod>;
  service?: Array<BeaconService>;
  deactivated?: boolean;
}

/**
 * BTCR2 DID Document extends the DidDocument class adding helper methods and properties
 * @class DidDocument
 * @type {DidDocument}
 * @implements {Btcr2DidDocument}
 * @property {string} id - The identifier of the DID Document.
 * @property {Array<string | JSONObject>} '@context' - The context of the DID Document.
 * @property {Array<DidVerificationMethod>} [verificationMethod] - The verification methods of the DID Document.
 * @property {Array<string | DidVerificationMethod>} [authentication] - The authentication methods of the DID Document.
 * @property {Array<string | DidVerificationMethod>} [assertionMethod] - The assertion methods of the DID Document.
 * @property {Array<string | DidVerificationMethod>} [capabilityInvocation] - The capability invocation methods of the DID Document.
 * @property {Array<string | DidVerificationMethod>} [capabilityDelegation] - The capability delegation methods of the DID Document.
 * @property {Array<BeaconService>} [service] - The services of the DID Document.
 * @property {boolean} [deactivated] - Indicates if the DID Document is deactivated.
 */
export class DidDocument implements Btcr2DidDocument {
  // The field declarations set the key order of a document (ADR 144). They give no
  // default value: the constructor copies the input, and validation refuses a document
  // without "@context" or "id".
  id!: string;
  '@context'!: Array<string | JSONObject>;
  verificationMethod?: Array<DidVerificationMethod>;
  authentication?: Array<string | DidVerificationMethod>;
  assertionMethod?: Array<string | DidVerificationMethod>;
  capabilityInvocation?: Array<string | DidVerificationMethod>;
  capabilityDelegation?: Array<string | DidVerificationMethod>;
  service?: Array<BeaconService>;
  deactivated?: boolean;

  constructor(document: DidDocumentLike) {
    if(!isJsonMap(document)) {
      throw new DidDocumentError(NOT_A_JSON_OBJECT, INVALID_DID_DOCUMENT, { document });
    }

    // The checks run after the copy, in the order of DidDocument.isValid or validateGenesis.
    const isGenesis = document.id === ID_PLACEHOLDER_VALUE;

    // Keep every property as the input holds it, also a property that this class does not
    // name, for example alsoKnownAs, controller, or keyAgreement (ADR 144). defineProperty
    // keeps a "__proto__" property as data. It does not change the prototype.
    for (const [key, value] of Object.entries(document)) {
      Object.defineProperty(this, key, { value, enumerable: true, writable: true, configurable: true });
    }

    // Sanitize the DID Document
    DidDocument.sanitize(this);

    // If the DID Document is not an intermediateDocument, validate it
    if (isGenesis) {
      this.validateGenesis();
    } else {
      DidDocument.validate(this);
    }
  }

  /**
   * Convert the DidDocument to a JSON object.
   * @returns {DidDocument} The JSON representation of the DidDocument, with every property.
   */
  public toJSON(): DidDocumentLike {
    return { ...this };
  }

  /**
   * Create a minimal DidDocument from "k1" btcr2 identifier. The document `id` is
   * the DID, and the one verification method is `<did>#initialKey`. The four
   * verification relationships reference this method, as the KEY template of the
   * specification says.
   * @param {string} id The k1 DID, without a fragment.
   * @param {string} publicKeyMultibase The public key in multibase format.
   * @param {Array<BeaconService>} service The beacon services to be included in the document.
   * @returns {DidDocument} A new DidDocument.
   */
  public static fromKeyIdentifier(
    id: string,
    publicKeyMultibase: string,
    service: Array<BeaconService>
  ): DidDocument {
    const keyRef = `${id}#initialKey`;
    return new DidDocument({
      id,
      '@context'         : [...BTCR2_DID_DOCUMENT_CONTEXT],
      verificationMethod : [{
        id         : keyRef,
        type       : 'Multikey',
        controller : id,
        publicKeyMultibase
      }],
      authentication       : [keyRef],
      assertionMethod      : [keyRef],
      capabilityInvocation : [keyRef],
      capabilityDelegation : [keyRef],
      service
    });
  }

  /**
   * Create a DidDocument from the data of an "x1" btcr2 identifier. The method adds no member:
   * the data must contain "@context", as any other input must.
   * @param {ExternalData} data The members of the DID document.
   * @returns {DidDocument} A new DidDocument.
   * @throws {DidDocumentError} `INVALID_DID_DOCUMENT` if the data is not a valid DID document,
   * for example if it has no "@context".
   */
  public static fromExternalIdentifier(data: ExternalData): DidDocument {
    return new DidDocument(data as Btcr2DidDocument);
  }


  /**
   * Sanitize the DID Document by removing undefined values
   * @returns {DidDocument} The sanitized DID Document
   */
  public static sanitize(doc: DidDocument): DidDocument {
    for (const key of Object.keys(doc)) {
      if (doc[key as keyof DidDocument] === undefined) {
        delete doc[key as keyof DidDocument];
      }
    }
    return doc;
  }

  /**
   * Validates a DID document. The checks run in this order, and the first check that fails
   * throws:
   * 1. The document is a JSON object.
   * 2. "@context" is an array that contains the two btcr2 contexts.
   * 3. The id is a did:btcr2 identifier.
   * 4. The members conform to DID Core v1.1. See `didCoreProblem` in
   *    `utils/did-core-conformance.ts` for the rules and their order. The message is
   *    `Invalid "<member>": <rule>`.
   *
   * The read path is a `consumer`. The write path is a `producer`: it also checks the URL
   * syntax, sets with a repeated item, `secretKeyMultibase`, and ids that two items share.
   * @param {DidDocument} didDocument The DID document to validate.
   * @param {'consumer' | 'producer'} role The role of the caller. The default is `consumer`.
   * @returns {boolean} True if the DID document is valid.
   * @throws {DidDocumentError} `INVALID_DID_DOCUMENT` if a check fails.
   */
  public static isValid(didDocument: DidDocumentLike, role: ConformanceRole = 'consumer'): boolean {
    if (!isJsonMap(didDocument)) {
      throw new DidDocumentError(NOT_A_JSON_OBJECT, INVALID_DID_DOCUMENT, { document: didDocument });
    }
    if (!this.isValidContext(didDocument['@context'])) {
      throw new DidDocumentError('Invalid "@context"', INVALID_DID_DOCUMENT, didDocument);
    }
    if (!this.isValidId(didDocument.id)) {
      throw new DidDocumentError('Invalid "id"', INVALID_DID_DOCUMENT, didDocument);
    }
    const problem = didCoreProblem(didDocument, role);
    if (problem) {
      throw new DidDocumentError(`Invalid "${problem.member}": ${problem.message}`, INVALID_DID_DOCUMENT, didDocument);
    }
    return true;
  }

  /**
   * Validates that "@context" exists and includes correct values.
   * @private
   * @param {DidDocument['@context']} context The context to validate.
   * @returns {boolean} True if the context is valid.
   */
  private static isValidContext(context: unknown): boolean {
    // "@context" must be a non-empty array of context entries.
    if(!Array.isArray(context) || context.length === 0) return false;
    // The btcr2 base contexts must all be present. Additional proof-suite or
    // extension contexts (string or inline object) are permitted per W3C DID
    // Core 4.1 and are no longer rejected by a strict whitelist.
    return BTCR2_DID_DOCUMENT_CONTEXT.every(required => context.includes(required));
  }

  /**
   * Validates that the DID Document has a valid id.
   * @private
   * @param {string} id The id to validate.
   * @returns {boolean} True if the id is valid.
   */
  private static isValidId(id: unknown): boolean {
    if (typeof id !== 'string') return false;
    try {
      Identifier.decode(id);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate the DID Document
   * @returns {DidDocument} Validated DID Document.
   * @throws {DidDocumentError} If the DID Document is invalid.
   */
  public static validate(didDocument: any): DidDocument {
    // Validate the DID Document
    if (didDocument.id === ID_PLACEHOLDER_VALUE) {
      (didDocument as GenesisDocument).validateGenesis();
    } else {
      DidDocument.isValid(didDocument);
    }
    // Return the DID Document
    return didDocument;
  }

  /**
   * Validate the GenesisDocument. The checks run in this order, and the first check that fails
   * throws:
   * 1. The id is the placeholder.
   * 2. "@context" is an array that contains the two btcr2 contexts.
   * 3. The members conform to DID Core v1.1, with the rules of {@link DidDocument.isValid}
   *    for the role. The message is `Invalid GenesisDocument <member>: <rule>`.
   *
   * The create path is a `producer`. A `consumer` uses the rules of the resolver, which
   * checks the document after it replaces each placeholder with the DID.
   *
   * A method id or a service id does not need the placeholder. DID Core v1.1 lets a method id
   * be a relative DID URL, for example `#key-0`. CID v1.0 requires only that a service id is a
   * URL.
   *
   * A method needs a DID as its controller, and the controller can be another DID. Only the
   * method that signs an update must have the DID as its controller.
   * @param {'consumer' | 'producer'} role The role of the caller. The default is `consumer`.
   * @returns {boolean} True if the GenesisDocument is valid.
   * @throws {DidDocumentError} `INVALID_DID_DOCUMENT` if a check fails.
   */
  public validateGenesis(role: ConformanceRole = 'consumer'): boolean {
    if(this.id !== ID_PLACEHOLDER_VALUE) {
      throw new DidDocumentError('Invalid GenesisDocument ID', INVALID_DID_DOCUMENT, this);
    }
    if(!DidDocument.isValidContext(this['@context'])) {
      throw new DidDocumentError('Invalid GenesisDocument "@context"', INVALID_DID_DOCUMENT, this);
    }
    const problem = didCoreProblem(this as unknown as Record<string, unknown>, role);
    if(problem) {
      throw new DidDocumentError(`Invalid GenesisDocument ${problem.member}: ${problem.message}`, INVALID_DID_DOCUMENT, this);
    }
    return true;
  }

  /**
   * Convert the DidDocument to an GenesisDocument.
   * @returns {GenesisDocument} The GenesisDocument representation of the DidDocument.
   */
  public toIntermediate(): GenesisDocument {
    if(this.id.includes('k1')) {
      throw new DidDocumentError('Cannot convert a key identifier to an intermediate document', INVALID_DID_DOCUMENT, this);
    }
    return new GenesisDocument(this);
  }
}

/**
 * A Genesis Document: a DID document whose id is the placeholder `did:btcr2:_`. Its canonical
 * hash is the genesis bytes of an EXTERNAL identifier. The constructor adds no member, so the
 * input must contain "@context" with the two btcr2 contexts. `verificationMethod` and `service`
 * are optional. The constructor runs the genesis checks only if the id is the placeholder.
 * `GenesisDocument.create` and `GenesisDocument.fromPublicKey` write the two contexts.
 * @class GenesisDocument
 * @extends {DidDocument}
 */
export class GenesisDocument extends DidDocument {
  constructor(document: DidDocumentLike) {
    super(document);
  }

  /**
   * Convert the GenesisDocument to a DidDocument by replacing the placeholder value with the provided DID.
   * @param did The DID to replace the placeholder value in the document.
   * @returns {DidDocument} A new DidDocument with the placeholder value replaced by the provided DID.
   */
  public toDidDocument(did: string): DidDocument {
    const stringThis = JSON.stringify(this).replaceAll(ID_PLACEHOLDER_VALUE, did);
    const parseThis = JSON.parse(stringThis) as Btcr2DidDocument;
    return new DidDocument(parseThis);
  }


  /**
   * Create an GenesisDocument from a DidDocument by replacing the DID with a placeholder value.
   * @param {DidDocument} didDocument The DidDocument to convert.
   * @returns {GenesisDocument} The GenesisDocument representation of the DidDocument.
   */
  public static fromDidDocument(didDocument: DidDocument): GenesisDocument {
    const intermediateDocument = JSONUtils.cloneReplace(didDocument, DID_REGEX, ID_PLACEHOLDER_VALUE) as Btcr2DidDocument;
    return new GenesisDocument(intermediateDocument);
  }

  /**
   * Create a GenesisDocument with the placeholder id and the two btcr2 contexts. The document
   * must pass the checks of {@link DidDocument.validateGenesis} for a `producer`.
   * @param {Array<DidVerificationMethod>} verificationMethod The verification methods.
   * @param {VerificationRelationships} relationships The verification relationships.
   * @param {Array<BeaconService>} service The services of the document.
   * @returns {GenesisDocument} A new GenesisDocument with the placeholder ID.
   * @throws {DidDocumentError} `INVALID_DID_DOCUMENT` if a check fails.
   */
  public static create(
    verificationMethod: Array<DidVerificationMethod>,
    relationships: VerificationRelationships,
    service: Array<BeaconService>
  ): GenesisDocument {
    const document = new GenesisDocument({
      id         : ID_PLACEHOLDER_VALUE,
      '@context' : [...BTCR2_DID_DOCUMENT_CONTEXT],
      ...relationships,
      verificationMethod,
      service,
    });
    document.validateGenesis('producer');
    return document;
  }

  /**
   * Create a minimal GenesisDocument from a public key.
   * @param {KeyBytes} publicKey The public key in bytes format.
   * @returns {GenesisDocument} A new GenesisDocument with the placeholder ID.
   */
  public static fromPublicKey(publicKey: KeyBytes, network: string): GenesisDocument {
    const pk = new CompressedSecp256k1PublicKey(publicKey);
    const id = ID_PLACEHOLDER_VALUE;
    const address = p2pkh(pk.compressed, getNetwork(network)).address;
    const services = [{
      id              : `${id}#service-0`,
      serviceEndpoint : `bitcoin:${address}`,
      type            : 'SingletonBeacon',
    }];

    const relationships = {
      authentication       : [`${id}#key-0`],
      assertionMethod      : [`${id}#key-0`],
      capabilityInvocation : [`${id}#key-0`],
      capabilityDelegation : [`${id}#key-0`]
    };
    const verificationMethod = [
      {
        id                 : `${id}#key-0`,
        type               : 'Multikey',
        controller         : id,
        publicKeyMultibase : pk.multibase.encoded,
      }
    ];

    return GenesisDocument.create(verificationMethod, relationships, services);
  }

  /**
   * Make a GenesisDocument from a JSON object. The method adds no member.
   * @param {object | DidDocument} object The JSON object to convert.
   * @returns {GenesisDocument} The GenesisDocument.
   * @throws {DidDocumentError} `INVALID_DID_DOCUMENT` if the object is not a valid DID document
   * or Genesis Document.
   */
  public static fromJSON(object: object | DidDocument): GenesisDocument {
    return new GenesisDocument(object as Btcr2DidDocument);
  }

  /**
   * Convert a GenesisDocument to genesis bytes.
   * @param {GenesisDocument} genesisDocument The GenesisDocument to convert.
   * @returns {Bytes} The genesis bytes.
   * @throws {DidDocumentError} `INVALID_DID_DOCUMENT` if the document has no JCS form, for example
   * if it holds NaN or a lone surrogate. `data.cause` holds the CanonicalizationError.
   */
  static toGenesisBytes(genesisDocument: GenesisDocumentLike): HashBytes {
    try {
      return hash(canonicalize(genesisDocument));
    } catch(error) {
      if(!(error instanceof CanonicalizationError)) throw error;
      throw new DidDocumentError(
        `Invalid genesis document: ${error.message}`,
        INVALID_DID_DOCUMENT, { cause: errorCause(error) }
      );
    }
  }
}