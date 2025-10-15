import {
  DocumentBytes,
  INVALID_DID_DOCUMENT,
  KeyBytes,
  METHOD_NOT_SUPPORTED,
  MethodError,
  PatchOperation,
  W3C_DID_RESOLUTION_V1
} from '@did-btcr2/common';
import type { DidResolutionResult } from '@web5/dids';
import {
  Did,
  DidError,
  DidErrorCode,
  DidMethod,
  EMPTY_DID_RESOLUTION_RESULT
} from '@web5/dids';
import { initEccLib } from 'bitcoinjs-lib';
import * as tinysecp from 'tiny-secp256k1';
import { Resolve } from './core/crud/read.js';
import { Update } from './core/crud/update.js';
import { DidResolutionOptions } from './interfaces/crud.js';
import { Appendix } from './utils/appendix.js';
import { DidDocument, DidVerificationMethod } from './utils/did-document.js';
import { Identifier } from './utils/identifier.js';
import { SignalsMetadata } from './types/crud.js';

export type Btcr2Identifier = string;

export interface DidCreateOptions {
  /** DID BTCR2 Version Number */
  version?: number;
  /** Bitcoin Network */
  network?: string;
}

/** Initialize tiny secp256k1 */
initEccLib(tinysecp);

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2 | did:btcr2 DID Method Specification}.
 * did:btcr2 is a censorship resistant DID Method using the Bitcoin blockchain as a Verifiable Data Registry to announce
 * changes to the DID document. It improves on prior work by allowing: zero-cost off-chain DID creation; aggregated
 * updates for scalable on-chain update costs; long-term identifiers that can support frequent updates; private
 * communication of the DID document; private DID resolution; and non-repudiation appropriate for serious contracts.
 *
 * @class DidBtcr2
 * @type {DidBtcr2}
 * @implements {DidMethod}
 */
export class DidBtcr2 implements DidMethod {
  /** @type {string} Name of the DID method, as defined in the DID BTCR2 specification */
  public static methodName: string = 'btcr2';

  /**
   * Entry point for section {@link https://dcdpr.github.io/did-btcr2/#create | 4.1 Create}.
   * See {@link Create} for implementation details.
   *
   * A did:btcr2 identifier and associated DID document can either be created deterministically from a cryptographic
   * seed, or it can be created from an arbitrary genesis intermediate DID document representation. In both cases,
   * DID creation can be undertaken in an offline manner, i.e., the DID controller does not need to interact with the
   * Bitcoin network to create their DID.
   * @param {CreateParams} params See {@link CreateParams} for details.
   * @param {IdType} params.idType Type of identifier to create (key or external).
   * @param {KeyBytes} params.pubKeyBytes Public key byte array used to create a btcr2 "key" identifier.
   * @param {IntermediateDocument} params.intermediateDocument DID Document used to create a btcr2 "external" identifier.
   * @param {DidCreateOptions} params.options See {@link DidCreateOptions} for create options.
   * @param {number} params.options.version Version number of the btcr2 method.
   * @param {string} params.options.network Bitcoin network name (mainnet, testnet, signet, regtest).
   * @returns {Promise<CreateResponse>} Promise resolving to a CreateResponse object.
   * @throws {DidBtcr2Error} if any of the checks fail
   */
  public static async create(params: {
    idType: 'KEY' | 'EXTERNAL';
    genesisBytes: KeyBytes | DocumentBytes;
    options?: DidCreateOptions;
  }): Promise<Btcr2Identifier> {
    // Deconstruct the idType and options from the params
    const { idType, options = {} } = params;

    // Deconstruct the version and network from the options, setting defaults if not given
    const { version = 1, network = 'bitcoin' } = options;

    // Set the genesisBytes from the params
    const genesisBytes = params.genesisBytes;

    return Identifier.encode({ idType, genesisBytes, version, network });
  }

