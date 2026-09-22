import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import { canonicalHashBytes, INVALID_SIGNAL_DATA } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '../btcr2-update.js';
import type { Signer } from '@did-btcr2/keypair';
import { base64UrlToHash, BTCR2MerkleTree, hashToHex, verifyProof } from '@did-btcr2/smt';
import { randomBytes } from '@noble/hashes/utils';
import type { BeaconProcessResult, DataNeed } from '../resolver.js';
import type { SMTProof } from '../interfaces.js';
import type { SidecarData } from '../types.js';
import type { BroadcastOptions, BroadcastResult } from './beacon.js';
import { SinglePartyBeacon } from './beacon.js';
import { SMTBeaconError } from './error.js';
import type { BeaconService, BeaconSignal, BlockMetadata } from './interfaces.js';

/** The hex of the base64url `id` of a proof, or `undefined` if the id does not decode to 32 bytes. */
function proofIdHex(proof: SMTProof): string | undefined {
  try {
    return hashToHex(base64UrlToHash(proof.id));
  } catch {
    return undefined;
  }
}

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
 * @extends {SinglePartyBeacon}
 */
export class SMTBeacon extends SinglePartyBeacon {
  /**
   * Creates an instance of SMTBeacon.
   * @param {BeaconService} service The Beacon service.
   * @param {string} did The absolute did:btcr2 identifier this beacon serves.
   */
  constructor(service: BeaconService, did: string) {
    super({ ...service, type: 'SMTBeacon' }, did);
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-smt-beacon | 7.2.e.1 Process SMT Beacon}.
   *
   * For each signal, the signalBytes contain the hex-encoded SMT root hash
   * (`smt_root`). This method looks up the SMT Proof from the sidecar by root
   * hash, checks that the id of the proof is the root, verifies the proof with
   * the SMT Proof Verification algorithm, and retrieves the signed update by the
   * proof's updateId. A proof with no updateId announces no update for the DID.
   *
   * @param {Array<BeaconSignal>} signals The array of Beacon Signals to process.
   * @param {SidecarData} sidecar The sidecar data associated with the SMT Beacon.
   * @returns {BeaconProcessResult} Successfully resolved updates and any data needs.
   * @throws {SMTBeaconError} `INVALID_SIGNAL_DATA` if the id of the proof is not the
   *   signal root, or if the proof does not verify.
   */
  processSignals(
    signals: Array<BeaconSignal>,
    sidecar: SidecarData
  ): BeaconProcessResult {
    const updates = new Array<[SignedBTCR2Update, BlockMetadata]>();
    const needs = new Array<DataNeed>();

    // The DID under resolution keys this beacon's leaf index.
    const did = this.did;

    for(const signal of signals) {
      // "Process SMT Beacon": the signal bytes are smt_root, the hex SMT root hash.
      // The smtMap is keyed by the hex of proof.id. No entry = a need for the proof.
      const smtProof = sidecar.smtMap.get(signal.signalBytes);

      if(!smtProof) {
        // SMT Proof not available, emit a need
        needs.push({
          kind            : 'NeedSMTProof',
          smtRootHash     : signal.signalBytes,
          beaconServiceId : this.service.id
        });
        continue;
      }

      // The id of the proof must equal smt_root. The resolver keys the map by the
      // hex of the id, so its entries pass. A caller-built map is checked here too.
      if(proofIdHex(smtProof) !== signal.signalBytes) {
        throw new SMTBeaconError(
          `SMT proof id does not equal the signal root ${signal.signalBytes}.`,
          INVALID_SIGNAL_DATA, { smtProof, did, smtRootHash: signal.signalBytes }
        );
      }

      // Verify the proof with the SMT Proof Verification algorithm. The nonce and
      // updateId fields of the proof select the leaf value (four arms). A proof that
      // does not decode, or that does not walk to the root, is INVALID_SIGNAL_DATA.
      if(!verifyProof(smtProof, did)) {
        throw new SMTBeaconError(
          `SMT proof verification failed for the signal root ${signal.signalBytes}.`,
          INVALID_SIGNAL_DATA, { smtProof, did, smtRootHash: signal.signalBytes }
        );
      }

      // No updateId: the signal announces no update for this DID. No tuple.
      if(smtProof.updateId === undefined) {
        continue;
      }

      // Look up the signed update in sidecar updateMap (keyed by hex canonical
      // hash). The proof's updateId is the same hash in base64url.
      const updateHashHex = hashToHex(base64UrlToHash(smtProof.updateId));
      const signedUpdate = sidecar.updateMap.get(updateHashHex);

      if(!signedUpdate) {
        // Signed update not available, emit a need
        needs.push({
          kind             : 'NeedSignedUpdate',
          updateHash       : updateHashHex,
          beaconServiceId  : this.service.id
        });
        continue;
      }

      updates.push([signedUpdate, signal.blockMetadata]);
    }

    return { updates, needs };
  }

  /**
   * Broadcasts an SMT Beacon signal to the Bitcoin network.
   *
   * Builds a single-entry Sparse Merkle Tree from the signed update, then broadcasts the tree's
   * root hash via OP_RETURN. For multi-party aggregation, use the {@link AggregationService}
   * subsystem directly instead of this method. UTXO selection, PSBT construction, fee estimation,
   * signing, and broadcast are delegated to {@link SinglePartyBeacon.buildSignAndBroadcast}.
   *
   * @param {SignedBTCR2Update} signedUpdate The signed BTCR2 update to broadcast.
   * @param {Signer} signer Signer that produces the ECDSA signature for the Bitcoin transaction.
   * @param {BitcoinConnection} bitcoin The Bitcoin network connection.
   * @param {BroadcastOptions} [options] Optional broadcast configuration (e.g. fee estimator).
   * @return {Promise<BroadcastResult>} The signed update, the signal txid, and the SMT
   *   proof (with the leaf nonce embedded). The proof MUST be captured for sidecar
   *   distribution: the nonce exists only here, so the on-chain signal is unresolvable without it.
   * @throws {BeaconError} if the bitcoin address is invalid, unfunded, or UTXO cannot cover the fee.
   */
  async broadcastSignal(
    signedUpdate: SignedBTCR2Update,
    signer: Signer,
    bitcoin: BitcoinConnection,
    options?: BroadcastOptions
  ): Promise<BroadcastResult> {
    // The DID keys this beacon's leaf index in the tree.
    const did = this.did;

    // Build a single-entry SMT in nonce mode: the leaf value is
    // hash(hash(nonce) + updateId), with updateId the JSON Document Hash of the update.
    const nonce = randomBytes(32);
    const tree = new BTCR2MerkleTree();
    tree.addEntries([{ did, nonce, updateId: canonicalHashBytes(signedUpdate) }]);
    tree.finalize();

    // Serialize the proof (carrying the nonce and updateId) before
    // broadcasting: it is the only artifact that can link the on-chain root back
    // to the update, and the nonce it embeds is irrecoverable once dropped.
    const proof = tree.proof(did);

    // Root hash is the signal bytes for the OP_RETURN output
    const txid = await this.buildSignAndBroadcast(tree.rootHash, signer, bitcoin, options);

    return { signedUpdate, txid, proof };
  }
}
