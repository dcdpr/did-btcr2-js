import {
  INVALID_DID_DOCUMENT,
  INVALID_DID_UPDATE,
  INVALID_PUBLIC_KEY_TYPE,
  JSONPatch,
  MethodError,
  NOT_FOUND,
  PatchOperation,
  UpdateError
} from '@did-btcr2/common';
import { BTCR2SignedUpdate, BTCR2UnsignedUpdate, DataIntegrityConfig, SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { CompressedSecp256k1PublicKey, SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { Kms } from '@did-btcr2/kms';
import type { DidService } from '@web5/dids';
import { canonicalization } from '../did-btcr2.js';
import { Appendix } from '../utils/appendix.js';
import { DidDocument, DidVerificationMethod } from '../utils/did-document.js';
import { BeaconService } from './beacon/interfaces.js';
import { Identifier } from './identifier.js';
import { SidecarData } from './types.js';

export interface ConstructUpdateParams {
    identifier: string;
    sourceDocument: DidDocument;
    sourceVersionId: number;
    patch: PatchOperation[];
}

export interface UpdateParams extends ConstructUpdateParams {
    verificationMethodId: string;
    beaconIds: string[];
}

export type InvokePayloadParams = {
  identifier: string;
  BTCR2SignedUpdate: BTCR2SignedUpdate;
  verificationMethod: DidVerificationMethod;
}

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/#update | 4.3 Update}.
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
   * Implements {@link https://dcdpr.github.io/did-btcr2/#construct-did-update-payload | 4.3.1 Construct DID Update Payload}.
   *
   * The Construct DID Update Payload algorithm applies the documentPatch to the sourceDocument and verifies the
   * resulting targetDocument is a conformant DID document. It takes in a Identifier, sourceDocument,
   * sourceVersionId, and documentPatch objects. It returns an unsigned DID Update Payload.
   *
   * @param {ConstructPayloadParams} params See  {@link ConstructPayloadParams} for more details.
   * @param {string} params.identifier The did-btcr2 identifier to use for verification.
   * @param {DidDocument} params.sourceDocument The source document to be updated.
   * @param {string} params.sourceVersionId The versionId of the source document.
   * @param {DidDocumentPatch} params.patch The JSON patch to be applied to the source document.
   * @returns {Promise<BTCR2SignedUpdate>} The constructed BTCR2SignedUpdate object.
   * @throws {MethodError} InvalidDid if sourceDocument.id does not match identifier.
   */
  public static async construct({
    identifier,
    sourceDocument,
    sourceVersionId,
    patch,
  }: {
    identifier: string;
    sourceDocument: DidDocument;
    sourceVersionId: number;
    patch: PatchOperation[];
  }): Promise<BTCR2UnsignedUpdate> {

    // 1. Check that sourceDocument.id equals identifier else MUST raise invalidDIDUpdate error.
    if (sourceDocument.id !== identifier) {
      throw new UpdateError(
        'Identifier mismatch: sourceDocument.id !== identifier',
        INVALID_DID_UPDATE, { sourceDocument, identifier }
      );
    }

    // 2. Initialize an unsigned update.
    const unsignedUpdate: BTCR2UnsignedUpdate = {
    // 3. Set BTCR2SignedUpdate.@context to the following list
      '@context'      : [
        'https://w3id.org/security/v2',
        'https://w3id.org/zcap/v1',
        'https://w3id.org/json-ld-patch/v1',
        'https://btcr2.dev/context/v1'
      ],
      // 4. Set BTCR2SignedUpdate.patch to documentPatch.
      patch,
      targetHash      : '',
      targetVersionId : 0,
      sourceHash      : '',
    };

    // 5. Set targetDocument to the result of applying the documentPatch to the sourceDocument, following the JSON Patch
    //    specification.
    const targetDocument = JSONPatch.apply(sourceDocument, patch) as DidDocument;

    // 6. Validate targetDocument is a conformant DID document, else MUST raise invalidDIDUpdate error.
    DidDocument.validate(targetDocument);

    // 7. Set sourceHashBytes to the result of passing sourceDocument into the JSON Canonicalization and Hash algorithm.
    // 8. Set BTCR2SignedUpdate.sourceHash to the base58-btc Multibase encoding of sourceHashBytes.
    unsignedUpdate.sourceHash = (canonicalization.process(sourceDocument, { encoding: 'base58' })).slice(1);
    // TODO: Question - is base58btc the correct encoding scheme?

    // 9. Set targetHashBytes to the result of passing targetDocument into the JSON Canonicalization and Hash algorithm.
    // 10. Set BTCR2SignedUpdate.targetHash to the base58-btc Multibase encoding of targetHashBytes.
    unsignedUpdate.targetHash = (canonicalization.process(targetDocument, { encoding: 'base58' })).slice(1);

    // 11. Set BTCR2SignedUpdate.targetVersionId to sourceVersionId + 1.
    unsignedUpdate.targetVersionId = sourceVersionId + 1;

    // 12. Return updatePayload.
    return unsignedUpdate;
  }

  /**
   * {@link https://dcdpr.github.io/did-btcr2/#invoke-did-update-payload | 4.3.2 Invoke DID Update Payload}.
   *
   * The Invoke DID Update Payload algorithm takes in a Identifier, an unsigned BTCR2SignedUpdate, and a
   * verificationMethod. It retrieves the privateKeyBytes for the verificationMethod and adds a capability invocation in
   * the form of a Data Integrity proof following the Authorization Capabilities (ZCAP-LD) and VC Data Integrity
   * specifications. It returns the invoked DID Update Payload.
   *
   * @param {InvokePayloadParams} params Required params for calling the invokePayload method
   * @param {string} params.identifier The did-btcr2 identifier to derive the root capability from
   * @param {BTCR2SignedUpdate} params.BTCR2SignedUpdate The updatePayload object to be signed
   * @param {DidVerificationMethod} params.verificationMethod The verificationMethod object to be used for signing
   * @returns {BTCR2SignedUpdate} Did update payload secured with a proof => BTCR2SignedUpdate
   * @throws {MethodError} if the privateKeyBytes are invalid
   */
  public static async invoke({
    identifier,
    unsignedUpdate,
    verificationMethod
  }: {
    identifier: string;
    unsignedUpdate: BTCR2UnsignedUpdate;
    verificationMethod: DidVerificationMethod;
  }): Promise<BTCR2SignedUpdate> {
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
    const keys = secretKeyMultibase
      ? new SchnorrKeyPair({ secretKey: Secp256k1SecretKey.decode(secretKeyMultibase) })
      : Kms.getKey(keyUri as string);
    if (!keys) {
      throw new MethodError(
        'No privateKey found in kms or vm',
        NOT_FOUND, verificationMethod
      );
    }

    // 1.3 Set multikey to the result of passing verificationMethod and privateKeyBytes into the Multikey Creation algorithm.
    const multikey = SchnorrMultikey.create({ id, controller, keys });

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

    // 12. Set BTCR2SignedUpdate to the result of executing the Add Proof algorithm from VC Data Integrity passing
    //     BTCR2SignedUpdate as the input document, cryptosuite, and the set of proofOptions.
    // 13. Return BTCR2SignedUpdate.
    return await diproof.addProof(unsignedUpdate, config);
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#announce-did-update | 4.3.3 Announce DID Update}.
   *
   * The Announce DID Update algorithm retrieves beaconServices from the sourceDocument and calls the Broadcast DID
   * Update algorithm corresponding to the type of the Beacon. It takes in a Identifier, sourceDocument, an array of
   * beaconIds, and a BTCR2SignedUpdate. It returns an array of signalsMetadata, containing the necessary
   * data to validate the Beacon Signal against the BTCR2SignedUpdate.
   *
   * @param {AnnounceUpdatePayloadParams} params Required params for calling the announcePayload method
   * @param {DidDocument} params.sourceDocument The did-btcr2 did document to derive the root capability from
   * @param {string[]} params.beaconIds The BTCR2SignedUpdate object to be signed
   * @param {BTCR2SignedUpdate} params.BTCR2SignedUpdate The verificationMethod object to be used for signing
   * @returns {BTCR2SignedUpdate} The BTCR2SignedUpdate object containing data to validate the Beacon Signal
   * @throws {MethodError} if the beaconService type is invalid
   */
  public static async announce({
    sourceDocument,
    beaconIds,
    signedUpdate
  }: {
    sourceDocument: DidDocument;
    beaconIds: string[];
    signedUpdate: BTCR2SignedUpdate;
  }): Promise<SidecarData> {
    // 1. Set beaconServices to an empty array.
    const beaconServices: BeaconService[] = [];

    // 2. sidecarData to an empty array.
    let sidecarData: SidecarData | undefined;

    // 3. For beaconId in beaconIds:
    for (const beaconId of beaconIds) {
      //    3.1 Find the beacon services in the sourceDocument
      const beaconService = sourceDocument.service.find((s: DidService) => s.id === beaconId);

      //    3.2 If no beaconService MUST throw beaconNotFound error.
      if (!beaconService) {
        throw new MethodError('Not found: sourceDocument does not contain beaconId', INVALID_DID_DOCUMENT, { beaconId });
      }

      //    3.3 Push beaconService to beaconServices.
      beaconServices.push(beaconService);
    }

    // 4. For beaconService in beaconServices:
    for (const beaconService of beaconServices) {
      // 4.1 Set signalMetadata to null.
      // 4.2 If beaconService.type == SingletonBeacon:
      //    4.2.1 Set signalMetadata to the result of passing beaconService and BTCR2SignedUpdate to the Broadcast
      //          Singleton Beacon Signal algorithm.
      // 4.3 Else If beaconService.type == CASBeacon:
      //    4.3.1 Set signalMetadata to the result of passing Identifier, beaconService and BTCR2SignedUpdate to
      //          the Broadcast CIDAggregate Beacon Signal algorithm.
      // 4.4 Else If beaconService.type == SMTBeacon:
      //    4.4.1 Set signalMetadata to the result of passing Identifier, beaconService and BTCR2SignedUpdate to
      //          the Broadcast SMTAggregate Beacon Signal algorithm.
      // 4.5 Else:
      //    4.5.1 MUST throw invalidBeacon error.
      // const beacon = BeaconFactory.establish(beaconService);
      // sidecarData = await beacon.broadcastSignal(signedUpdate);
      console.log('TODO: refactor this code', signedUpdate, beaconService);
    }
    if(!sidecarData) {
      throw new MethodError(
        'Invalid beacon: no sidecarData found',
        INVALID_DID_DOCUMENT, { beaconServices }
      );
    }

    // Return the sidecarData
    return sidecarData;
  }
}