  /**
   * Entry point for section {@link https://dcdpr.github.io/did-btcr2/#read | 7.2 Read}.
   * See {@link Resolve} for implementation details.
   *
   * The Read operation is an algorithm consisting of a series of subroutine algorithms executed by a resolver after a
   * resolution request identifying a specific did:btcr2 identifier is received from a client at Resolution Time. The
   * request MUST always contain the resolutionOptions object containing additional information to be used in resolution.
   * This object MAY be empty. See the DID Resolution specification for further details about the DID Resolution Options
   * object. The resolver then attempts to resolve the DID document of the identifier at a specific Target Time. The
   * Target Time is either provided in resolutionOptions or is set to the Resolution Time of the request.
   *
   * @param {string} identifier a valid did:btcr2 identifier to be resolved
   * @param {DidResolutionOptions} [resolutionsOptions] see {@link https://www.w3.org/TR/did-1.0/#did-resolution-options | DidResolutionOptions}
   * @param {number} options.versionId the version of the identifier and/or DID document
   * @param {number} options.versionTime a timestamp used during resolution as a bound for when to stop resolving
   * @param {DidDocument} options.sidecarData data necessary for resolving a DID
   * @param {string} options.network Bitcoin network name (mainnet, testnet, signet, regtest).
   * @returns {DidResolutionResult} Promise resolving to a DID Resolution Result containing the `targetDocument`
   * @throws {Error} if the resolution fails for any reason
   * @throws {DidError} InvalidDid if the identifier is invalid
   * @example
   * ```ts
   * const resolution = await DidBtcr2.resolve('did:btcr2:k1q0dygyp3gz969tp46dychzy4q78c2k3js68kvyr0shanzg67jnuez2cfplh')
   * ```
   */
  public static async resolve(identifier: string, resolutionsOptions: DidResolutionOptions = {}): Promise<DidResolutionResult> {
    try {
      // 1. Pass identifier to the did:btcr2 Identifier Decoding algorithm, retrieving idType, version, network, and genesisBytes.
      // 2. Set identifierComponents to a map of idType, version, network, and genesisBytes.
      const identifierComponents = Identifier.decode(identifier);

      // Set the network based on the decoded identifier
      resolutionsOptions.network ??= identifierComponents.network;

      // 3. Set initialDocument to the result of running the algorithm in Resolve Initial Document passing in the
      //    identifier, identifierComponents and resolutionOptions.
      const initialDocument = await Resolve.initialDocument({ identifier, identifierComponents, resolutionsOptions });

      // 4. Set targetDocument to the result of running the algorithm in Resolve Target Document passing in
      //    initialDocument and resolutionOptions.
      const targetDocument = await Resolve.targetDocument({ initialDocument, resolutionsOptions });

      // 5. Return targetDocument.
      const didResolutionResult: DidResolutionResult = {
        '@context'            : W3C_DID_RESOLUTION_V1,
        didResolutionMetadata : { contentType: 'application/ld+json' },
        didDocumentMetadata   : { created: new Date().getUTCDateTime() },
        didDocument           : targetDocument,
      };

      // Return didResolutionResult;
      return didResolutionResult;
    } catch (error: any) {
      console.error(error);
      // Rethrow any unexpected errors that are not a `DidError`.
      if (!(error instanceof DidError)) throw new Error(error);

      // Return a DID Resolution Result with the appropriate error code.
      return {
        ...EMPTY_DID_RESOLUTION_RESULT,
        didResolutionMetadata : {
          error : error.code,
          ...error.message && { errorMessage: error.message }
        }
      };
    }
  }

