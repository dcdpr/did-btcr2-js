import {
  INVALID_DID_UPDATE,
  JSONPatch,
  KeyBytes,
  PatchOperation,
  UpdateError
} from '@did-btcr2/common';
import {
  DataIntegrityConfig,
  SchnorrMultikey,
  SignedBTCR2Update,
  UnsignedBTCR2Update
} from '@did-btcr2/cryptosuite';
import { canonicalization } from '../did-btcr2.js';
import { Btcr2DidDocument, DidDocument, DidVerificationMethod } from '../utils/did-document.js';
import { BeaconFactory } from './beacon/factory.js';
import { BeaconService } from './beacon/interfaces.js';
import { BitcoinNetworkConnection } from '@did-btcr2/bitcoin';

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/operations/update.html | 7.3 Update}.
 *
 * An update to a did:btcr2 document is an invoked capability using the ZCAP-LD
 * data format, signed by a verificationMethod that has the authority to make
 * the update as specified in the previous DID document. Capability invocations
 * for updates MUST be authorized using Data Integrity following the
 * bip340-jcs-2025 cryptosuite with a proofPurpose of capabilityInvocation.
 *
 * @class Update
 * @type {Update}
 */
export class Update {
  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/update.html#construct-btcr2-unsigned-update | 7.3.b Construct BTCR2 Unsigned Update}.
   * This process constructs a BTCR2 Unsigned Update conformant to the spec template.
   *
   * @param {Btcr2DidDocument} sourceDocument The source DID document to be updated.
   * @param {PatchOperation[]} patches The array of JSON Patch operations to apply to the sourceDocument.
   * @param {number} sourceVersionId The version ID of the source document.
   * @returns {Promise<SignedBTCR2Update>} The constructed SignedBTCR2Update object.
   * @throws {UpdateError} InvalidDid if sourceDocument.id does not match identifier.
   */
  static async construct(
    sourceDocument: Btcr2DidDocument,
    patches: PatchOperation[],
    sourceVersionId: number,
  ): Promise<UnsignedBTCR2Update> {
    // Initialize an unsigned update conformant to btcr2 spec.
    const unsignedUpdate: UnsignedBTCR2Update = {
      '@context'      : [
        'https://w3id.org/security/v2',
        'https://w3id.org/zcap/v1',
        'https://w3id.org/json-ld-patch/v1',
        'https://btcr2.dev/context/v1'
      ],
      patch           : patches,
      targetHash      : '',
      targetVersionId : sourceVersionId + 1,
      sourceHash      : canonicalization.process(sourceDocument, { encoding: 'base58' }),
    };

    // Apply all JSON patches to sourceDocument.
    const targetDocument = JSONPatch.apply(sourceDocument, patches);

    try {
      // Ensure the targetDocument is conformant to DID Core v1.1.
      DidDocument.isValid(targetDocument);
    } catch (error) {
      // If validation fails, throw an UpdateError with INVALID_DID_UPDATE.
      throw new UpdateError(
        'Error validating targetDocument: ' + (error instanceof Error ? error.message : String(error)),
        INVALID_DID_UPDATE, targetDocument
      );
    }

    // Set the targetHash by canonicalizing the targetDocument and encoding it in base58.
    unsignedUpdate.targetHash = canonicalization.process(targetDocument, { encoding: 'base58' });

    // Return unsignedUpdate.
    return unsignedUpdate;
  }

  /**
   * Implements subsection {@link http://dcdpr.github.io/did-btcr2/operations/update.html#construct-btcr2-signed-update | 7.3.c Construct BTCR2 Signed Update }.
   * This process constructs a BTCR2 Signed Update from a BTCR2 Unsigned Update.
   *
   * @param {string} did The did-btcr2 identifier to derive the root capability from
   * @param {UnsignedBTCR2Update} unsignedUpdate The updatePayload object to be signed
   * @param {DidVerificationMethod} verificationMethod The verificationMethod object to be used for signing
   * @returns {SignedBTCR2Update} Did update payload secured with a proof => SignedBTCR2Update
   * @throws {UpdateError} if the privateKeyBytes are invalid
   */
  static async sign(
    did: string,
    unsignedUpdate: UnsignedBTCR2Update,
    verificationMethod: DidVerificationMethod,
    secretKey: KeyBytes,
  ): Promise<SignedBTCR2Update> {
    // Parse the controller from the verificationMethod
    const controller = verificationMethod.controller;
    // Parse the fragment from the vmId
    const id = verificationMethod.id.slice(verificationMethod.id.indexOf('#'));

    // Construct a Schnorr Multikey
    const multikey = SchnorrMultikey.fromSecretKey(id, controller, secretKey);

    // Define the Data Integrity proof config
    const config: DataIntegrityConfig = {
      '@context' : [
        'https://w3id.org/security/v2',
        'https://w3id.org/zcap/v1',
        'https://w3id.org/json-ld-patch/v1',
        'https://btcr2.dev/context/v1'
      ],
      cryptosuite        : 'bip340-jcs-2025',
      type               : 'DataIntegrityProof',
      verificationMethod : verificationMethod.id,
      proofPurpose       : 'capabilityInvocation',
      capability         : `urn:zcap:root:${encodeURIComponent(did)}`,
      capabilityAction   : 'Write',
    };

    // Go from multikey => cryptosuite => diproof
    const diproof = multikey.toCryptosuite().toDataIntegrityProof();

    // Use the config to add a proof to the unsigned update
    return diproof.addProof(unsignedUpdate, config);
  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/update.html#announce-did-update | 7.3.d Announce DID Update}.
   * BTCR2 Signed Updates are announced to the Bitcoin blockchain depending on the Beacon Type.
   * @param {BeaconService} beaconService The BeaconService object representing the funded beacon to announce the update to.
   * @param {SignedBTCR2Update} update The signed update object to be announced.
   * @param {KeyBytes} secretKey The private key used to sign the update for announcement.
   * @returns {SignedBTCR2Update} The SignedBTCR2Update object containing data to validate the Beacon Signal
   * @throws {UpdateError} if the beaconService type is invalid
   */
  static async announce(
    beaconService: BeaconService,
    update: SignedBTCR2Update,
    secretKey: KeyBytes,
    bitcoin: BitcoinNetworkConnection
  ): Promise<SignedBTCR2Update> {
    // Establish a beacon object
    const beacon = BeaconFactory.establish(beaconService);

    // Broadcast the update
    const result = await beacon.broadcastSignal(update, secretKey, bitcoin);

    // Return the sidecarData
    return result;
  }
}