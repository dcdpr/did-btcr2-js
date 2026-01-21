import { BitcoinNetworkConnection } from '@did-btcr2/bitcoin';
import {
  Canonicalization,
  DocumentBytes,
  IdentifierHrp,
  INVALID_DID_DOCUMENT,
  KeyBytes,
  METHOD_NOT_SUPPORTED,
  MethodError,
  MISSING_UPDATE_DATA,
  PatchOperation,
  ResolveError
} from '@did-btcr2/common';
import {
  Did,
  DidError,
  DidErrorCode,
  DidMethod,
  DidResolutionResult,
  EMPTY_DID_RESOLUTION_RESULT
} from '@web5/dids';
import { initEccLib } from 'bitcoinjs-lib';
import * as tinysecp from 'tiny-secp256k1';
import { BeaconUtils } from './core/beacon/utils.js';
import { Identifier } from './core/identifier.js';
import { ResolutionOptions } from './core/interfaces.js';
import { Resolve } from './core/resolve.js';
import { SidecarData } from './core/types.js';
import { Update } from './core/update.js';
import { Appendix } from './utils/appendix.js';
import { DidDocument, DidVerificationMethod } from './utils/did-document.js';

// TODO: convert to API driver
export const canonicalization = new Canonicalization();

export type Btcr2Identifier = string;

export interface DidCreateOptions {
  /** Type of identifier to create (key or external) */
  idType: 'KEY' | 'EXTERNAL';
  /** DID BTCR2 Version Number */
  version?: number;
  /** Bitcoin Network */
  network?: string;
}

// TODO: convert to API driver
/** Initialize tiny secp256k1 */
initEccLib(tinysecp);

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2 | did:btcr2 DID Method Specification}.
 * did:btcr2 is a censorship-resistant Decentralized Identifier (DID) method using
 * the Bitcoin blockchain as a Verifiable Data Registry to announce changes to the
 * DID document. It supports zero-cost off-chain DID creation; aggregated updates
 * for scalable on-chain update costs; long-term identifiers that can support
 * frequent updates; private communication of the DID document; private DID resolution;
 * and non-repudiation.
 *
 * @class DidBtcr2
 * @type {DidBtcr2}
 * @implements {DidMethod}
 */
export class DidBtcr2 implements DidMethod {
  /** @type {string} Name of the DID method, as defined in the DID BTCR2 specification */
  static methodName: string = 'btcr2';

  /**
   * Implements section {@link https://dcdpr.github.io/did-btcr2/operations/create.html | 7.1 Create}.
   * @param {KeyBytes | DocumentBytes} genesisBytes The bytes used to create the genesis document for a did:btcr2 identifier.
   * This can be either the bytes of the genesis document itself or the bytes of a key that will be used to create the genesis document.
   * @param {DidCreateOptions} options Options for creating the identifier, including the idType (key or external), version, and network.
   * @param {string} options.idType The type of identifier to create, either 'KEY' or 'EXTERNAL'. Defaults to 'KEY'.
   * @param {number} options.version The version number of the did:btcr2 specification to use for creating the identifier. Defaults to 1.
   * @param {string} options.network The Bitcoin network to use for the identifier, e.g. 'bitcoin', 'testnet', etc. Defaults to 'bitcoin'.
   * @returns {Promise<Btcr2Identifier>} Promise resolving to a Btcr2Identifier string.
   * @throws {MethodError} if any of the checks fail
   */
  static async create(
    genesisBytes: KeyBytes | DocumentBytes,
    options?: DidCreateOptions
  ): Promise<Btcr2Identifier> {
    // Deconstruct the idType, version and network from the options, setting defaults if not given
    const { idType, version = 1, network = 'bitcoin' } = options || {};

    if(!idType) {
      throw new MethodError(
        'idType is required for creating a did:btcr2 identifier',
        INVALID_DID_DOCUMENT, options
      );
    }

    // Call identifier encoding algorithm
    return Identifier.encode({ idType, genesisBytes, version, network });
  }

