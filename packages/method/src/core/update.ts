import {
  INVALID_DID_UPDATE,
  INVALID_PUBLIC_KEY_TYPE,
  JSONPatch,
  MethodError,
  NOT_FOUND,
  PatchOperation,
  UpdateError
} from '@did-btcr2/common';
import { DataIntegrityConfig, SchnorrMultikey, SignedBTCR2Update, UnsignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { CompressedSecp256k1PublicKey, SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { Kms } from '@did-btcr2/kms';
import { canonicalization } from '../did-btcr2.js';
import { Appendix } from '../utils/appendix.js';
import { DidDocument, DidVerificationMethod } from '../utils/did-document.js';
import { BeaconFactory } from './beacon/factory.js';
import { BeaconService } from './beacon/interfaces.js';
import { Identifier } from './identifier.js';

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
   *
   * This process constructs a BTCR2 Unsigned Update (data structure).
   * Apply all JSON patches in jsonPatches to didSourceDocument to create didTargetDocument.
   * didTargetDocument MUST be conformant to DID Core v1.1 [DID-CORE]. An INVALID_DID_UPDATE error
   * MUST be raised if didTargetDocument.id is not equal to didSourceDocument.id.
   *
   * Construct BTCR2 Unsigned Update conformant to the spec template and return it.
   *
   * @param {DidDocument} sourceDocument The source DID document to be updated.
   * @param {PatchOperation[]} patches The array of JSON Patch operations to apply to the sourceDocument.
   * @param {number} sourceVersionId The version ID of the source document.
   * @returns {Promise<SignedBTCR2Update>} The constructed SignedBTCR2Update object.
   * @throws {MethodError} InvalidDid if sourceDocument.id does not match identifier.
   */
  public static async constructUnsigned(
    sourceDocument: DidDocument,
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
   * {@link https://dcdpr.github.io/did-btcr2/#invoke-did-update-payload | 4.3.2 Invoke DID Update Payload}.
   *
   * The Invoke DID Update Payload algorithm takes in a Identifier, an unsigned SignedBTCR2Update, and a
   * verificationMethod. It retrieves the privateKeyBytes for the verificationMethod and adds a capability invocation in
   * the form of a Data Integrity proof following the Authorization Capabilities (ZCAP-LD) and VC Data Integrity
   * specifications. It returns the invoked DID Update Payload.
   *
   * @param {string} identifier The did-btcr2 identifier to derive the root capability from
   * @param {UnsignedBTCR2Update} unsignedUpdate The updatePayload object to be signed
   * @param {DidVerificationMethod} verificationMethod The verificationMethod object to be used for signing
   * @returns {SignedBTCR2Update} Did update payload secured with a proof => SignedBTCR2Update
   * @throws {MethodError} if the privateKeyBytes are invalid
   */
  public static async constructSigned(
    identifier: string,
    unsignedUpdate: UnsignedBTCR2Update,
    verificationMethod: DidVerificationMethod,
  ): Promise<SignedBTCR2Update> {
    // Deconstruct the verificationMethod
    const { id: fullId, controller, publicKeyMultibase, secretKeyMultibase } = verificationMethod;

    // Validate the verificationMethod
    if(!publicKeyMultibase) {
      throw new MethodError(
        'Invalid publicKeyMultibase: cannot be undefined',
        INVALID_PUBLIC_KEY_TYPE, verificationMethod
      );
    }

    // 1. Set privateKeyBytes to the result of retrieving the private key bytes
    // associated with the verificationMethod value.
    // 1.1 Let id be the fragment portion of verificationMethod.id.
    const id = fullId.slice(fullId.indexOf('#'));

    // 1.2 Retrieve the key pair from the KMS or from the secretKeyMultibase
    const components = Identifier.decode(id);
    const keyUri = new CompressedSecp256k1PublicKey(components.genesisBytes).hex;
    const secretKey = secretKeyMultibase ? Secp256k1SecretKey.decode(secretKeyMultibase) : undefined;
    const keyPair = secretKey
      ? new SchnorrKeyPair({ secretKey })
      : Kms.getKey(keyUri);

    if (!keyPair) {
      throw new MethodError(
        'No privateKey found in kms or vm',
        NOT_FOUND, verificationMethod
      );
    }

    // 1.3 Set multikey to the result of passing verificationMethod and privateKeyBytes into the Multikey Creation algorithm.
    const multikey = SchnorrMultikey.create({ id, controller, keyPair });

    // 1.4 If the privateKey is not found, throw an error
    if (!multikey) {
      throw new MethodError(
        'Failed to create multikey from verification method',
        'MULTKEY_CREATE_FAILED', verificationMethod
      );
    }

    // 2. Set rootCapability to the result of passing Identifier into the Derive Root Capability from did:btcr2
    //    Identifier algorithm.
    const rootCapability = Appendix.deriveRootCapability(identifier);
    const cryptosuite = 'bip340-jcs-2025';
    // 3. Initialize proofOptions to an empty object.
    // 4. Set proofOptions.type to DataIntegrityProof.
    // 5. Set proofOptions.cryptosuite to schnorr-secp256k1-jcs-2025.
    // 6. Set proofOptions.verificationMethod to verificationMethod.id.
    // 7. Set proofOptions.proofPurpose to capabilityInvocation.
    // 8. Set proofOptions.capability to rootCapability.id.
    // 9. Set proofOptions.capabilityAction to Write.
    const config: DataIntegrityConfig = {
      '@context' : [
        'https://w3id.org/security/v2',
        'https://w3id.org/zcap/v1',
        'https://w3id.org/json-ld-patch/v1',
        'https://btcr2.dev/context/v1'
      ],
      cryptosuite,
      type               : 'DataIntegrityProof',
      verificationMethod : fullId,
      proofPurpose       : 'capabilityInvocation',
      capability         : rootCapability.id,
      capabilityAction   : 'Write',
    };

    // 10. Set cryptosuite to the result of executing the Cryptosuite Instantiation algorithm from the BIP340 Data
    //     Integrity specification passing in proofOptions.
    const diproof = multikey.toCryptosuite().toDataIntegrityProof();

    // 12. Set SignedBTCR2Update to the result of executing the Add Proof algorithm from VC Data Integrity passing
    //     SignedBTCR2Update as the input document, cryptosuite, and the set of proofOptions.
    // 13. Return SignedBTCR2Update.
    return diproof.addProof(unsignedUpdate, config);
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#announce-did-update | 4.3.3 Announce DID Update}.
   *
   * The Announce DID Update algorithm retrieves beaconServices from the sourceDocument and calls the Broadcast DID
   * Update algorithm corresponding to the type of the Beacon. It takes in a Identifier, sourceDocument, an array of
   * beaconIds, and a SignedBTCR2Update. It returns an array of signalsMetadata, containing the necessary
   * data to validate the Beacon Signal against the SignedBTCR2Update.
   *
   * @param {AnnounceUpdatePayloadParams} params Required params for calling the announcePayload method
   * @param {DidDocument} params.sourceDocument The did-btcr2 did document to derive the root capability from
   * @param {string[]} params.beaconIds The SignedBTCR2Update object to be signed
   * @param {SignedBTCR2Update} params.SignedBTCR2Update The verificationMethod object to be used for signing
   * @returns {SignedBTCR2Update} The SignedBTCR2Update object containing data to validate the Beacon Signal
   * @throws {MethodError} if the beaconService type is invalid
   */
  public static async announce(
    sourceDocument: DidDocument,
    beaconIds: string[],
    signedUpdate: SignedBTCR2Update,
  ): Promise<SignedBTCR2Update> {
    // Filter sourceDocument services to get beaconServices matching beaconIds
    const beaconServices = beaconIds.map(
      (beaconId) => sourceDocument.service.find((s: BeaconService) => s.id === beaconId)
    );

    const results = [];

    // Iterate over each beacon service and its signals
    for(const beaconService of beaconServices) {
      // Establish a beacon object
      const beacon = BeaconFactory.establish(beaconService);
      // Process its signals
      const result = await beacon.broadcastSignal(signedUpdate);
      // Append the processed updates to the updates array
      results.push(...result);
    }

    // Return the sidecarData
    return signedUpdate;
  }
}