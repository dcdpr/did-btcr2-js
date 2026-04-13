import type {
  DocumentBytes,
  KeyBytes,
  PatchOperation} from '@did-btcr2/common';
import {
  IdentifierHrp,
  INVALID_DID_DOCUMENT,
  INVALID_DID_UPDATE,
  METHOD_NOT_SUPPORTED,
  MethodError,
  UpdateError
} from '@did-btcr2/common';
import type {
  DidMethod} from '@web5/dids';
import {
  Did,
  DidError,
  DidErrorCode
} from '@web5/dids';
import * as ecc from '@bitcoinerlab/secp256k1';
import { initEccLib } from 'bitcoinjs-lib';
import type { BeaconService } from './core/beacon/interfaces.js';
import { Identifier } from './core/identifier.js';
import type { ResolutionOptions } from './core/interfaces.js';
import { Resolver } from './core/resolver.js';
import { Updater } from './core/updater.js';
import { Appendix } from './utils/appendix.js';
import type { Btcr2DidDocument, DidVerificationMethod } from './utils/did-document.js';

export interface DidCreateOptions {
  /** Type of identifier to create (key or external) */
  idType: string;
  /** DID BTCR2 Version Number */
  version?: number;
  /** Bitcoin Network */
  network?: string;
}

/** Initialize secp256k1 ECC library */
initEccLib(ecc);

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
   * @returns {Promise<string>} Promise resolving to an identifier string.
   * @throws {MethodError} if any of the checks fail
   * @example
   * ```ts
   * const genesisBytes = SchnorrKeyPair.generate().publicKey.compressed;
   * const did = DidBtcr2.create(genesisBytes, { idType: 'KEY', network: 'regtest' });
   * ```
   */
  static create(genesisBytes: KeyBytes | DocumentBytes, options?: DidCreateOptions): string {
    // Deconstruct the idType, version and network from the options, setting defaults if not given
    const { idType, version = 1, network = 'bitcoin' } = options || {};

    if(!idType) {
      throw new MethodError(
        'idType is required for creating a did:btcr2 identifier',
        INVALID_DID_DOCUMENT, options
      );
    }

    // Call identifier encoding algorithm
    return Identifier.encode(genesisBytes, { idType, version, network });
  }

  /**
   * Entry point for section {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html | 7.2 Resolve}.
   *
   * Factory method that performs pure setup and returns a {@link Resolver} state machine.
   * The caller drives resolution by calling `resolver.resolve()` and `resolver.provide()`.
   * Analogous to Rust's `Document::read()`.
   *
   * @param {string} did The did:btcr2 identifier to be resolved.
   * @param {ResolutionOptions} resolutionOptions Options used during the resolution process.
   * @returns {Resolver} A sans-I/O state machine the caller drives to completion.
   * @example
   * ```ts
   * const resolver = DidBtcr2.resolve(did, { sidecar });
   * let state = resolver.resolve();
   * while (state.status === 'action-required') {
   *   for (const need of state.needs) { ... provide data ... }
   *   state = resolver.resolve();
   * }
   * const { didDocument, metadata } = state.result;
   * ```
   */
  static resolve(
    did: string,
    resolutionOptions: ResolutionOptions = {}
  ): Resolver {
    // Decode the did to be resolved
    const didComponents = Identifier.decode(did);

    // Process sidecar if provided
    const sidecarData = Resolver.sidecarData(resolutionOptions.sidecar);

    // Establish the current document for KEY identifiers (pure, synchronous).
    // For EXTERNAL identifiers, defer to the Resolver's GenesisDocument phase
    // since validation (Resolve.external) is async.
    const currentDocument = didComponents.hrp === IdentifierHrp.k
      ? Resolver.deterministic(didComponents)
      : null;

    // Return the sans-I/O state machine
    return new Resolver(didComponents, sidecarData, currentDocument, {
      versionId       : resolutionOptions.versionId,
      versionTime     : resolutionOptions.versionTime,
      genesisDocument : resolutionOptions.sidecar?.genesisDocument
    });
  }

  /**
   * Entry point for section {@link https://dcdpr.github.io/did-btcr2/#update | 7.3 Update}.
   *
   * Factory method that validates the update parameters and returns a sans-I/O
   * {@link Updater} state machine. The caller drives the updater through its
   * phases (Construct → Sign → Broadcast → Complete) by calling `advance()` and
   * `provide()`. The method package performs **zero I/O** — signing key retrieval
   * (or KMS delegation) and the on-chain broadcast are the caller's responsibility.
   *
   * For a fully-wired version with Bitcoin broadcast and key handling, see
   * `DidMethodApi.update()` in `@did-btcr2/api`.
   *
   * @param params Update construction parameters.
   * @param {Btcr2DidDocument} params.sourceDocument The DID document being updated.
   * @param {PatchOperation[]} params.patches The JSON Patch operations to apply.
   * @param {number} params.sourceVersionId The version ID before applying the update.
   * @param {string} params.verificationMethodId The verification method ID to sign with.
   * @param {string} params.beaconId The beacon service ID to broadcast through.
   * @returns {Updater} A sans-I/O state machine for driving the update.
   * @throws {UpdateError} If the verification method is not authorized, not found,
   *   not of type `Multikey`, or does not have a `zQ3s` publicKeyMultibase prefix.
   *   Also throws if the beacon service is not found.
   */
  static update({
    sourceDocument,
    patches,
    sourceVersionId,
    verificationMethodId,
    beaconId,
  }: {
    sourceDocument: Btcr2DidDocument;
    patches: PatchOperation[];
    sourceVersionId: number;
    verificationMethodId: string;
    beaconId: string;
  }): Updater {
    // Validate that the verificationMethodId is authorized for capabilityInvocation
    if(!sourceDocument.capabilityInvocation?.some(vr => vr === verificationMethodId)) {
      throw new UpdateError(
        'Invalid verificationMethodId: not authorized for capabilityInvocation',
        INVALID_DID_DOCUMENT, sourceDocument
      );
    }

    // Get the verification method to be used for signing the update
    const verificationMethod = this.getSigningMethod(sourceDocument, verificationMethodId);

    // Validate the verificationMethod exists in the sourceDocument
    if(!verificationMethod) {
      throw new UpdateError(
        'Invalid verificationMethod: not found in source document',
        INVALID_DID_DOCUMENT, { sourceDocument, verificationMethodId }
      );
    }

    // Validate the verificationMethod is of type 'Multikey'
    if(verificationMethod.type !== 'Multikey') {
      throw new UpdateError(
        'Invalid verificationMethod: verificationMethod.type must be "Multikey"',
        INVALID_DID_DOCUMENT, verificationMethod
      );
    }

    // Validate the publicKeyMultibase prefix is 'zQ3s'
    if(verificationMethod.publicKeyMultibase?.slice(0, 4) !== 'zQ3s') {
      throw new UpdateError(
        'Invalid verificationMethodId: publicKeyMultibase prefix must start with "zQ3s"',
        INVALID_DID_DOCUMENT, verificationMethod
      );
    }

    // Find the beacon service matching the given beaconId
    const beaconService = sourceDocument.service
      .filter((service: BeaconService) => service.id === beaconId)
      .filter((service: BeaconService): service is BeaconService => !!service)
      .shift();

    if(!beaconService) {
      throw new UpdateError(
        'No beacon service found for provided beaconId',
        INVALID_DID_UPDATE, { sourceDocument, beaconId }
      );
    }

    // Return a sans-I/O state machine the caller will drive
    return new Updater({
      sourceDocument,
      patches,
      sourceVersionId,
      verificationMethod,
      beaconService,
    });
  }

  /**
   * Given the W3C DID Document of a `did:btcr2` identifier, return the signing verification method that will be used
   * for signing messages and credentials. If given, the `methodId` parameter is used to select the
   * verification method. If not given, the Identity Key's verification method with an ID fragment
   * of '#initialKey' is used.
   * @param {Btcr2DidDocument} didDocument The DID Document of the `did:btcr2` identifier.
   * @param {string} [methodId] Optional verification method ID to be used for signing.
   * @returns {DidVerificationMethod} Promise resolving to the {@link DidVerificationMethod} object used for signing.
   * @throws {DidError} if the parsed did method does not match `btcr2` or signing method could not be determined.
   */
  static getSigningMethod(didDocument: Btcr2DidDocument,  methodId?: string): DidVerificationMethod {
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