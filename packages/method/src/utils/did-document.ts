import { getNetwork } from '@did-btcr2/bitcoin';
import {
  BTCR2_DID_DOCUMENT_CONTEXT,
  DidDocumentError,
  ID_PLACEHOLDER_VALUE,
  IdentifierTypes,
  INVALID_DID_DOCUMENT,
  JSONObject,
  KeyBytes,
  Logger
} from '@did-btcr2/common';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { DidService, DidDocument as IIDidDocument, DidVerificationMethod as IIDidVerificationMethod } from '@web5/dids';
import { BeaconService } from '../core/beacons/interface.js';
import { Appendix } from './appendix.js';
import { BeaconUtils } from '../core/beacons/utils.js';
import { Identifier } from './identifier.js';

export const BECH32M_CHARS = '';
export const DID_REGEX = /did:btcr2:(x1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]*)/g;

export type ExternalData = {
  id: string,
  verificationMethod: Array<DidVerificationMethod>,
  authentication?: Array<string | DidVerificationMethod>,
  assertionMethod?: Array<string | DidVerificationMethod>,
  capabilityInvocation?: Array<string | DidVerificationMethod>,
  capabilityDelegation?: Array<string | DidVerificationMethod>,
  service: Array<BeaconService>
}
export type VerificationRelationships = {
  authentication?: Array<string | DidVerificationMethod>;
  assertionMethod?: Array<string | DidVerificationMethod>;
  capabilityInvocation?: Array<string | DidVerificationMethod>;
  capabilityDelegation?: Array<string | DidVerificationMethod>;
}

export interface IDidVerificationMethod extends IIDidVerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase: string;
  secretKeyMultibase?: string | undefined;
}

/**
 * DID BTCR2 Verification Method extends the DidVerificationMethod class adding helper methods and properties
 * @class DidVerificationMethod
 * @type {DidVerificationMethod}
 *
 */
export class DidVerificationMethod implements IDidVerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase: string;
  secretKeyMultibase?: string | undefined;

  constructor({ id, type, controller, publicKeyMultibase, secretKeyMultibase }: IDidVerificationMethod) {
    this.id = id;
    this.type = type;
    this.controller = controller;
    this.publicKeyMultibase = publicKeyMultibase;
    this.secretKeyMultibase = secretKeyMultibase;
    if(!secretKeyMultibase){
      delete this.secretKeyMultibase;
    }
  }
  // TODO: Add helper methods and properties
}

/**
 * BTCR2 DID Document Interface
 * @interface IDidDocument
 * @type {IDidDocument}
 * @extends {IIDidDocument}
 * @property {string} id - The identifier of the DID Document.
 * @property {Array<string>} [controller] - The controller of the DID Document.
 * @property {Array<string | JSONObject>} ['@context'] - The context of the DID Document.
 * @property {Array<DidVerificationMethod>} verificationMethod - The verification methods of the DID Document.
 * @property {Array<string | DidVerificationMethod>} [authentication] - The authentication methods of the DID Document.
 * @property {Array<string | DidVerificationMethod>} [assertionMethod] - The assertion methods of the DID Document.
 * @property {Array<string | DidVerificationMethod>} [capabilityInvocation] - The capability invocation methods of the DID Document.
 * @property {Array<string | DidVerificationMethod>} [capabilityDelegation] - The capability delegation methods of the DID Document.
 * @property {Array<BeaconService>} service - The services of the DID Document.
 */
export interface IDidDocument extends IIDidDocument {
  id: string;
  controller?: Array<string>;
  '@context'?: Array<string | JSONObject>;
  verificationMethod: Array<DidVerificationMethod>;
  authentication?: Array<string | DidVerificationMethod>;
  assertionMethod?: Array<string | DidVerificationMethod>;
  capabilityInvocation?: Array<string | DidVerificationMethod>;
  capabilityDelegation?: Array<string | DidVerificationMethod>;
  service: Array<BeaconService>;
}

