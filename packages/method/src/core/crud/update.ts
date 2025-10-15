import {
  BTCR2_DID_UPDATE_PAYLOAD_CONTEXT,
  MethodError,
  DidUpdateInvocation,
  DidUpdatePayload,
  INVALID_DID_DOCUMENT,
  INVALID_DID_UPDATE,
  INVALID_PUBLIC_KEY_TYPE,
  Logger,
  NOT_FOUND,
  PatchOperation,
  ProofOptions,
  KeyBytes
} from '@did-btcr2/common';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import type { DidService } from '@web5/dids';
import { BeaconService } from '../../interfaces/ibeacon.js';
import { SignalsMetadata } from '../../types/crud.js';
import { Appendix } from '../../utils/appendix.js';
import { DidDocument, DidVerificationMethod } from '../../utils/did-document.js';
import { BeaconFactory } from '../beacon/factory.js';
import { KeyManager } from '../key-manager/index.js';

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
  didUpdatePayload: DidUpdatePayload;
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
   * @returns {Promise<DidUpdatePayload>} The constructed DidUpdatePayload object.
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
  }): Promise<DidUpdatePayload> {

    // 1. Check that sourceDocument.id equals identifier else MUST raise invalidDIDUpdate error.
    if (sourceDocument.id !== identifier) {
      throw new MethodError(
        INVALID_DID_UPDATE,
        'Source document id does not match identifier',
        { sourceDocument, identifier}
      );
    }

    // 2. Initialize didUpdatePayload to an empty object.
    const didUpdatePayload: DidUpdatePayload = {
    // 3. Set didUpdatePayload.@context to the following list
      '@context'      : BTCR2_DID_UPDATE_PAYLOAD_CONTEXT,
      // 4. Set didUpdatePayload.patch to documentPatch.
      patch,
      targetHash      : '',
      targetVersionId : 0,
      sourceHash      : '',
    };
    // TODO: Need to add btcr2 context. ["https://w3id.org/zcap/v1", "https://w3id.org/security/data-integrity/v2", "https://w3id.org/json-ld-patch/v1"]

    // 5. Set targetDocument to the result of applying the documentPatch to the sourceDocument, following the JSON Patch
    //    specification.
    const targetDocument = JSON.patch.apply(sourceDocument, patch) as DidDocument;

    // 6. Validate targetDocument is a conformant DID document, else MUST raise invalidDIDUpdate error.
    DidDocument.validate(targetDocument);

    // 7. Set sourceHashBytes to the result of passing sourceDocument into the JSON Canonicalization and Hash algorithm.
    // 8. Set didUpdatePayload.sourceHash to the base58-btc Multibase encoding of sourceHashBytes.
    didUpdatePayload.sourceHash = (await JSON.canonicalization.process(sourceDocument, 'base58')).slice(1);
    // TODO: Question - is base58btc the correct encoding scheme?

    // 9. Set targetHashBytes to the result of passing targetDocument into the JSON Canonicalization and Hash algorithm.
    // 10. Set didUpdatePayload.targetHash to the base58-btc Multibase encoding of targetHashBytes.
    didUpdatePayload.targetHash = (await JSON.canonicalization.process(targetDocument, 'base58')).slice(1);

    // 11. Set didUpdatePayload.targetVersionId to sourceVersionId + 1.
    didUpdatePayload.targetVersionId = sourceVersionId + 1;

    // 12. Return updatePayload.
    return didUpdatePayload;
  }

  /**
   * {@link https://dcdpr.github.io/did-btcr2/#invoke-did-update-payload | 4.3.2 Invoke DID Update Payload}.
   *
   * The Invoke DID Update Payload algorithm takes in a Identifier, an unsigned didUpdatePayload, and a
   * verificationMethod. It retrieves the privateKeyBytes for the verificationMethod and adds a capability invocation in
   * the form of a Data Integrity proof following the Authorization Capabilities (ZCAP-LD) and VC Data Integrity
   * specifications. It returns the invoked DID Update Payload.
   *
   * @param {InvokePayloadParams} params Required params for calling the invokePayload method
   * @param {string} params.identifier The did-btcr2 identifier to derive the root capability from
   * @param {DidUpdatePayload} params.didUpdatePayload The updatePayload object to be signed
   * @param {DidVerificationMethod} params.verificationMethod The verificationMethod object to be used for signing
   * @returns {DidUpdateInvocation} Did update payload secured with a proof => DidUpdateInvocation
   * @throws {MethodError} if the privateKeyBytes are invalid
   */
  public static async invoke({
    identifier,
    didUpdatePayload,
    verificationMethod,
    secretKey
  }: {
    identifier: string;
    didUpdatePayload: DidUpdatePayload;
    verificationMethod: DidVerificationMethod;
    secretKey: KeyBytes;
  }): Promise<DidUpdateInvocation> {
    // Deconstruct the verificationMethod
    const { id: fullId, controller, publicKeyMultibase } = verificationMethod;

    // Validate the verificationMethod
    if(!publicKeyMultibase) {
      throw new MethodError(
        'Invalid publicKeyMultibase: cannot be undefined',
        INVALID_PUBLIC_KEY_TYPE, verificationMethod
      );
    }

    // 1. Set privateKeyBytes to the result of retrieving the private key bytes
    // associated with the verificationMethod value.
    const id = fullId.slice(fullId.indexOf('#'));
    const multikey = SchnorrMultikey.create({ id, controller, keys: new SchnorrKeyPair({ secretKey }) });

    // 1.3 If the privateKey is not found, throw an error
    if (!multikey) {
      throw new MethodError(
        'No privateKey found in kms or vm',
        NOT_FOUND, verificationMethod
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
    // TODO: Wonder if we actually need this. Arent we always writing?
    const options: ProofOptions = {
      cryptosuite,
      type               : 'DataIntegrityProof',
      verificationMethod : fullId,
      proofPurpose       : 'capabilityInvocation',
      capability         : rootCapability.id,
      capabilityAction   : 'Write',
    };

    // 10. Set cryptosuite to the result of executing the Cryptosuite Instantiation algorithm from the BIP340 Data
    //     Integrity specification passing in proofOptions.
    const diproof = multikey.toCryptosuite(cryptosuite).toDataIntegrityProof();

    // TODO: 11. need to set up the proof instantiation such that it can resolve / dereference the root capability. This is deterministic from the DID.

    // 12. Set didUpdateInvocation to the result of executing the Add Proof algorithm from VC Data Integrity passing
    //     didUpdatePayload as the input document, cryptosuite, and the set of proofOptions.
    // 13. Return didUpdateInvocation.
    return await diproof.addProof({ document: didUpdatePayload, options });
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#announce-did-update | 4.3.3 Announce DID Update}.
   *
   * The Announce DID Update algorithm retrieves beaconServices from the sourceDocument and calls the Broadcast DID
   * Update algorithm corresponding to the type of the Beacon. It takes in a Identifier, sourceDocument, an array of
   * beaconIds, and a didUpdateInvocation. It returns an array of signalsMetadata, containing the necessary
   * data to validate the Beacon Signal against the didUpdateInvocation.
   *
   * @param {AnnounceUpdatePayloadParams} params Required params for calling the announcePayload method
   * @param {DidDocument} params.sourceDocument The did-btcr2 did document to derive the root capability from
   * @param {string[]} params.beaconIds The didUpdatePayload object to be signed
   * @param {DidUpdateInvocation} params.didUpdatePayload The verificationMethod object to be used for signing
   * @returns {SignalsMetadata} The signalsMetadata object containing data to validate the Beacon Signal
   * @throws {MethodError} if the beaconService type is invalid
   */
  public static async announce({
    sourceDocument,
    beaconIds,
    didUpdateInvocation,
    secretKey
  }: {
    sourceDocument: DidDocument;
    beaconIds: string[];
    didUpdateInvocation: DidUpdateInvocation;
    secretKey: KeyBytes;
  }): Promise<SignalsMetadata> {
    // 1. Set beaconServices to an empty array.
    const beaconServices: BeaconService[] = [];

    // 2. signalMetadata to an empty array.
    let signalsMetadata;

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
      //    4.2.1 Set signalMetadata to the result of passing beaconService and didUpdateInvocation to the Broadcast
      //          Singleton Beacon Signal algorithm.
      // 4.3 Else If beaconService.type == CIDAggregateBeacon:
      //    4.3.1 Set signalMetadata to the result of passing Identifier, beaconService and didUpdateInvocation to
      //          the Broadcast CIDAggregate Beacon Signal algorithm.
      // 4.4 Else If beaconService.type == SMTAggregateBeacon:
      //    4.4.1 Set signalMetadata to the result of passing Identifier, beaconService and didUpdateInvocation to
      //          the Broadcast SMTAggregate Beacon Signal algorithm.
      // 4.5 Else:
      //    4.5.1 MUST throw invalidBeacon error.
      const beacon = BeaconFactory.establish(beaconService);
      signalsMetadata = await beacon.broadcastSignal(didUpdateInvocation, secretKey);
    }
    if(!signalsMetadata) {
      throw new MethodError(
        'Invalid beacon: no signalsMetadata found',
        INVALID_DID_DOCUMENT, { beaconServices }
      );
    }
    Logger.debug('signalsMetadata', signalsMetadata);
    // Return the signalsMetadata
    return signalsMetadata;
  }
}