import {
  BitcoinNetworkConnection,
  BlockV3,
  GENESIS_TX_ID,
  getNetwork,
  RawTransactionV2,
  TXIN_WITNESS_COINBASE
} from '@did-btcr2/bitcoin';
import {
  DateUtils,
  IdentifierHrp,
  INVALID_DID,
  INVALID_DID_DOCUMENT,
  INVALID_DID_UPDATE,
  JSONPatch,
  JSONUtils,
  LATE_PUBLISHING_ERROR,
  ResolveError,
  MISSING_UPDATE_DATA
} from '@did-btcr2/common';
import {
  BIP340Cryptosuite,
  BIP340DataIntegrityProof,
  BTCR2SignedUpdate,
  BTCR2UnsignedUpdate,
  SchnorrMultikey
} from '@did-btcr2/cryptosuite';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils';
import { canonicalization, DidBtcr2 } from '../did-btcr2.js';
import { Appendix } from '../utils/appendix.js';
import { DidDocument, ID_PLACEHOLDER_VALUE } from '../utils/did-document.js';
import { BeaconFactory } from './beacon/factory.js';
import { BeaconService, BeaconSignal, BlockMetadata } from './beacon/interfaces.js';
import { BeaconUtils } from './beacon/utils.js';
import { DidComponents, Identifier } from './identifier.js';
import { SMTProof } from './interfaces.js';
import { CASAnnouncement, Sidecar, SidecarData } from './types.js';

/**
 * The response object for DID Resolution.
 */
export interface DidResolutionResponse {
  currentDocument: DidDocument;
  confirmations: number;
  versionId: string;
  updated: string;
}

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html | 7.2 Resolve}.
 * Resolving a did:btcr2 identifier iteratively builds a DID document by applying BTCR2 Updates
 * to an Initial DID Document that have been committed to the Bitcoin blockchain by Authorized
 * Beacon Signals. The Initial DID Document is either deterministically created from the DID or
 * provided by Sidecar Data.
 * @class Resolve
 * @type {Resolve}
 */