  /**
   * Entry point for section {@link https://dcdpr.github.io/did-btcr2/#update | 4.3 Update}.
   * See {@link Update} for implementation details.
   *
   * An update to a did:btcr2 document is an invoked capability using the ZCAP-LD data format, signed by a
   * verificationMethod that has the authority to make the update as specified in the previous DID document. Capability
   * invocations for updates MUST be authorized using Data Integrity following the bip340-jcs-2025
   * cryptosuite with a proofPurpose of capabilityInvocation.
   *
   * The Update algorithm takes as inputs a Identifier, sourceDocument, sourceVersionId, documentPatch, a
   * verificationMethodId and an array of beaconIds. The sourceDocument is the DID document being updated. The
   * documentPatch is a JSON Patch object containing a set of transformations to be applied to the sourceDocument.
   * The result of these transformations MUST produce a DID document conformant to the DID Core specification. The
   * verificationMethodId is an identifier for a verificationMethod within the sourceDocument. The verificationMethod
   * identified MUST be a BIP340 Multikey. The beaconIds MUST identify service endpoints with one of the three Beacon
   * Types SingletonBeacon, CIDAggregateBeacon, and SMTAggregateBeacon.
   *
   * @param {UpdateParams} params Required parameters for the update operation.
   * @param {string} params.identifier The btcr2 identifier to be updated.
   * @param {DidDocument} params.sourceDocument The DID document being updated.
   * @param {string} params.sourceVersionId The versionId of the source document.
   * @param {PatchOperation} params.documentPatch The JSON patch to be applied to the source document.
   * @param {string} params.verificationMethodId The verificationMethod ID to sign the update
   * @param {string[]} params.beaconIds The beacon IDs to announce the update
   * @returns {Promise<void>} Promise resolving to void
   * @throws {MethodError} if the verificationMethod type is not `Multikey` or the publicKeyMultibase header is not `zQ3s`
   */
  public static async update(params: {
    identifier: string;
    sourceDocument: DidDocument;
    sourceVersionId: number;
    patch: PatchOperation[];
    verificationMethodId: string;
    beaconIds: string[];
    secretKey: KeyBytes;
  }): Promise<SignalsMetadata> {
    // Deconstruct the params
    const {
      identifier,
      sourceDocument,
      sourceVersionId,
      patch,
      verificationMethodId: methodId,
      beaconIds,
      secretKey
    } = params;

    // 1. Set unsignedUpdate to the result of passing Identifier, sourceDocument,
    //    sourceVersionId, and documentPatch into the Construct DID Update
    //    Payload algorithm.
    const didUpdatePayload = await Update.construct({
      identifier,
      sourceDocument,
      sourceVersionId,
      patch,
    });

    // 2. Set verificationMethod to the result of retrieving the verificationMethod
    //    from sourceDocument using the verificationMethodId.
    const verificationMethod = this.getSigningMethod({ didDocument: sourceDocument, methodId, });

    // Validate the verificationMethod exists in the sourceDocument
    if (!verificationMethod) {
      throw new MethodError('Verification method not found in did document', INVALID_DID_DOCUMENT, sourceDocument);
    }

    // 3. Validate the verificationMethod is a BIP340 Multikey:
    //    3.1 verificationMethod.type == Multikey
    if (verificationMethod.type !== 'Multikey') {
      throw new MethodError('Invalid type: must be type "Multikey"', INVALID_DID_DOCUMENT, verificationMethod);
    }

    //    3.2 verificationMethod.publicKeyMultibase[4] == zQ3s
    const mbasePrefix = verificationMethod.publicKeyMultibase?.slice(0, 4);
    if (mbasePrefix !== 'zQ3s') {
      throw new MethodError(`Invalid publicKeyMultibase prefix ${mbasePrefix}`, INVALID_DID_DOCUMENT, verificationMethod);
    }

    // 4. Set didUpdateInvocation to the result of passing Identifier, unsignedUpdate as didUpdatePayload, and
    //    verificationMethod to the Invoke DID Update Payload algorithm.
    const didUpdateInvocation = await Update.invoke({ identifier, verificationMethod, didUpdatePayload, secretKey });

    // 5. Set signalsMetadata to the result of passing Identifier, sourceDocument, beaconIds and didUpdateInvocation
    //    to the Announce DID Update algorithm.
    const signalsMetadata = await Update.announce({ sourceDocument, beaconIds, didUpdateInvocation, secretKey });

    // 6. Return signalsMetadata. It is up to implementations to ensure that the signalsMetadata is persisted.
    return signalsMetadata;
    // TODO: Should we be applying the patch, producing a target did document and returning it?
  }

  /**
   * Given the W3C DID Document of a `did:btcr2` identifier, return the signing verification method that will be used
   * for signing messages and credentials. If given, the `methodId` parameter is used to select the
   * verification method. If not given, the Identity Key's verification method with an ID fragment
   * of '#initialKey' is used.
   *
   * @param {{ didDocument: DidDocument; methodId?: string; }} params Parameters for the `getSigningMethod` method.
   * @param {DidDocument} params.didDocument DID Document to get the verification method from.
   * @param {string} params.methodId Optional ID of the verification method to use for signing.
   * @returns {DidVerificationMethod} Promise resolving to the {@link DidVerificationMethod} object used for signing.
   * @throws {DidError} if the parsed did method does not match `btcr2` or signing method could not be determined.
   */
  public static getSigningMethod({ didDocument, methodId }: {
    didDocument: DidDocument;
    methodId?: string;
  }): DidVerificationMethod {
    // Set the default methodId to the first assertionMethod if not given
    methodId ??= '#initialKey';

    // Verify the DID method is supported.
    const parsedDid = Did.parse(didDocument.id);
    if (parsedDid && parsedDid.method !== this.methodName) {
      throw new MethodError(`Method not supported: ${parsedDid.method}`, METHOD_NOT_SUPPORTED, { identifier: didDocument.id });
    }

    // Attempt to find a verification method that matches the given method ID, or if not given,
    // find the first verification method intended for signing claims.
    const verificationMethod = didDocument.verificationMethod?.find(
      (vm: DidVerificationMethod) => Appendix.extractDidFragment(vm.id) === (Appendix.extractDidFragment(methodId)
        ?? Appendix.extractDidFragment(didDocument.assertionMethod?.[0]))
    );

    // If no verification method is found, throw an error
    if (!(verificationMethod && verificationMethod.publicKeyMultibase)) {
      throw new DidError(
        DidErrorCode.InternalError,
        'A verification method intended for signing could not be determined from the DID Document'
      );
    }
    return verificationMethod as DidVerificationMethod;
  }
}