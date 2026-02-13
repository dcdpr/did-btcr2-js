import { BitcoinNetworkConnection } from '@did-btcr2/bitcoin';
import {
  Canonicalization,
  DocumentBytes,
  HexString,
  IdentifierHrp,
  INVALID_DID_DOCUMENT,
  KeyBytes,
  METHOD_NOT_SUPPORTED,
  MethodError,
  MISSING_UPDATE_DATA,
  PatchOperation,
  ResolveError,
  UpdateError
} from '@did-btcr2/common';
import { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
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
import { Update } from './core/update.js';
import { Appendix } from './utils/appendix.js';
import { DidDocument, DidVerificationMethod } from './utils/did-document.js';

// TODO: convert to API driver?
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

// TODO: convert to API driver?
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
  /**
   * Name of the DID method, as defined in the DID BTCR2 specification
   */
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
   * Entry point for section {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html | 7.2 Resolve}.
   * See specification for the {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#process | Resolve Process}.
   * See {@link Resolve | Resolve (class)} for class implementation.
   *
   * Resolving a did:btcr2 identifier iteratively builds a DID document by applying
   * BTCR2 Updates to an Initial DID Document that have been committed to the Bitcoin
   * blockchain by Authorized Beacon Signals. The Initial DID Document is either
   * deterministically created from the DID or provided by Sidecar Data.
   *
   * @param {string} did The did:btcr2 identifier to be resolved.
   * @param {ResolutionOptions} resolutionOptions Options used during the resolution process.
   * @returns {Promise<DidResolutionResult>} Promise resolving to a DID Resolution Result containing the `targetDocument`
   * @throws {ResolveError} If the resolution process fails at any step.
   * @example
   * ```ts
   * const resolution = await DidBtcr2.resolve(
   *  'did:btcr2:k1q0dygyp3gz969tp46dychzy4q78c2k3js68kvyr0shanzg67jnuez2cfplh'
   * )
   * ```
   */
  static async resolve(
    did: string,
    resolutionOptions: ResolutionOptions = {drivers: {}}
  ): Promise<DidResolutionResult> {
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
   * Entry point for section {@link https://dcdpr.github.io/did-btcr2/#read | 7.3 Update}.
   * See specification for the {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#process | Resolve Process}.
   * See {@link Update | Update (class)} for class implementation.
   *
   * BTCR2 DID documents can be updated by anchoring BTCR2 Updates to Bitcoin transactions. These transactions MAY be
   * published to the Bitcoin network. Any property in the DID document may be updated except the id. Doing so would
   * invalidate the DID document.
   *
   * @param {DidDocument} sourceDocument The DID document being updated.
   * @param {PatchOperation[]} patches The array of JSON Patch operations to apply to the sourceDocument.
   * @param {string} targetVersionId The target version ID after applying the update.
   * @param {string} verificationMethodId The verificationMethod ID to sign the update with.
   * @param {KeyBytes | HexString} [privateKey] Optional private key bytes or hex string to sign the update with.
   * @return {Promise<SignedBTCR2Update>} Promise resolving to the signed BTCR2 update.
   * @throws {UpdateError} if no verificationMethod, verificationMethod type is not `Multikey` or the publicKeyMultibase
   * header is not `zQ3s`
   */
  static async update(
    sourceDocument: DidDocument,
    patches: PatchOperation[],
    targetVersionId: number,
    verificationMethodId: string,
    privateKey?: KeyBytes | HexString,
  ): Promise<SignedBTCR2Update> {
    // Construct an unsigned update following the BTCR2 Update construction algorithm
    const unsignedUpdate = await Update.constructUnsigned(sourceDocument, patches, targetVersionId);

    // Get the verification method to be used for signing the update
    const verificationMethod = this.getSigningMethod(sourceDocument, verificationMethodId);

    // Validate the verificationMethod exists in the sourceDocument
    if (!verificationMethod) {
      throw new UpdateError(
        'Verification method not found in did document',
        INVALID_DID_DOCUMENT, sourceDocument
      );
    }

    // Validate the verificationMethod is of type 'Multikey'
    if (verificationMethod.type !== 'Multikey') {
      throw new UpdateError(
        'Invalid type: must be type "Multikey"',
        INVALID_DID_DOCUMENT, verificationMethod
      );
    }

    // Validate the publicKeyMultibase prefix is 'zQ3s'
    if (verificationMethod.publicKeyMultibase?.slice(0, 4) !== 'zQ3s') {
      throw new UpdateError(
        'Invalid prefix: publicKeyMultibase must start with "zQ3s"',
        INVALID_DID_DOCUMENT, verificationMethod
      );
    }

    // Sign the unsigned update using the specified verification method
    const signedUpdate = await Update.constructSigned(sourceDocument.id, unsignedUpdate, verificationMethod);

    // Announce the signed update to the blockchain using the specified beacon(s)
    await Update.announce(sourceDocument, ['beaconIds'], signedUpdate);

    // Return signedUpdate if announced successfully
    return signedUpdate;
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
  static getSigningMethod(didDocument: DidDocument,  methodId?: string): DidVerificationMethod {
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