export class Resolve {
  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-sidecar-data | Process Sidecar Data}
   * @param {Sidecar} sidecar The sidecar data to process.
   * @returns {SidecarData} The processed sidecar data containing maps of updates, CAS announcements, and SMT proofs.
   */
  static processSidecarData(sidecar: Sidecar = {} as Sidecar): SidecarData {
    // BTCR2 Signed Updates map
    const updateMap = new Map<string, BTCR2SignedUpdate>();
    if(sidecar.updates?.length)
      for(const update of sidecar.updates) {
        updateMap.set(canonicalization.process(update, { encoding: 'hex' }), update);
      }

    // CAS Announcements map
    const casMap = new Map<string, CASAnnouncement>();
    if(sidecar.casUpdates?.length)
      for(const update of sidecar.casUpdates) {
        casMap.set(canonicalization.process(update, { encoding: 'hex' }), update);
      }

    // SMT Proofs map
    const smtMap = new Map<string, SMTProof>();
    if(sidecar.smtProofs?.length)
      for(const proof of sidecar.smtProofs) {
        smtMap.set(proof.id, proof);
      }

    return { updateMap, casMap, smtMap };
  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#establish-current-document | 7.2.d Establish current_document}.
   * Resolution begins by creating an Initial Did Document called current_document (Current DID Document).
   * The current_document is iteratively patched with BTCR2 Signed Updates announced by Authorized Beacon Signals.
   * @param {DidComponents} didComponents The decoded components of the did.
   * @param {GenesisDocument} genesisDocument The genesis document for resolving the DID Document.
   * @returns {Promise<DidDocument>} The resolved DID Document object.
   * @throws {ResolveError} if the DID hrp is invalid, no sidecarData passed and hrp = "x".
   */

  static async establishCurrentDocument(
    didComponents: DidComponents,
    genesisDocument?: object,
  ): Promise<DidDocument> {
    // Deconstruct the hrp from the components
    const { hrp, genesisBytes } = didComponents;

    // If hrp `x`, perform external resolution
    if (hrp === IdentifierHrp.x) {
      if(!genesisDocument)
        throw new ResolveError(
          'External resolution requires genesisDocument',
          MISSING_UPDATE_DATA, { didComponents }
        );
      return await this.external(didComponents, genesisDocument);
    }

    // Check for hrp `k`
    if(hrp === IdentifierHrp.k){
      // Validate genesis bytes as a compressed secp256k1 public key
      if(!CompressedSecp256k1PublicKey.isValid(genesisBytes)) {
        throw new ResolveError(
          'Deterministic resolution requires valid secp256k1 public key',
          INVALID_DID, { genesisBytes }
        );
      }
      // Perform deterministic resolution
      return this.deterministic(didComponents);
    }

    // Else, throw an error for unsupported hrp
    throw new ResolveError(`Unsupported DID hrp ${hrp}`, INVALID_DID, { hrp });
  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#if-genesis_bytes-is-a-secp256k1-public-key | 7.2.d.1 if genesis bytes is a secp256k1 Public Key}.
   * @param {DidComponents} didComponents The decoded components of the did.
   * @returns {DidDocument} The resolved DID Document object.
   */
  static deterministic(didComponents: DidComponents): DidDocument {
    // Encode the did from the didComponents
    const did = Identifier.encode(didComponents);

    // Deconstruct the bytes from the given components
    const { genesisBytes } = didComponents;

    // Construct a new CompressedSecp256k1PublicKey and deconstruct the publicKey and publicKeyMultibase
    const { multibase: publicKeyMultibase } = new CompressedSecp256k1PublicKey(genesisBytes);

    // Generate the service field for the DID Document
    const service = BeaconUtils.generateBeaconServices({
      id         : did,
      publicKey  : genesisBytes,
      network    : getNetwork(didComponents.network),
      beaconType : 'SingletonBeacon'
    });

    return new DidDocument({
      id                 : did,
      controller         : [did],
      verificationMethod : [{
        id                 : `${did}#initialKey`,
        type               : 'Multikey',
        controller         : did,
        publicKeyMultibase : publicKeyMultibase.encoded
      }],
      service
    });
  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#if-genesis_bytes-is-a-sha-256-hash | 7.2.d.2 if genesis_bytes is a SHA-256 Hash}.
   * @param {DidComponents} didComponents BTCR2 DID components used to resolve the DID Document
   * @param {GenesisDocument} genesisDocument The genesis document for resolving the DID Document.
   * @returns {Promise<DidDocument>} The resolved DID Document object
   * @throws {ResolveError} InvalidDidDocument if not conformant to DID Core v1.1
   */
  static async external(
    didComponents: DidComponents,
    genesisDocument: object,
  ): Promise<DidDocument> {
    // Canonicalize and sha256 hash the currentDocument
    const hashBytes = canonicalization.process(genesisDocument, { encoding: 'hex' });

    // Compare the genesisBytes to the hashBytes
    const genesisBytes = bytesToHex(didComponents.genesisBytes);

    // If the genesisBytes do not match the hashBytes, throw an error
    if (genesisBytes !== hashBytes) {
      throw new ResolveError(
        `Initial document mismatch: genesisBytes ${genesisBytes} !== hashBytes ${hashBytes}`,
        INVALID_DID_DOCUMENT, { genesisBytes, hashBytes }
      );
    }

    // Encode the did from the didComponents
    const did = Identifier.encode(didComponents);

    // Replace the placeholder did with the did throughout the currentDocument.
    const currentDocument = JSON.parse(
      JSON.stringify(genesisDocument).replaceAll(ID_PLACEHOLDER_VALUE, did)
    );

    // Return a W3C conformant DID Document
    return new DidDocument(currentDocument);
  }

  /**
   * Finds uses the beacon services in the currentDocument to scan for onchain Beacon Signals (transactions) containing
   * Signal Bytes (last output in OP_RETURN transaction).
   * @param {Array<BeaconService>} beaconServices The array of BeaconService objects to search for signals.
   * @param {SidecarData} sidecarData The sidecar data containing maps of updates, CAS announcements, and SMT proofs.
   * @param {BitcoinNetworkConnection} bitcoin The bitcoin network connection used to fetch beacon signals
   * @param {boolean} [fullBlockchainTraversal=false] Whether to perform a full blockchain traversal or use an indexer
   * @returns {Promise<Array<[BTCR2SignedUpdate, BlockMetadata]>>} The array of BTCR2 Signed Updates announced by the Beacon Signals.
   */
  static async processBeaconSignals(
    beaconServices: Array<BeaconService>,
    sidecarData: SidecarData,
    bitcoin: BitcoinNetworkConnection,
    fullBlockchainTraversal?: boolean
  ): Promise<Array<[BTCR2SignedUpdate, BlockMetadata]>> {
    // Query indexer or perform a full blockchain traversal for Beacon Signals
    const beaconServicesSignals = !fullBlockchainTraversal
      ? await this.queryBlockchainIndexer(beaconServices, bitcoin)
      : await this.traverseFullBlockchain(beaconServices, bitcoin);


    // Set updates to an empty array
    const unsortedUpdates = new Array<[BTCR2SignedUpdate, BlockMetadata]>();

    // Iterate over each beacon service and its signals
    for(const [service, signals] of beaconServicesSignals) {
      // Establish a beacon object
      const beacon = BeaconFactory.establish(service, signals, sidecarData);
      // Process its signals
      const processed = await beacon.processSignals();
      // Append the processed updates to the updates array
      unsortedUpdates.push(...processed);
    }

    return unsortedUpdates;
  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-updates | 7.2.f Process updates Array}.
   * @param {DidDocument} currentDocument The current DID Document to apply the updates to.
   * @param {Array<[BTCR2SignedUpdate, BlockMetadata]>} unsortedUpdates The unsorted array of BTCR2 Signed Updates and their associated Block Metadata.
   * @param {string} [versionTime] The optional version time to limit updates to.
   * @param {string} [versionId] The optional version id to limit updates to.
   * @returns {Promise<DidResolutionResponse>} The updated DID Document, number of confirmations, and version id.
   */
  static async processUpdatesArray(
    currentDocument: DidDocument,
    unsortedUpdates: Array<[BTCR2SignedUpdate, BlockMetadata]>,
    versionTime?: string,
    versionId?: string
  ): Promise<DidResolutionResponse> {
    // Start the version number being processed at 1
    let currentVersionId = 1;

    // Initialize an empty array to hold the update hashes
    const updateHashHistory: string[] = [];

    // 1. Sort updates by targetVersionId (ascending), using blockheight as tie-breaker
    const updates = unsortedUpdates.sort(([upd0, blk0], [upd1, blk1]) =>
      upd0.targetVersionId - upd1.targetVersionId || blk0.height - blk1.height
    );

    // Create a default response object
    const response = {
      currentDocument,
      versionId     : `${currentVersionId}`,
      confirmations : 0,
      updated       : ''
    };

    // Iterate over each (update block) pair
    for(const [update, block] of updates) {
      // Get the hash of the current document
      const currentDocumentHash = canonicalization.process(response.currentDocument, { encoding: 'base58' });

      // Set confirmations to the block confirmations
      response.confirmations = block.confirmations;

      // Safely convert versionTime to timestamp
      const vTime = DateUtils.dateStringToTimestamp(versionTime || '');
      // Safely convert block.blocktime to timestamp
      const bTime = DateUtils.blocktimeToTimestamp(block.time);
      // Set the updated field to the blocktime of the current update
      response.updated = DateUtils.toISOStringNonFractional(bTime);

      // if resolutionOptions.versionTime is defined and the blocktime is more recent, return currentDocument
      if(vTime < bTime) {
        return response;
      }

      // Check update.targetVersionId against currentVersionId
      // If update.targetVersionId <= currentVersionId, confirm duplicate update
      if(update.targetVersionId <= currentVersionId) {
        updateHashHistory.push(currentDocumentHash);
        this.confirmDuplicateUpdate(update, updateHashHistory);
      }

      // If update.targetVersionId == currentVersionId + 1, apply the update
      else if (update.targetVersionId === currentVersionId + 1) {
      // Prepend `z` to the sourceHash if it does not start with it
        const sourceHash = update.sourceHash.startsWith('z') ? update.sourceHash : `z${update.sourceHash}`;

        // Check if update.sourceHash !== currentDocumentHash
        if (sourceHash !== currentDocumentHash) {
          // Raise an INVALID_DID_UPDATE error if they do not match
          throw new ResolveError(
            `Hash mismatch: update.sourceHash !== currentDocumentHash`,
            INVALID_DID_UPDATE, { sourceHash, currentDocumentHash }
          );
        }
        // Apply the update to the currentDocument and set it in the response
        response.currentDocument = await this.applyDidUpdate(response.currentDocument, update);
        // Create unsigned_update by removing the proof property from update.
        const unsignedUpdate = JSONUtils.deleteKeys(update, ['proof']) as BTCR2UnsignedUpdate;
        // Push the canonicalized unsigned update hash to the updateHashHistory
        updateHashHistory.push(canonicalization.process(unsignedUpdate, { encoding: 'base58' }));
      }

      // If update.targetVersionId > currentVersionId + 1, throw LATE_PUBLISHING error
      else if(update.targetVersionId > currentVersionId + 1) {
        throw new ResolveError(
          `Version Id Mismatch: targetVersionId cannot be > currentVersionId + 1`,
          'LATE_PUBLISHING_ERROR', {
            targetVersionId  : update.targetVersionId,
            currentVersionId : String(currentVersionId + 1)
          }
        );
      }

      // Increment currentVersionId
      currentVersionId++;
      // Set currentVersionId in response
      response.versionId = `${currentVersionId}`;

      // If resolutionOptions.versionId is defined and <= currentVersionId, return currentDocument
      if(currentVersionId >= Number(versionId)) {
        return response;
      }

      // Check if the current document is deactivated before further processing
      if(currentDocument.deactivated) {
        return response;
      }
    }

    // Return response data
    return response;
  }

  /**
   * Retrieves the beacon signals for the given array of BeaconService objects
   * using a esplora/electrs REST API connection via a bitcoin I/O driver.
   * @param {Array<BeaconService>} beaconServices Array of BeaconService objects to retrieve signals for
   * @param {BitcoinNetworkConnection} bitcoin Bitcoin network connection to use for REST calls
   * @returns {Promise<Array<BeaconSignal>>} Promise resolving to an array of BeaconSignal objects
   */
  static async queryBlockchainIndexer(
    beaconServices: Array<BeaconService>,
    bitcoin: BitcoinNetworkConnection
  ): Promise<Map<BeaconService, Array<BeaconSignal>>> {
    // Empty array of beaconSignals
    const beaconServiceSignals = new Map<BeaconService, Array<BeaconSignal>>();

    // Iterate over each beacon
    for (const beaconService of beaconServices) {
      beaconServiceSignals.set(beaconService, []);
      // Get the transactions for the beacon address via REST
      const beaconSignals = await bitcoin.network.rest.address.getTxs(
        beaconService.serviceEndpoint as string
      );

      // If no signals are found, continue
      if (!beaconSignals || !beaconSignals.length) {
        continue;
      }

      // Iterate over each signal
      for (const beaconSignal of beaconSignals) {
        // Get the last vout in the transaction
        const signalVout = beaconSignal.vout.slice(-1)[0];

        /**
         * Look for OP_RETURN in last vout scriptpubkey_asm
         * Vout (rest) format:
         * {
         *  scriptpubkey: '6a20570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a',
         *  scriptpubkey_asm: 'OP_RETURN OP_PUSHBYTES_32 570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a',
         *  scriptpubkey_type: 'op_return',
         *  value: 0
         * }
         */
        if(!signalVout || !signalVout.scriptpubkey_asm.includes('OP_RETURN')) {
          // If not found, continue to next signal
          continue;
        }

        // Construct output map for easier access
        const outputMap = new Map<string, string | number>(Object.entries(signalVout));

        // Grab the signal vout scriptpubkey
        const signalVoutScriptPubkey = outputMap.get('scriptpubkey_asm') as string;

        // If the signal vout scriptpubkey does not exist, continue to next signal
        if(!signalVoutScriptPubkey){
          continue;
        }

        // Extract hex string hash of the signal bytes from the scriptpubkey
        const updateHash = signalVoutScriptPubkey.split(' ').slice(-1)[0];
        if(!updateHash) {
          continue;
        }

        const confirmations = await bitcoin.network.rest.block.count() - beaconSignal.status.block_height + 1;
        // Push the beacon signal object to the signals array for the beacon service
        beaconServiceSignals.get(beaconService)?.push({
          tx            : beaconSignal,
          signalBytes   : updateHash,
          blockMetadata : {
            confirmations,
            height : beaconSignal.status.block_height,
            time   : beaconSignal.status.block_time,
          }
        });
      }
    }


    // Return the beaconSignals
    return beaconServiceSignals;
  }

  /**
   * Traverse the full blockchain from genesis to chain top looking for beacon signals.
   * @param {Array<BeaconService>} beaconServices Array of BeaconService objects to search for signals.
   * @param {BitcoinNetworkConnection} bitcoin Bitcoin network connection to use for RPC calls.
   * @returns {Promise<Array<BeaconSignal>>} Promise resolving to an array of BeaconSignal objects.
   */
  static async traverseFullBlockchain(
    beaconServices: Array<BeaconService>,
    bitcoin: BitcoinNetworkConnection
  ): Promise<Map<BeaconService, Array<BeaconSignal>>> {
    const beaconServiceSignals = new Map<BeaconService, Array<BeaconSignal>>();

    for(const beaconService of beaconServices) {
      beaconServiceSignals.set(beaconService, []);
    }

    // Get the RPC connection from the bitcoin network
    const rpc = bitcoin.network.rpc;

    // Ensure that the RPC connection is available
    if(!rpc) {
      throw new ResolveError('RPC connection is not available', 'RPC_CONNECTION_ERROR', bitcoin);
    }

    // Get the current block height
    const targetHeight = await rpc.getBlockCount();

    // Set genesis height
    let height = 0;

    // Opt into rpc connection to get the block data at the blockhash
    let block = await bitcoin.network.rpc!.getBlock({ height }) as BlockV3;

    console.info(`Searching for beacon signals, please wait ...`);
    while (block.height <= targetHeight) {
      // Iterate over each transaction in the block
      for (const tx of block.tx) {
        // If the txid is a coinbase, continue ...
        if (tx.txid === GENESIS_TX_ID) {
          continue;
        }

        // Iterate over each input in the transaction
        for (const vin of tx.vin) {

          // If the vin is a coinbase transaction, continue ...
          if (vin.coinbase) {
            continue;
          }

          // If the vin txinwitness contains a coinbase did, continue ...
          if (vin.txinwitness && vin.txinwitness.length === 1 && vin.txinwitness[0] === TXIN_WITNESS_COINBASE) {
            continue;
          }

          // If the txid from the vin is undefined, continue ...
          if (!vin.txid) {
            continue;
          }

          // If the vout from the vin is undefined, continue ...
          if (vin.vout === undefined) {
            continue;
          }

          // Get the previous output transaction data
          const prevout = await rpc.getRawTransaction(vin.txid, 2) as RawTransactionV2;

          // If the previous output vout at the vin.vout index is undefined, continue ...
          if (!prevout.vout[vin.vout]) {
            continue;
          }

          // Get the address from the scriptPubKey from the prevvout (previous output's input at the vout index)
          const scriptPubKey = prevout.vout[vin.vout].scriptPubKey;

          // If the scriptPubKey.address is undefined, continue ...
          if (!scriptPubKey.address) {
            continue;
          }

          // If the beaconAddress from prevvout scriptPubKey is not a beacon service endpoint address, continue ...
          const beaconService = BeaconUtils.getBeaconServicesMap(beaconServices).get(scriptPubKey.address);
          if (!beaconService) {
            continue;
          }

          /**
           * Look for 'OP_RETURN' in prevout.vout[vin.vout].scriptPubKey.asm, else continue ...
           *
           * TxOut (rpc) format:
           * {
           *  value: 0,
           *  n: 1,
           *  scriptPubKey: {
           *    asm: 'OP_RETURN 570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a',
           *    desc: 'raw(6a20570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a)#cdgj3pm4',
           *    hex: '6a20570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a',
           *    type: 'nulldata'
           *  }
           * }
           */
          const txVoutScriptPubkeyAsm = prevout.vout[vin.vout].scriptPubKey.asm;
          if(!txVoutScriptPubkeyAsm.includes('OP_RETURN')) {
            continue;
          }

          // Log the found txid and beacon
          console.info(`Tx ${tx.txid} contains beacon service address ${scriptPubKey.address} and OP_RETURN!`, tx);

          // Extract hex string hash of the signal bytes from the scriptpubkey
          const updateHash = txVoutScriptPubkeyAsm.split(' ').slice(-1)[0];
          if(!updateHash) {
            continue;
          }

          // Push the beacon signal object to the beacon signals array for that beacon service
          beaconServiceSignals.get(beaconService)?.push({
            tx,
            signalBytes   : updateHash,
            blockMetadata : {
              height        : block.height,
              time          : block.time,
              confirmations : block.confirmations
            }
          });
        };
      }

      // Increment the height
      height += 1;

      // Check if we've reached the chain tip
      const tip = await rpc.getBlockCount();
      if(height > tip) {
        // If so, break the loop
        console.info(`Chain tip reached ${height}, breaking ...`);
        break;
      }

      // Reset the block var to the next block data
      block = await rpc.getBlock({ height }) as BlockV3;
    }

    return beaconServiceSignals;
  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/#confirm-duplicate-update | 7.2.f.1 Confirm Duplicate Update}.
   * This step confirms that an update with a lower-than-expected targetVersionId is a true duplicate.
   * @param {BTCR2SignedUpdate} update The BTCR2 Signed Update to confirm as a duplicate.
   * @returns {void} Does not return a value, but throws an error if the update is not a valid duplicate.
   */
  static confirmDuplicateUpdate(update: BTCR2SignedUpdate, updateHashHistory: string[]): void {
    // Create unsigned_update by removing the proof property from update.
    const unsignedUpdate = JSONUtils.deleteKeys(update, ['proof']) as BTCR2UnsignedUpdate;

    // Hash unsignedUpdate with JSON Document Hashing algorithm
    const unsignedUpdateHash = canonicalization.process(unsignedUpdate);

    // 5. Let historicalUpdateHash equal updateHashHistory[updateHashIndex].
    const historicalUpdateHash = updateHashHistory[update.targetVersionId - 2];

    // Check if the updateHash matches the historical hash
    if (updateHashHistory[update.targetVersionId - 2] !== unsignedUpdateHash) {
      throw new ResolveError(
        `Invalid duplicate: ${unsignedUpdateHash} does not match ${historicalUpdateHash}`,
        LATE_PUBLISHING_ERROR, { unsignedUpdateHash, updateHashHistory }
      );
    }
  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#apply-update | 7.2.f.3 Apply Update}.
   * @param {DidDocument} currentDocument The current DID Document to apply the update to.
   * @param {BTCR2SignedUpdate} update The BTCR2 Signed Update to apply.
   * @returns {Promise<DidDocument>} The updated DID Document after applying the update.
   * @throws {ResolveError} If the update is invalid or cannot be applied.
   */
  static async applyDidUpdate(
    currentDocument: DidDocument,
    update: BTCR2SignedUpdate
  ): Promise<DidDocument> {
    // Get the capability id from the to update proof.
    const capabilityId = update.proof?.capability;
    // Since this field is optional, check that it exists
    if (!capabilityId) {
      // If it does not exist, throw INVALID_DID_UPDATE error
      throw new ResolveError('No root capability found in update', INVALID_DID_UPDATE, update);
    }

    // Get the root capability object by dereferencing the capabilityId
    const rootCapability = Appendix.dereferenceZcapId(capabilityId);

    // Deconstruct the invocationTarget and controller from the root capability
    const { invocationTarget, controller: rootController } = rootCapability;
    // Check that both invocationTarget and rootController equal currentDocument.id
    if (![invocationTarget, rootController].every((id) => id === currentDocument.id)) {
      // If they do not all match, throw INVALID_DID_UPDATE error
      throw new ResolveError(
        'Invalid root capability',
        INVALID_DID_UPDATE, { rootCapability, currentDocument }
      );
    }

    // Get the verificationMethod field from the update proof as verificationMethodId.
    const verificationMethodId = update.proof?.verificationMethod;
    // Since this field is optional, check that it exists
    if(!verificationMethodId) {
      // If it does not exist, throw INVALID_DID_UPDATE error
      throw new ResolveError('No verificationMethod found in update', INVALID_DID_UPDATE, update);
    }

    // Get the verificationMethod from the DID Document using the verificationMethodId.
    const vm = DidBtcr2.getSigningMethod(currentDocument, verificationMethodId);

    // Split the vmId by the `#` to get the id and controller.
    const [vmController, vmId] = vm.id.split('#');

    // Construct a new SchnorrMultikey.
    const multikey = SchnorrMultikey.fromPublicKeyMultibase(
      `#${vmId}`, vmController, vm.publicKeyMultibase
    );

    // Construct a new BIP340Cryptosuite with the SchnorrMultikey.
    const cryptosuite = new BIP340Cryptosuite(multikey);

    // Canonicalize the update
    const canonicalUpdate = canonicalization.canonicalize(update);

    // Construct a DataIntegrityProof with the cryptosuite
    const diProof = new BIP340DataIntegrityProof(cryptosuite);

    // Call the verifyProof method
    const verificationResult = diProof.verifyProof(canonicalUpdate, 'capabilityInvocation');

    // If the result is not verified, throw INVALID_DID_UPDATE error
    if (!verificationResult.verified) {
      throw new ResolveError(
        'Invalid update: proof not verified',
        INVALID_DID_UPDATE, verificationResult
      );
    }

    // Apply the update.patch to the currentDocument to get the updatedDocument.
    const updatedDocument = JSONPatch.apply(currentDocument, update.patch) as DidDocument;

    // Verify that updatedDocument is conformant to DID Core v1.1.
    DidDocument.validate(updatedDocument);

    // Canonicalize and hash the updatedDocument to get the currentDocumentHash.
    const currentDocumentHash = canonicalization.process(currentDocument, { encoding: 'base58' });

    // Prepare the update targetHash for comparison with currentDocumentHash.
    const updateTargetHash = update.targetHash.startsWith('z') ? update.targetHash : `z${update.targetHash}`;

    // Make sure the update.targetHash equals currentDocumentHash.
    if (updateTargetHash !== currentDocumentHash) {
      // If they do not match, throw INVALID_DID_UPDATE error.
      throw new ResolveError(
        `Invalid update: updateTargetHash !== currentDocumentHash`,
        INVALID_DID_UPDATE, { updateTargetHash, currentDocumentHash }
      );
    }

    //  Return final updatedDocument.
    return updatedDocument;
  }
}