/**
 * BTCR2 DID Document extends the DidDocument class adding helper methods and properties
 * @class DidDocument
 * @type {DidDocument}
 * @implements {IDidDocument}
 * @property {string} id - The identifier of the DID Document.
 * @property {Array<string>} [controller] - The controller of the DID Document.
 * @property {Array<string | JSONObject>} ['@context'] - The context of the DID Document.
 * @property {Array<DidVerificationMethod>} verificationMethod - The verification methods of the DID Document.
 * @property {Array<string | DidVerificationMethod>} [authentication] - The authentication methods of the DID Document.
 * @property {Array<string | DidVerificationMethod>} [assertionMethod] - The assertion methods of the DID Document.
 * @property {Array<string | DidVerificationMethod>} [capabilityInvocation] - The capability invocation methods of the DID Document.
 * @property {Array<string | DidVerificationMethod>} [capabilityDelegation] - The capability delegation methods of the DID Document.
 * @property {Array<BeaconService>} service - The services of the DID Document.
 */
export class DidDocument implements IDidDocument {
  id: string;
  controller?: Array<string>;
  '@context'?: Array<string | JSONObject> = BTCR2_DID_DOCUMENT_CONTEXT;
  verificationMethod: Array<DidVerificationMethod>;
  authentication?: Array<string | DidVerificationMethod>;
  assertionMethod?: Array<string | DidVerificationMethod>;
  capabilityInvocation?: Array<string | DidVerificationMethod>;
  capabilityDelegation?: Array<string | DidVerificationMethod>;
  service: Array<BeaconService>;

  constructor(document: IDidDocument) {
    console.log('Constructing DidDocument with document:', document);
    // Set the ID and ID type
    const idType = document.id.includes('k1')
      ? IdentifierTypes.KEY
      : IdentifierTypes.EXTERNAL;

    // Validate ID and parts for non-intermediate
    const isIntermediate = document.id === ID_PLACEHOLDER_VALUE;
    // Deconstruct the document parts for validation
    const { id, controller, verificationMethod: vm, service } = document;
    if (!isIntermediate) {
      if (!DidDocument.isValidId(id)) {
        throw new DidDocumentError(`Invalid id: ${id}`, INVALID_DID_DOCUMENT, document);
      }
      if(!DidDocument.isValidController(controller ?? [id])) {
        throw new DidDocumentError(`Invalid controller: ${controller}`, INVALID_DID_DOCUMENT, document);
      }
      if (!DidDocument.isValidVerificationMethods(vm)) {
        throw new DidDocumentError('Invalid verificationMethod: ' + vm, INVALID_DID_DOCUMENT, document);
      }
      if (!DidDocument.isValidServices(service)) {
        throw new DidDocumentError('Invalid service: ' + service, INVALID_DID_DOCUMENT, document);
      }
    }

    // Set core properties
    this.id = document.id;
    this.verificationMethod = document.verificationMethod;
    this.service = document.service;
    this['@context'] = document['@context'] || BTCR2_DID_DOCUMENT_CONTEXT;
    this.controller = document.controller || [this.id];

    // Relationships logic based on idType
    if (idType === IdentifierTypes.KEY) {
      // auto-generate #initialKey if missing
      const keyRef = `${this.id}#initialKey`;
      this.authentication = document.authentication || [keyRef];
      this.assertionMethod = document.assertionMethod || [keyRef];
      this.capabilityInvocation = document.capabilityInvocation || [keyRef];
      this.capabilityDelegation = document.capabilityDelegation || [keyRef];
    } else {
      // EXTERNAL: use provided arrays, must be defined
      this.authentication = document.authentication;
      this.assertionMethod = document.assertionMethod;
      this.capabilityInvocation = document.capabilityInvocation;
      this.capabilityDelegation = document.capabilityDelegation;
    }

    // Sanitize the DID Document
    DidDocument.sanitize(this);
    // If the DID Document is not an intermediateDocument, validate it
    if (!isIntermediate) {
      DidDocument.validate(this);
    } else {
      this.validateIntermediate();
    }
  }

