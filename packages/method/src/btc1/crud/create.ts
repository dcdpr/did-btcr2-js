import { Btc1IdentifierTypes, KeyBytes, PatchOperation } from '@did-btc1/common';
import { PublicKey } from '@did-btc1/keypair';
import { DidCreateOptions as IDidCreateOptions } from '@web5/dids';
import { getNetwork } from '../../bitcoin/network.js';
import { BeaconUtils } from '../../utils/beacon.js';
import { Btc1DidDocument, IntermediateDidDocument } from '../did-document/index.js';
import { Btc1Identifier } from '../../utils/identifier.js';
import { Btc1KeyManager } from '../key-manager/index.js';

export type Btc1CreateParams = Btc1CreateKeyParams | Btc1CreateExternalParams;
export interface CreateIdentifierParams {
  genesisBytes: Uint8Array;
  newtork?: string;
  version?: string;
}
export type Btc1CreateResponse = {
  did: string;
  initialDocument: Btc1DidDocument;
};
export interface Btc1UpdateConstructParams {
    identifier: string;
    sourceDocument: Btc1DidDocument;
    sourceVersionId: number;
    patch: PatchOperation[];
}
export interface Btc1UpdateParams extends Btc1UpdateConstructParams {
    verificationMethodId: string;
    beaconIds: string[];
}
export interface DidCreateOptions extends IDidCreateOptions<Btc1KeyManager> {
  /** DID BTC1 Version Number */
  version?: number;
  /** Bitcoin Network */
  network?: string;
}
export type Btc1CreateKeyParams = {
  idType: 'KEY';
  pubKeyBytes: KeyBytes;
  options?: DidCreateOptions;
};
export type Btc1CreateExternalParams = {
  idType: 'EXTERNAL';
  intermediateDocument: IntermediateDidDocument;
  options?: DidCreateOptions;
};

/**
 * Implements section {@link https://dcdpr.github.io/did-btc1/#create | 4.1 Create}.
 *
 * A did:btc1 identifier and associated DID document can either be created deterministically from a cryptographic seed,
 * or it can be created from an arbitrary genesis intermediate DID document representation. In both cases, DID creation
 * can be undertaken in an offline manner, i.e., the DID controller does not need to interact with the Bitcoin network
 * to create their DID.
 *
 * @class Btc1Create
 * @type {Btc1Create}
 */
export class Btc1Create {
  /**
   * Implements {@link https://dcdpr.github.io/did-btc1/#deterministic-key-based-creation | 4.1.1 Deterministic Key-Based Creation}.
   *
   * For deterministic key-based creation, the did:btc1 identifier encodes a secp256k1 public key. The key is then used
   * to deterministically generate the initial DID document.
   *
   * @param {Btc1CreateKeyParams} params See {@link Btc1CreateKeyParams} for details.
   * @param {number} params.version did-btc1 identifier version.
   * @param {string} params.network did-btc1 bitcoin network.
   * @param {KeyBytes} params.pubKeyBytes public key bytes for id creation.
   * @returns {Btc1CreateResponse} A response object of type {@link Btc1CreateResponse}.
   * @throws {DidError} if the public key is missing or invalid.
   */
  public static key({ pubKeyBytes, options }: {
    pubKeyBytes: KeyBytes;
    options: DidCreateOptions;
  }): Btc1CreateResponse {
    // Deconstruct options and set the default values
    const { version = 1, network = 'bitcoin' } = options;

    // Set idType to "KEY"
    const idType = Btc1IdentifierTypes.KEY;

    // Call the the did:btc1 Identifier Encoding algorithm
    const identifier = Btc1Identifier.encode({ version, network, idType, genesisBytes: pubKeyBytes });

    // Instantiate PublicKey object and get the multibase formatted publicKey
    const { compressed: publicKey, multibase: publicKeyMultibase } = new PublicKey(pubKeyBytes);

    // Generate the service field for the DID Document
    const service = BeaconUtils.generateBeaconServices({
      identifier,
      publicKey,
      network : getNetwork(network),
      type    : 'SingletonBeacon',
    });

    // Create initialDocument ensuring conformant to spec as Btc1DidDocument
    const initialDocument = new Btc1DidDocument({
      id                 : identifier,
      controller         : [identifier],
      verificationMethod : [{
        id                 : `${identifier}#initialKey`,
        type               : 'Multikey',
        controller         : identifier,
        publicKeyMultibase : publicKeyMultibase.address,
      }],
      service,
    });

    // Return did & initialDocument
    return { did: identifier, initialDocument };
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btc1/#external-initial-document-creation | 4.1.2 External Initial Document Creation}.
   *
   * Creates a did:btc1 identifier from some initiating arbitrary DID document. This allows for more complex
   * initial DID documents, including the ability to include Service Endpoints and Beacons that support aggregation.
   * Inputs include `intermediateDocument`, optional version and network returning initialDidDocument. The
   * intermediateDocument should be a valid DID document except all places where the DID document requires the use of
   * the identifier (e.g. the id field). These fields should use placeholder value
   * `did:btc1:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`. The intermediateDocument should include at
   * least one verificationMethod and service of the type SingletonBeacon.
   *
   * @param {Btc1CreateExternalParams} params See {@link Btc1CreateExternalParams} for details.
   * @param {number} params.version Identifier version.
   * @param {string} params.network Identifier network name.
   * @param {string} params.documentBytes Intermediate DID Document bytes.
   * @returns {Btc1CreateResponse} A Promise resolving to {@link Btc1CreateResponses}.
   * @throws {DidError} if the verificationMethod or service objects are missing required properties
   */
  public static async external({ intermediateDocument, options }: {
    intermediateDocument: IntermediateDidDocument;
    options: DidCreateOptions;
  }): Promise<Btc1CreateResponse> {
    // 1. Set idType to "EXTERNAL"
    const idType = Btc1IdentifierTypes.EXTERNAL;

    // 2. Set version to 1
    // 3. Set network to the desired network.
    const { version = 1, network = 'bitcoin' } = options;

    // Validate intermediateDocument
    intermediateDocument.validateIntermediate();

    // 4. Set genesisBytes to the result of passing intermediateDocument into the JSON Canonicalization and Hash
    //    algorithm.
    const genesisBytes = await JSON.canonicalization.canonicalhash(intermediateDocument);

    // 5. Pass idType, version, network, and genesisBytes to the did:btc1 Identifier Encoding algorithm, retrieving id.
    // 6. Set did to id
    const did = Btc1Identifier.encode({ idType, genesisBytes, version, network });

    // 7. Set initialDocument to a copy of the intermediateDocument.
    // 8. Replace all did:btc1:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx values in the initialDocument with the did.
    const initialDocument = intermediateDocument.toBtc1DidDocument(did);

    // Return DID & DID Document.
    return { did, initialDocument };
  }
}