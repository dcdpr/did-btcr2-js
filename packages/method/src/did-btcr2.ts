import type {
  DocumentBytes,
  KeyBytes,
  PatchOperation} from '@did-btcr2/std';
import {
  IdentifierHrp,
  INVALID_DID_UPDATE,
  UpdateError
} from '@did-btcr2/std';
import type {
  DidMethod} from '@web5/dids';
import type { BeaconService } from './core/beacon/interfaces.js';
import { BeaconUtils } from './core/beacon/utils.js';
import { DEACTIVATION_PATCH } from './core/btcr2-update.js';
import { Identifier } from './core/identifier.js';
import type { ResolutionOptions } from './core/interfaces.js';
import { checkResolutionOptions } from './core/resolution-options.js';
import { Resolver } from './core/resolver.js';
import { Updater } from './core/updater.js';
import { Appendix } from './utils/appendix.js';
import type { Btcr2DidDocument, DidVerificationMethod } from './utils/did-document.js';
import { messageText } from './utils/message-text.js';

export interface DidCreateOptions {
  /** Type of identifier to create (key or external) */
  idType: string;
  /** DID BTCR2 Version Number */
  version?: number;
  /** Bitcoin Network */
  network?: string;
}

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
   * Implements section {@link https://dcdpr.github.io/did-btcr2/operations/create.html | Create}.
   * @param {KeyBytes | DocumentBytes} genesisBytes The bytes used to create the genesis document for a did:btcr2 identifier.
   * For KEY, the bytes are a 33-byte compressed secp256k1 public key. For EXTERNAL, the bytes are the 32-byte hash of the genesis document.
   * @param {DidCreateOptions} options Options for creating the identifier, including the idType (key or external), version, and network.
   * @param {string} options.idType The type of identifier to create, either 'KEY' or 'EXTERNAL'. Required.
   * @param {number} options.version The version number of the did:btcr2 specification to use for creating the identifier. Defaults to 1.
   * @param {string} options.network The Bitcoin network to use for the identifier: 'bitcoin', 'signet', 'regtest',
   * 'testnet3', 'testnet4', or 'mutinynet'. Defaults to 'bitcoin'.
   * @returns {string} The new did:btcr2 identifier.
   * @throws {IdentifierError} `INVALID_DID` for each input fault. See {@link Identifier.encode}.
   * @example
   * ```ts
   * const genesisBytes = SchnorrKeyPair.generate().publicKey.compressed;
   * const did = DidBtcr2.create(genesisBytes, { idType: 'KEY', network: 'regtest' });
   * ```
   */
  static create(genesisBytes: KeyBytes | DocumentBytes, options: DidCreateOptions): string {
    // Create applies only the identifier encoding algorithm. Identifier.encode checks each input and sets
    // the defaults of version and network.
    return Identifier.encode(genesisBytes, options);
  }

  /**
   * Entry point for section {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html | Resolve}.
   *
   * Factory method that performs pure setup and returns a {@link Resolver} state machine.
   * The caller drives resolution by calling `resolver.resolve()` and `resolver.provide()`.
   * Analogous to Rust's `Document::read()`.
   *
   * @param {string} did The did:btcr2 identifier to be resolved.
   * @param {ResolutionOptions} resolutionOptions Options used during the resolution process.
   * @returns {Resolver} A sans-I/O state machine the caller drives to completion.
   * @throws {IdentifierError} `INVALID_DID` if the DID is not a valid did:btcr2 identifier, or
   * `METHOD_NOT_SUPPORTED` if the DID is valid and names another method.
   * @throws {ResolveError} `FEATURE_NOT_SUPPORTED` for an option that the resolver does not
   * support, or `INVALID_OPTIONS` for an option value that is not valid. The method throws
   * before it returns the {@link Resolver}, so the caller does no I/O for a refused request.
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
    // DID Resolution v1, section 4.4, steps 1 and 2: decode the DID. The DID syntax comes first,
    // then the method.
    const didComponents = Identifier.decode(did);

    // Steps 3 and 4: refuse an option that the resolver does not support, then an option value
    // that is not valid. The Resolver constructor checks versionId, versionTime, and minConf.
    checkResolutionOptions(resolutionOptions);

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
      versionId          : resolutionOptions.versionId,
      versionTime        : resolutionOptions.versionTime,
      genesisDocument    : resolutionOptions.sidecar?.genesisDocument,
      maxDiscoveryRounds : resolutionOptions.maxDiscoveryRounds,
      minConf            : resolutionOptions.minConf,
      expandRelativeUrls : resolutionOptions.expandRelativeUrls
    });
  }

  /**
   * Entry point for section {@link https://dcdpr.github.io/did-btcr2/operations/update.html | Update}.
   *
   * Factory method that validates the update parameters and returns a sans-I/O
   * {@link Updater} state machine. The caller drives the updater through its
   * phases (Construct -> Sign -> Fund -> Broadcast -> Complete) by calling `advance()` and
   * `provide()`. The method package performs **zero I/O**: signing key retrieval
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
   * @throws {UpdateError} `INVALID_DID_UPDATE` if one of these conditions is true:
   *   - `sourceVersionId` is not an integer of at least 1.
   *   - `sourceDocument` or `verificationMethodId` fails a condition of
   *     {@link Updater.signingMethod}.
   *   - The beacon service is not found.
   *   - The service of `beaconId` is not a beacon service: its type is not in Beacons Table 1,
   *     or its `serviceEndpoint` gives no Bitcoin address.
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
    // The version of the source document is a positive integer: versionId starts at 1, and
    // targetVersionId is sourceVersionId + 1. Without the guard, Number(undefined) + 1 is
    // NaN, and the update carries no usable version.
    if(!Number.isInteger(sourceVersionId) || sourceVersionId < 1) {
      const text = messageText(sourceVersionId);
      throw new UpdateError(
        'Invalid sourceVersionId: expected an integer of at least 1' + (text === undefined ? '.' : `, got ${text}.`),
        INVALID_DID_UPDATE, { sourceVersionId }
      );
    }

    // Spec "Construct BTCR2 Signed Update": the lookup through capabilityInvocation and the
    // checks of the method that signs, after a check of the shape of sourceDocument.
    // Updater.sign runs them again; this call fails before Construct. The read path applies
    // the same lookup and checks to the proof of an update, so an update that this factory
    // authorizes is one that the resolver also accepts.
    Updater.signingMethod(sourceDocument, verificationMethodId);

    // Find the beacon service matching the given beaconId. A service `id` may be a relative
    // DID URL, so both sides are resolved against the document before comparison; an
    // unusable beaconId matches nothing rather than matching an unusable service id.
    const targetBeaconId = Appendix.absoluteDidUrl(beaconId, sourceDocument.id);
    // The service member is optional: a document without it has no beacon service.
    const services: unknown = sourceDocument.service;
    const beaconService = (Array.isArray(services) ? services : [])
      .filter((service: BeaconService) =>
        targetBeaconId !== undefined
        && Appendix.absoluteDidUrl(service.id, sourceDocument.id) === targetBeaconId)
      .filter((service: BeaconService): service is BeaconService => !!service)
      .shift();

    if(!beaconService) {
      throw new UpdateError(
        'No beacon service found for provided beaconId',
        INVALID_DID_UPDATE, { sourceDocument, beaconId }
      );
    }

    // Spec "Update": a BTCR2 Beacon of the DID document announces the update. A service that
    // is not a beacon, or a beacon that gives no Beacon Address, cannot announce it.
    // The check runs before Construct, so a caller does not publish the update before it fails.
    if(!BeaconUtils.isBeaconService(beaconService)) {
      throw new UpdateError(
        `The service ${beaconId} is not a beacon service: its type is not in Beacons Table 1, `
        + 'or its serviceEndpoint gives no Bitcoin address.',
        INVALID_DID_UPDATE, { sourceDocument, beaconId }
      );
    }

    // Return a sans-I/O state machine the caller will drive.
    return new Updater({
      sourceDocument,
      patches,
      sourceVersionId,
      verificationMethodId,
      beaconService,
    });
  }

  /**
   * Entry point for section {@link https://dcdpr.github.io/did-btcr2/operations/deactivate.html | Deactivate}.
   *
   * Deactivate is the Update operation with the predetermined patch {@link DEACTIVATION_PATCH}:
   * it adds the `deactivated` property with the value `true`. The factory returns the
   * {@link Updater} that {@link DidBtcr2.update} returns for that patch, and the caller drives
   * it in the same way. Resolution stops at the deactivation for good. The factory does not
   * refuse a source document that is deactivated already; the api does (ADR 100).
   *
   * @param params Deactivation parameters: the parameters of {@link DidBtcr2.update} without `patches`.
   * @returns {Updater} A sans-I/O state machine for driving the deactivation.
   * @throws {UpdateError} As {@link DidBtcr2.update}.
   */
  static deactivate({
    sourceDocument,
    sourceVersionId,
    verificationMethodId,
    beaconId,
  }: {
    sourceDocument: Btcr2DidDocument;
    sourceVersionId: number;
    verificationMethodId: string;
    beaconId: string;
  }): Updater {
    return this.update({
      sourceDocument,
      patches : [{ ...DEACTIVATION_PATCH }],
      sourceVersionId,
      verificationMethodId,
      beaconId,
    });
  }

  /**
   * Returns the verification method that can sign an update of `didDocument`. This function
   * applies the rules of {@link Updater.signingMethod}:
   *
   * 1. An entry of `capabilityInvocation` must identify the method, in the reference form or
   *    the embedded form.
   * 2. The method must have the type `Multikey` and the DID as its controller.
   * 3. The method must have a secp256k1 public key in the BIP340 Multikey encoding.
   *
   * @param {Btcr2DidDocument} didDocument The DID document of the `did:btcr2` identifier.
   * @param {string} [methodId] The id of the method, absolute or relative. The default is
   *   `#initialKey`.
   * @returns {DidVerificationMethod} The verification method that can sign an update.
   * @throws {UpdateError} `INVALID_DID_UPDATE` if `didDocument` or the method fails a condition
   *   of {@link Updater.signingMethod}.
   */
  static getSigningMethod(didDocument: Btcr2DidDocument, methodId?: string): DidVerificationMethod {
    return Updater.signingMethod(didDocument, methodId ?? '#initialKey');
  }
}