  /**
   * Convert the DidDocument to a JSON object.
   * @returns {JSONObject} The JSON representation of the DidDocument.
   */
  public json(): JSONObject {
    return {
      id                   : this.id,
      controller           : this.controller,
      '@context'           : this['@context'],
      verificationMethod   : this.verificationMethod,
      authentication       : this.authentication,
      assertionMethod      : this.assertionMethod,
      capabilityInvocation : this.capabilityInvocation,
      capabilityDelegation : this.capabilityDelegation,
      service              : this.service
    };
  }

  /**
   * Create a minimal DidDocument from "k1" btcr2 identifier.
   * @param {string} publicKeyMultibase The public key in multibase format.
   * @param {Array<BeaconService>} service The beacon services to be included in the document.
   * @returns {DidDocument} A new DidDocument with the placeholder ID.
   */
  public static fromKeyIdentifier(
    id: string,
    publicKeyMultibase: string,
    service: Array<BeaconService>
  ): DidDocument {
    // Ensure the ID is in the correct format
    id = id.includes('#') ? id : `${id}#initialKey`;
    // Create the verification method and the DidDocument
    const document = {
      id,
      verificationMethod : [
        new DidVerificationMethod({
          id,
          type       : 'Multikey',
          controller : id,
          publicKeyMultibase
        })
      ],
      service
    } as IDidDocument;
    return new DidDocument(document);
  }