  /**
   * Entry point for section {@link https://dcdpr.github.io/did-btcr2/#read | 7.2 Resolve}.
   * See specification for the {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#process | Resolve Process}.
   * See {@link Resolve | Resolve (class)} for class implementation.
   *
   * Resolving a did:btcr2 identifier iteratively builds a DID document by applying
   * BTCR2 Updates to an Initial DID Document that have been committed to the Bitcoin
   * blockchain by Authorized Beacon Signals. The Initial DID Document is either
   * deterministically created from the DID or provided by Sidecar Data.
   *
   * @param {string} did a valid did:btcr2 identifier to be resolved
   * @param {ResolutionOptions} resolutionOptions see {@link https://www.w3.org/TR/did-1.0/#did-resolution-options | ResolutionOptions}
   * @param {number} resolutionOptions.versionId optional version of the identifier and/or DID document
   * @param {number} resolutionOptions.versionTime optional timestamp used during resolution as a bound for when to stop resolving
   * @param {DidDocument} resolutionOptions.sidecar optional data necessary for resolving a DID
   * @returns {Promise<DidResolutionResult>} Promise resolving to a DID Resolution Result containing the `targetDocument`
   * @throws {Error} if the resolution fails for any reason
   * @throws {DidError} InvalidDid if the identifier is invalid
   * @example
   * ```ts
   * const resolution = await DidBtcr2.resolve(
   *  'did:btcr2:k1q0dygyp3gz969tp46dychzy4q78c2k3js68kvyr0shanzg67jnuez2cfplh'
   * )
   * ```
   */
  static async resolve(did: string, resolutionOptions: ResolutionOptions = {drivers: {}}): Promise<DidResolutionResult> {
    try {

      // Initialize an empty DID Resolution Result
      const didResolutionResult: DidResolutionResult = {
        '@context'            : 'https://w3id.org/did-resolution/v1',
        didResolutionMetadata : { contentType: 'application/ld+json' },
        didDocumentMetadata   : {
          deactivated   : false,
          updated       : undefined,
          versionId     : resolutionOptions.versionId,
          confirmations : undefined,
        },
        didDocument : null,
      };

      // Decode the did to be resolved
      const didComponents = Identifier.decode(did);

      // Process sidecar if provided
      const sidecarData = Resolve.processSidecarData(resolutionOptions.sidecar);

      // Establish a connection to a bitcoin network
      if(!resolutionOptions.drivers.bitcoin) {
        resolutionOptions.drivers.bitcoin = new BitcoinNetworkConnection();
        // Set the network based on the decoded identifier
        resolutionOptions.drivers.bitcoin.setActiveNetwork(didComponents.network);
      }

      // Parse the genesis document from the resolution options if provided
      const genesisDocument = resolutionOptions.sidecar?.genesisDocument;
      // Since genesisDocument is optional, check if it exists
      if(!genesisDocument) {
        // If no genesisDocument and x HRP, throw MISSING_UPDATE_DATA error
        if(didComponents.hrp === IdentifierHrp.x)
          throw new ResolveError(
            'External resolution requires genesisDocument',
            MISSING_UPDATE_DATA, { resolutionOptions }
          );
      }

      // Establish the current document
      const currentDocument = await Resolve.establishCurrentDocument(didComponents, genesisDocument);

      // Extract all Beacon services from the current DID Document
      const beaconServices = currentDocument.service
        .filter(BeaconUtils.isBeaconService)
        .map(BeaconUtils.parseBeaconServiceEndpoint);

      // Process the Beacon Signals to get the required updates
      const unsortedUpdates = await Resolve.processBeaconSignals(
        beaconServices,
        sidecarData,
        resolutionOptions.drivers.bitcoin,
        resolutionOptions.fullBlockchainTraversal
      );

      // If no updates found, return the current document
      if(!unsortedUpdates.length) {
        // Set the current document in the didResolutionResult
        didResolutionResult.didDocument = currentDocument;

        // Set the deactivated status in the didDocumentMetadata
        didResolutionResult.didDocumentMetadata.deactivated = !!currentDocument.deactivated;

        // Return the didResolutionResult early
        return didResolutionResult;
      }

      // Process the updates to apply updates to bring the current DID Document to its more current state
      const result = await Resolve.processUpdatesArray(
        currentDocument,
        unsortedUpdates,
        resolutionOptions.versionTime,
        resolutionOptions.versionId
      );

      // Set all of the required fields in the didResolutionResult
      didResolutionResult.didDocument = result.currentDocument;
      didResolutionResult.didDocumentMetadata.confirmations = result.confirmations;
      didResolutionResult.didDocumentMetadata.versionId = result.versionId;
      didResolutionResult.didDocumentMetadata.deactivated = !!result.currentDocument.deactivated;

      // Return didResolutionResult;
      return didResolutionResult;
    } catch (error: any) {
      console.error(error);
      // Rethrow any unexpected errors that are not a `ResolveError`.
      if (!(error instanceof ResolveError)) throw new Error(error);

      // Return a DID Resolution Result with the appropriate error code.
      return {
        ...EMPTY_DID_RESOLUTION_RESULT,
        didResolutionMetadata : {
          error : error.type,
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
   * Types SingletonBeacon, CASBeacon, and SMTBeacon.
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
  }): Promise<SidecarData> {
    // Deconstruct the params
    const {
      identifier,
      sourceDocument,
      sourceVersionId,
      patch,
      verificationMethodId: methodId,
      beaconIds,
    } = params;

    // 1. Set unsignedUpdate to the result of passing Identifier, sourceDocument,
    //    sourceVersionId, and documentPatch into the Construct DID Update
    //    Payload algorithm.
    const unsignedUpdate = await Update.construct({
      identifier,
      sourceDocument,
      sourceVersionId,
      patch,
    });

    // 2. Set verificationMethod to the result of retrieving the verificationMethod
    //    from sourceDocument using the verificationMethodId.
    const verificationMethod = this.getSigningMethod(sourceDocument, methodId);

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
    const signedUpdate = await Update.invoke({ identifier, verificationMethod, unsignedUpdate });

    // 5. Set signalsMetadata to the result of passing Identifier, sourceDocument, beaconIds and didUpdateInvocation
    //    to the Announce DID Update algorithm.
    const signalsMetadata = await Update.announce({ sourceDocument, beaconIds, signedUpdate });

    // 6. Return signalsMetadata. It is up to implementations to ensure that the signalsMetadata is persisted.
    return signalsMetadata;
    // TODO: Should we be applying the patch, producing a target did document and returning it?
  }

  /**
   * Given the W3C DID Document of a `did:btcr2` identifier, return the signing verification method that will be used
   * for signing messages and credentials. If given, the `methodId` parameter is used to select the
   * verification method. If not given, the Identity Key's verification method with an ID fragment
   * of '#initialKey' is used.
   * @param {DidDocument} didDocument The DID Document of the `did:btcr2` identifier.
   * @param {string} [methodId] Optional verification method ID to be used for signing.
   * @returns {DidVerificationMethod} Promise resolving to the {@link DidVerificationMethod} object used for signing.
   * @throws {DidError} if the parsed did method does not match `btcr2` or signing method could not be determined.
   */
  public static getSigningMethod(didDocument: DidDocument,  methodId?: string): DidVerificationMethod {
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