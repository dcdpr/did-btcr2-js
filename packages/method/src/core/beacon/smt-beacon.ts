import { BitcoinConnection } from '@did-btcr2/bitcoin';
import { decode, encode, KeyBytes } from '@did-btcr2/common';
import { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { blockHash, didToIndex, hexToHash, verifySerializedProof } from '@did-btcr2/smt';
import type { BeaconProcessResult, DataNeed } from '../resolver.js';
import { SidecarData } from '../types.js';
import { Beacon } from './beacon.js';
import { SMTBeaconError } from './error.js';
import { BeaconService, BeaconSignal, BlockMetadata } from './interfaces.js';

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/terminology.html#smt-beacon | SMT Beacon}.
 *
 * An SMT (Sparse Merkle Tree) Beacon aggregates updates for multiple DIDs
 * into a single Merkle root hash broadcast on-chain via OP_RETURN.
 * During resolution, the SMT Proof from the sidecar is verified against the
 * on-chain root, and the proof's updateId is used to retrieve the signed update.
 *
 * @class SMTBeacon
 * @type {SMTBeacon}
 * @extends {Beacon}
 */
export class SMTBeacon extends Beacon {
  /**
   * Creates an instance of SMTBeacon.
   * @param {BeaconService} service The Beacon service.
   */
  constructor(service: BeaconService) {
    super({ ...service, type: 'SMTBeacon' });
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-smt-beacon | 7.2.e.1 Process SMT Beacon}.
   *
   * For each signal, the signalBytes contain the hex-encoded SMT root hash.
   * This method looks up the SMT Proof from the sidecar by root hash,
   * validates the Merkle inclusion proof, and retrieves the corresponding
   * signed update using the proof's updateId.
   *
   * @param {Array<BeaconSignal>} signals The array of Beacon Signals to process.
   * @param {SidecarData} sidecar The sidecar data associated with the SMT Beacon.
   * @returns {BeaconProcessResult} Successfully resolved updates and any data needs.
   * @throws {SMTBeaconError} if proof verification fails or proof is malformed.
   */
  processSignals(
    signals: Array<BeaconSignal>,
    sidecar: SidecarData
  ): BeaconProcessResult {
    const updates = new Array<[SignedBTCR2Update, BlockMetadata]>();
    const needs = new Array<DataNeed>();

    // Extract the DID from the beacon service id (strip the #fragment)
    const did = this.service.id.split('#')[0];

    for(const signal of signals) {
      // Signal bytes are the hex-encoded SMT root hash; smtMap is keyed by proof.id (also hex)
      const smtProof = sidecar.smtMap.get(signal.signalBytes);

      if(!smtProof) {
        // SMT Proof not available — emit a need
        needs.push({
          kind            : 'NeedSMTProof',
          smtRootHash     : signal.signalBytes,
          beaconServiceId : this.service.id
        });
        continue;
      }

      // Non-inclusion proof — no update for this DID in this epoch, skip
      if(!smtProof.updateId) {
        continue;
      }

      // Nonce is required for proof verification
      if(!smtProof.nonce) {
        throw new SMTBeaconError(
          'SMT proof missing required nonce field.',
          'INVALID_SMT_PROOF', { smtProof, did }
        );
      }

      // Verify Merkle inclusion: leaf = hash(hash(nonce) || updateId)
      const index = didToIndex(did);
      const candidateHash = blockHash(blockHash(hexToHash(smtProof.nonce)), hexToHash(smtProof.updateId));
      const valid = verifySerializedProof(smtProof, index, candidateHash);

      if(!valid) {
        throw new SMTBeaconError(
          'SMT proof verification failed.',
          'INVALID_SMT_PROOF', { smtProof, did }
        );
      }

      // Convert updateId from hex to base64url for updateMap lookup
      const updateHash = encode(decode(smtProof.updateId, 'hex'));

      // Look up the signed update in sidecar updateMap
      const signedUpdate = sidecar.updateMap.get(updateHash);

      if(!signedUpdate) {
        // Signed update not available — emit a need
        needs.push({
          kind             : 'NeedSignedUpdate',
          updateHash,
          beaconServiceId  : this.service.id
        });
        continue;
      }

      updates.push([signedUpdate, signal.blockMetadata]);
    }

    return { updates, needs };
  }

  /**
   * Broadcast SMT Beacon signal to the Bitcoin network.
   * @param {SignedBTCR2Update} signedUpdate The signed BTCR2 update to broadcast.
   * @param {KeyBytes} secretKey The secret key for signing the Bitcoin transaction.
   * @param {BitcoinConnection} bitcoin The Bitcoin network connection.
   * @return {Promise<SignedBTCR2Update>} The signed update that was broadcasted.
   * @throws {SMTBeaconError} if broadcasting fails.
   */
  async broadcastSignal(
    signedUpdate: SignedBTCR2Update,
    secretKey: KeyBytes,
    bitcoin: BitcoinConnection
  ): Promise<SignedBTCR2Update> {
    throw new SMTBeaconError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, {signedUpdate, secretKey, bitcoin});
  }
}