  /**
   * Create a DidDocument from "x1" btcr2 identifier.
   * @param {ExternalData} data The verification methods of the DID Document.
   * @returns {DidDocument} A new DidDocument.
   */
  public static fromExternalIdentifier(data: ExternalData): DidDocument {
    return new DidDocument(data as IDidDocument);
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
   * Validates a DidDocument by breaking it into modular validation methods.
   * @param {DidDocument} didDocument The DID document to validate.
   * @returns {boolean} True if the DID document is valid.
   * @throws {DidDocumentError} If any validation check fails.
   */
  public static isValid(didDocument: DidDocument): boolean {
    if (!this.isValidContext(didDocument?.['@context'])) {
      throw new DidDocumentError('Invalid "@context"', INVALID_DID_DOCUMENT, didDocument);
    }
    if (!this.isValidId(didDocument?.id)) {
      throw new DidDocumentError('Invalid "id"', INVALID_DID_DOCUMENT, didDocument);
    }
    if (!this.isValidVerificationMethods(didDocument?.verificationMethod)) {
      throw new DidDocumentError('Invalid "verificationMethod"', INVALID_DID_DOCUMENT, didDocument);
    }
    if (!this.isValidServices(didDocument?.service)) {
      throw new DidDocumentError('Invalid "service"', INVALID_DID_DOCUMENT, didDocument);
    }
    if (!this.isValidVerificationRelationships(didDocument)) {
      throw new DidDocumentError('Invalid verification relationships', INVALID_DID_DOCUMENT, didDocument);
    }
    return true;
  }

  /**
   * Validates that "@context" exists and includes correct values.
   * @private
   * @param {DidDocument['@context']} context The context to validate.
   * @returns {boolean} True if the context is valid.
   */
  private static isValidContext(context: DidDocument['@context']): boolean {
    if(!context) return false;
    if(!Array.isArray(context)) return false;
    if(!context.every(ctx => typeof ctx === 'string' && BTCR2_DID_DOCUMENT_CONTEXT.includes(ctx))) return false;
    return true;
  }

  /**
   * Validates that the DID Document has a valid id.
   * @private
   * @param {string} id The id to validate.
   * @returns {boolean} True if the id is valid.
   */
  private static isValidId(id: string): boolean {
    try {
      Identifier.decode(id);
      return true;
    } catch (error: any) {
      Logger.error('Invalid DID Document ID', error);
      return false;
    }
  }

  /**
   * Validates that the controller exists and is correctly formatted.
   * @param {Array<string>} controller The controller to validate.
   * @returns {boolean} True if the controller is valid.
   */
  private static isValidController(controller: Array<string>): boolean {
    if(!controller) return false;
    if(!Array.isArray(controller)) return false;
    if(!controller.every(c => typeof c === 'string')) return false;
    return true;
  }

  /**
   * Validates that verification methods exist and are correctly formatted.
   * @private
   * @param {DidVerificationMethod[]} verificationMethod The verification methods to validate.
   * @returns {boolean} True if the verification methods are valid.
   */
  private static isValidVerificationMethods(verificationMethod: IIDidVerificationMethod[]): boolean {
    return Array.isArray(verificationMethod) && verificationMethod.every(Appendix.isDidVerificationMethod);
  }

  /**
   * Validates that the DID Document has valid services.
   * @private
   * @param {DidService[]} service The services to validate.
   * @returns {boolean} True if the services are valid.
   */
  private static isValidServices(service: DidService[]): boolean {
    return Array.isArray(service) && service.every(BeaconUtils.isBeaconService);
  }

  /**
   * Validates verification relationships (authentication, assertionMethod, capabilityInvocation, capabilityDelegation).
   * @private
   * @param {DidDocument} didDocument The DID Document to validate.
   * @returns {boolean} True if the verification relationships are valid.
   */
  public static isValidVerificationRelationships(didDocument: DidDocument): boolean {
    // Define the available verification relationships
    const possibleVerificationRelationships: (keyof DidDocument)[] = [
      'authentication',
      'assertionMethod',
      'capabilityInvocation',
      'capabilityDelegation'
    ];

    // Get the DID Document keys
    const verificationRelationships = Object.keys(didDocument) as Array<keyof DidDocument>;

    // Filter the DID Document keys to only those that are in the available verification relationships
    const availableVerificationRelationships = possibleVerificationRelationships.filter(
      key => verificationRelationships.includes(key as keyof DidDocument)
    ) as (keyof DidDocument)[];

    // Check if all available verification relationships are valid
    return availableVerificationRelationships.every((key) =>
      // Check if the key exists in the DID Document
      didDocument[key] &&
      // Check if the key is an array
      Array.isArray(didDocument[key]) &&
      // Check that every value in the array is a string or DidVerificationMethod
      didDocument[key].every(
        entry => typeof entry === 'string' || Appendix.isDidVerificationMethod(entry)
      ));
  }

  /**
   * Validate the DID Document
   * @returns {DidDocument} Validated DID Document.
   * @throws {DidDocumentError} If the DID Document is invalid.
   */
  public static validate(didDocument: DidDocument | IntermediateDidDocument): DidDocument {
    // Validate the DID Document
    if (didDocument.id === ID_PLACEHOLDER_VALUE) {
      (didDocument as IntermediateDidDocument).validateIntermediate();
    } else {
      DidDocument.isValid(didDocument);
    }
    // Return the DID Document
    return didDocument;
  }

  /**
   * Validate the IntermediateDidDocument.
   * @returns {boolean} True if the IntermediateDidDocument is valid.
   */
  public validateIntermediate(): boolean {
    // Validate the id
    if(this.id !== ID_PLACEHOLDER_VALUE) {
      throw new DidDocumentError('Invalid IntermediateDidDocument ID', INVALID_DID_DOCUMENT, this);
    }
    // Validate the controller
    if(!this.controller?.every(c => c === ID_PLACEHOLDER_VALUE)) {
      throw new DidDocumentError('Invalid IntermediateDidDocument controller', INVALID_DID_DOCUMENT, this);
    }
    // Validate the verificationMethod
    if(!this.verificationMethod.every(vm => vm.id.includes(ID_PLACEHOLDER_VALUE) && vm.controller === ID_PLACEHOLDER_VALUE)) {
      throw new DidDocumentError('Invalid IntermediateDidDocument verificationMethod', INVALID_DID_DOCUMENT, this);
    }
    // Validate the service
    if(!this.service.every(svc => svc.id.includes(ID_PLACEHOLDER_VALUE))) {
      throw new DidDocumentError('Invalid IntermediateDidDocument service', INVALID_DID_DOCUMENT, this);
    }
    if(!DidDocument.isValidVerificationRelationships(this)) {
      // Return true if all validations pass
      throw new DidDocumentError('Invalid IntermediateDidDocument assertionMethod', INVALID_DID_DOCUMENT, this);
    }

    return true;
  }

  /**
   * Convert the DidDocument to an IntermediateDidDocument.
   * @returns {IntermediateDidDocument} The IntermediateDidDocument representation of the DidDocument.
   */
  public toIntermediate(): IntermediateDidDocument {
    if(this.id.includes('k1')) {
      throw new DidDocumentError('Cannot convert a key identifier to an intermediate document', INVALID_DID_DOCUMENT, this);
    }
    return new IntermediateDidDocument(this);
  }
}

/**
 * IntermediateDidDocument extends the DidDocument class for creating and managing intermediate DID documents.
 * This class is used to create a minimal DID document with a placeholder ID.
 * It is used in the process of creating a new DID document.
 * @class IntermediateDidDocument
 * @extends {DidDocument}
 */
export class IntermediateDidDocument extends DidDocument {
  constructor(document: JSONObject) {
    super(document as IDidDocument);
  }

