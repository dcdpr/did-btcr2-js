import { AddressUtxo, BitcoinConnection } from '@did-btcr2/bitcoin';
import { canonicalHash, canonicalize, decode, encode, hash, KeyBytes } from '@did-btcr2/common';
import { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { hexToBytes } from '@noble/hashes/utils';
import { opcodes, Psbt, script } from 'bitcoinjs-lib';
import type { BeaconProcessResult, DataNeed } from '../resolver.js';
import { SidecarData } from '../types.js';
import { Beacon } from './beacon.js';
import { CASBeaconError } from './error.js';
import { BeaconService, BeaconSignal, BlockMetadata } from './interfaces.js';

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/terminology.html#cas-beacon | CAS Beacon}.
 *
 * A CAS (Content-Addressed Store) Beacon aggregates updates for multiple DIDs
 * into a single CAS Announcement — a mapping of DIDs to their update hashes.
 * The hash of the CAS Announcement is broadcast on-chain via OP_RETURN.
 * During resolution, the CAS Announcement is retrieved from the sidecar (or CAS)
 * and used to look up the individual signed update for the DID being resolved.
 *
 * @class CASBeacon
 * @type {CASBeacon}
 * @extends {Beacon}
 */
export class CASBeacon extends Beacon {
  /**
   * Creates an instance of CASBeacon.
   * @param {BeaconService} service The service of the Beacon.
   */
  constructor(service: BeaconService) {
    super({ ...service, type: 'CASBeacon' });
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-cas-beacon | 7.2.e.1 Process CAS Beacon}.
   *
   * For each signal, the signalBytes contain the hex-encoded hash of a CAS Announcement.
   * The CAS Announcement maps DIDs to their base64url-encoded update hashes.
   * This method looks up the CAS Announcement from the sidecar, extracts the update
   * hash for the DID being resolved, and retrieves the corresponding signed update.
   *
   * @param {Array<BeaconSignal>} signals The array of Beacon Signals to process.
   * @param {SidecarData} sidecar The sidecar data associated with the CAS Beacon.
   * @returns {BeaconProcessResult} Successfully resolved updates and any data needs.
   * @throws {CASBeaconError} if hash verification fails (validation errors only).
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
      // Decode signal bytes from hex and re-encode to base64url for sidecar lookup
      const announcementHash = encode(decode(signal.signalBytes, 'hex'));

      // Look up the CAS Announcement in sidecar casMap
      const casAnnouncement = sidecar.casMap.get(announcementHash);

      if(!casAnnouncement) {
        // CAS Announcement not available — emit a need
        needs.push({
          kind              : 'NeedCASAnnouncement',
          announcementHash,
          beaconServiceId   : this.service.id
        });
        continue;
      }

      // Look up this DID's update hash in the CAS Announcement
      const updateHash = casAnnouncement[did];

      // If no entry for this DID, this announcement doesn't contain an update for us — skip
      if(!updateHash) {
        continue;
      }

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
   * Broadcasts a CAS Beacon signal to the Bitcoin network.
   *
   * Creates a CAS Announcement mapping the DID to the update hash, then broadcasts
   * the hash of the announcement via OP_RETURN. The CAS Announcement is distributed
   * to resolvers via sidecar data.
   *
   * @param {SignedBTCR2Update} signedUpdate The signed BTCR2 update to broadcast.
   * @param {KeyBytes} secretKey The secret key for signing the Bitcoin transaction.
   * @param {BitcoinConnection} bitcoin The Bitcoin network connection.
   * @returns {Promise<SignedBTCR2Update>} The signed update that was broadcast.
   * @throws {CASBeaconError} if the bitcoin address is invalid or unfunded.
   */
  async broadcastSignal(
    signedUpdate: SignedBTCR2Update,
    secretKey: KeyBytes,
    bitcoin: BitcoinConnection
  ): Promise<SignedBTCR2Update> {
    // Extract the DID from the beacon service id (strip the #fragment)
    const did = this.service.id.split('#')[0];

    // Hash the signed update (base64url for the CAS Announcement entry)
    const updateHash = canonicalHash(signedUpdate);

    // Create the CAS Announcement mapping this DID to its update hash
    const casAnnouncement = { [did]: updateHash };

    // TODO: Publish CAS Announcement to content-addressed store (e.g., IPFS via Helia)

    // Canonicalize and hash the CAS Announcement for the OP_RETURN output
    const announcementHash = hash(canonicalize(casAnnouncement));

    // Convert the serviceEndpoint to a bitcoin address by removing the 'bitcoin:' prefix
    const bitcoinAddress = this.service.serviceEndpoint.replace('bitcoin:', '');

    // Query the Bitcoin network for UTXOs associated with the bitcoinAddress
    const utxos = await bitcoin.rest.address.getUtxos(bitcoinAddress);

    // If no utxos are found, throw an error indicating the address is unfunded.
    if(!utxos.length) {
      throw new CASBeaconError(
        'No UTXOs found, please fund address!',
        'UNFUNDED_BEACON_ADDRESS', { bitcoinAddress }
      );
    }

    // Sort utxos by block height and take the most recent one
    const utxo: AddressUtxo | undefined = utxos.sort(
      (a, b) => b.status.block_height - a.status.block_height
    ).shift();

    // If no utxos are found, throw an error.
    if(!utxo) {
      throw new CASBeaconError(
        'Beacon bitcoin address unfunded or utxos unconfirmed.',
        'UNFUNDED_BEACON_ADDRESS', { bitcoinAddress }
      );
    }

    // Get the previous tx to the utxo being spent
    const prevTx = await bitcoin.rest.transaction.getHex(utxo.txid);

    // Construct a spend transaction
    const spendTx = new Psbt({ network: bitcoin.data })
      // Spend tx contains the utxo as its input
      .addInput({
        hash           : utxo.txid,
        index          : utxo.vout,
        nonWitnessUtxo : hexToBytes(prevTx)
      })
      // Add a change output minus a fee of 500 sats
      // TODO: calculate fee based on transaction vsize and current fee rates
      .addOutput({ address: bitcoinAddress, value: BigInt(utxo.value) - BigInt(500) })
      // Add an OP_RETURN output containing the CAS Announcement hash
      .addOutput({ script: script.compile([opcodes.OP_RETURN, announcementHash]), value: 0n });

    // Construct a key pair and PSBT signer from the secret key
    const keyPair = SchnorrKeyPair.fromSecret(secretKey);
    const signer = {
      publicKey : keyPair.publicKey.compressed,
      sign      : (hash: Uint8Array) => keyPair.secretKey.sign(hash, { scheme: 'ecdsa' }),
    };

    // Sign 0th input, finalize extract to hex in prep for broadcast
    const signedTx = spendTx.signInput(0, signer)
      .finalizeAllInputs()
      .extractTransaction()
      .toHex();

    // Broadcast spendTx to the Bitcoin network.
    const txid = await bitcoin.rest.transaction.send(signedTx);

    // Log the txid of the broadcasted transaction
    console.info(`CAS Beacon Signal Broadcasted with txid: ${txid}`);

    // Return the signed update
    return signedUpdate;
  }
}
