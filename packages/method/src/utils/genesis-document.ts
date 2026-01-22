import { getNetwork } from '@did-btcr2/bitcoin';
import { JSONUtils, KeyBytes } from '@did-btcr2/common';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { BeaconUtils } from '../core/beacon/utils.js';
import { DID_REGEX, DidDocument, DidVerificationMethod, IDidDocument, VerificationRelationships } from './did-document.js';
import { BeaconService, ID_PLACEHOLDER_VALUE } from './types-interfaces.js';

/**
 * GenesisDocument extends the DidDocument class for creating and managing intermediate DID documents.
 * This class is used to create a minimal DID document with a placeholder ID.
 * It is used in the process of creating a new DID document.
 * @class GenesisDocument
 * @extends {DidDocument}
 */
export class GenesisDocument extends DidDocument {
  constructor(document: object | DidDocument) {
    super(document as DidDocument);
  }

  /**
   * Convert the GenesisDocument to a DidDocument by replacing the placeholder value with the provided DID.
   * @param did The DID to replace the placeholder value in the document.
   * @returns {DidDocument} A new DidDocument with the placeholder value replaced by the provided DID.
   */
  public toDidDocument(did: string): DidDocument {
    const stringThis = JSON.stringify(this).replaceAll(ID_PLACEHOLDER_VALUE, did);
    const parseThis = JSON.parse(stringThis) as IDidDocument;
    return new DidDocument(parseThis);
  }


  /**
   * Create an GenesisDocument from a DidDocument by replacing the DID with a placeholder value.
   * @param {DidDocument} didDocument The DidDocument to convert.
   * @returns {GenesisDocument} The GenesisDocument representation of the DidDocument.
   */
  public static fromDidDocument(didDocument: DidDocument): GenesisDocument {
    const intermediateDocument = JSONUtils.cloneReplace(didDocument, DID_REGEX, ID_PLACEHOLDER_VALUE) as IDidDocument;
    return new GenesisDocument(intermediateDocument);
  }

  /**
   * Create a minimal GenesisDocument with a placeholder ID.
   * @param {Array<DidVerificationMethod>} verificationMethod The public key in multibase format.
   * @param {VerificationRelationships} relationships The public key in multibase format.
   * @param {Array<BeaconService>} service The service to be included in the document.
   * @returns {GenesisDocument} A new GenesisDocument with the placeholder ID.
   */
  public static create(
    verificationMethod: Array<DidVerificationMethod>,
    relationships: VerificationRelationships,
    service: Array<BeaconService>
  ): GenesisDocument {
    const id = ID_PLACEHOLDER_VALUE;
    return new GenesisDocument({ id, ...relationships, verificationMethod, service, });
  }

  /**
   * Create a minimal GenesisDocument from a public key.
   * @param {KeyBytes} publicKey The public key in bytes format.
   * @returns {GenesisDocument} A new GenesisDocument with the placeholder ID.
   */
  public static fromPublicKey(publicKey: KeyBytes, network: string): GenesisDocument {
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

    return GenesisDocument.create(verificationMethod, relationships, [service]);
  }

  /**
   * Taken an object, convert it to an IntermediateDocuemnt and then to a DidDocument.
   * @param {object | DidDocument} object The JSON object to convert.
   * @returns {DidDocument} The created DidDocument.
   */
  public static fromJSON(object: object | DidDocument): GenesisDocument {
    return new GenesisDocument(object as IDidDocument);
  }
}

/**
 * Utility class for working with DID Documents.
 */
export class Document {
  public static isValid(didDocument: DidDocument | GenesisDocument): boolean {
    return new DidDocument(didDocument).validate();
  }
}