  /**
   * Convert the IntermediateDidDocument to a DidDocument by replacing the placeholder value with the provided DID.
   * @param did The DID to replace the placeholder value in the document.
   * @returns {DidDocument} A new DidDocument with the placeholder value replaced by the provided DID.
   */
  public toDidDocument(did: string): DidDocument {
    const stringThis = JSON.stringify(this).replaceAll(ID_PLACEHOLDER_VALUE, did);
    const parseThis = JSON.parse(stringThis) as IDidDocument;
    return new DidDocument(parseThis);
  }


  /**
   * Create an IntermediateDidDocument from a DidDocument by replacing the DID with a placeholder value.
   * @param {DidDocument} didDocument The DidDocument to convert.
   * @returns {IntermediateDidDocument} The IntermediateDidDocument representation of the DidDocument.
   */
  public static fromDidDocument(didDocument: DidDocument): IntermediateDidDocument {
    const intermediateDocument = JSON.cloneReplace(didDocument, DID_REGEX, ID_PLACEHOLDER_VALUE) as IDidDocument;
    return new IntermediateDidDocument(intermediateDocument);
  }

  /**
   * Create a minimal IntermediateDidDocument with a placeholder ID.
   * @param {Array<DidVerificationMethod>} verificationMethod The public key in multibase format.
   * @param {VerificationRelationships} relationships The public key in multibase format.
   * @param {Array<BeaconService>} service The service to be included in the document.
   * @returns {IntermediateDidDocument} A new IntermediateDidDocument with the placeholder ID.
   */
  public static create(
    verificationMethod: Array<DidVerificationMethod>,
    relationships: VerificationRelationships,
    service: Array<BeaconService>
  ): IntermediateDidDocument {
    const id = ID_PLACEHOLDER_VALUE;
    return new IntermediateDidDocument({ id, ...relationships, verificationMethod, service, });
  }

  /**
   * Create a minimal IntermediateDidDocument from a public key.
   * @param {KeyBytes} publicKey The public key in bytes format.
   * @returns {IntermediateDidDocument} A new IntermediateDidDocument with the placeholder ID.
   */
  public static fromPublicKey(publicKey: KeyBytes, network: string): IntermediateDidDocument {
    const pk = new CompressedSecp256k1PublicKey(publicKey);
    const id = ID_PLACEHOLDER_VALUE;
    const service = BeaconUtils.generateBeaconService({
      id          : `${id}#key-0`,
      publicKey   : pk.compressed,
      network     : getNetwork(network),
      addressType : 'p2pkh',
      type        : 'SingletonBeacon',
    });

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

    return IntermediateDidDocument.create(verificationMethod, relationships, [service]);
  }

  /**
   * Taken an object, convert it to an IntermediateDocuemnt and then to a DidDocument.
   * @param {JSONObject} object The JSON object to convert.
   * @returns {DidDocument} The created DidDocument.
   */
  public static fromJSON(object: JSONObject): IntermediateDidDocument {
    return new IntermediateDidDocument(object as IDidDocument);
  }
}

export class Document {
  public static isValid(didDocument: DidDocument | IntermediateDidDocument): boolean {
    return new DidDocument(didDocument).validateIntermediate();
  }
}
