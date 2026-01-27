import {
  BitcoinCoreRpcClient,
  BitcoinNetworkConnection,
  BitcoinRestClient,
  BlockV3,
  GENESIS_TX_ID,
  getNetwork,
  RawTransactionRest,
  RawTransactionV2,
  TXIN_WITNESS_COINBASE
} from '@did-btcr2/bitcoin';
import {
  BitcoinNetworkNames,
  DateUtils,
  HashBytes,
  IdentifierHrp,
  INVALID_DID,
  INVALID_DID_DOCUMENT,
  INVALID_DID_UPDATE,
  JSONPatch,
  JSONUtils,
  LATE_PUBLISHING_ERROR,
  Logger,
  MethodError,
  NOT_FOUND,
  ResolveError,
  UnixTimestamp
} from '@did-btcr2/common';
import { Cryptosuite, DataIntegrityProof, SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils';
import { canonicalization, DidBtcr2 } from '../did-btcr2.js';
import { Appendix } from '../utils/appendix.js';
import { DidDocument, ID_PLACEHOLDER_VALUE } from '../utils/did-document.js';
import { BeaconFactory } from './beacon/factory.js';
import { BeaconService, BeaconServiceAddress, BeaconSignal } from './beacon/interfaces.js';
import { BeaconUtils } from './beacon/utils.js';
import { DidComponents } from './identifier.js';
import { BTCR2SignedUpdate, ResolutionOptions, SMTProof } from './interfaces.js';
import { CASAnnouncement, SidecarData } from './types.js';
import { GenesisDocument } from '../utils/genesis-document.js';

export type FindNextSignalsParams = {
  block: BlockV3;
  beacons: BeaconService[]
};

export type FindNextSignalsRestParams = {
  connection: BitcoinRestClient;
  beaconSignals: Array<BeaconSignal>;
  block: BlockV3;
  beacons: Array<BeaconServiceAddress>;
}
export type BeaconSignals = Array<BeaconSignal>;
export type BitcoinClient = BitcoinCoreRpcClient | BitcoinRestClient;

export type NetworkVersion = {
  version?: string;
  network?: string;
};
export type CurrentDocumentParams = {
  did: string;
  components: DidComponents;
  resolutionOptions: ResolutionOptions;
};

export type ConfirmDuplicateParams = { update: BTCR2SignedUpdate; updateHashHistory: string[]; };

// Deterministic
export interface DeterministicParams {
  components: DidComponents;
  did: string;
};

// External
export interface ExternalParams {
  components: DidComponents;
  did: string;
  resolutionOptions: ResolutionOptions;
}
export interface SidecarParams {
  didComponents: DidComponents;
  genesisDocument: DidDocument;
};
export interface CasParams {
  did: string;
  didComponents: DidComponents;
}

// Methods
export interface ApplyDidUpdateParams {
  contemporaryDidDocument: DidDocument;
  update: BTCR2SignedUpdate;
}

export interface TargetDocumentParams {
  genesisDocument: DidDocument;
  resolutionOptions: ResolutionOptions;
};

export interface TargetBlockheightParams {
  network: BitcoinNetworkNames;
  targetTime?: UnixTimestamp;
}

export type ProcessedSidecarData = SidecarData & {
  updateMap: Map<HashBytes, BTCR2SignedUpdate>;
  casMap: Map<HashBytes, CASAnnouncement>;
  smtMap: Map<string, SMTProof>;
}

const bitcoin = new BitcoinNetworkConnection();

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html | 7.2 Resolve}.
 * @class Resolve
 * @type {Resolve}
 */
export class Resolve {
  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-sidecar-data | Process Sidecar Data}
   * @param {SidecarData} sidecar The sidecar data to process.
   * @returns {ProcessedSidecarData} The processed sidecar data containing maps of updates, CAS announcements, and SMT proofs.
   */
  static processSidecarData(sidecar: SidecarData = {} as SidecarData): ProcessedSidecarData {
    const updateMap = new Map<HashBytes, BTCR2SignedUpdate>();
    if(sidecar.updates?.length)
      for(let update of sidecar.updates) {
        updateMap.set(canonicalization.canonicalhash(update), update);
      }

    const casMap = new Map<HashBytes, CASAnnouncement>();
    if(sidecar.casUpdates?.length)
      for(let update of sidecar.casUpdates) {
        casMap.set(canonicalization.canonicalhash(update), update);
      }

    const smtMap = new Map<string, SMTProof>();
    if(sidecar.smtProofs?.length)
      for(let proof of sidecar.smtProofs) {
        smtMap.set(proof.id, proof);
      }
    return { updateMap, casMap, smtMap };
  }


  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#establish-current-document | 7.2.d Establish current_document}.
   *
   * Creates the Initial Did Document (or current_document (Current DID Document))
   * by iteratively applying BTCR2 Signed Updates announced by Authorized Beacon Signals.
   *
   * @param {CurrentDocumentParams} params See {@link CurrentDocumentParams} for parameter details.
   * @param {string} params.did The DID to be resolved.
   * @param {DidComponents} params.didComponents The decoded components of the did.
   * @param {ResolutionOptions} params.resolutionOptions Options for resolving the DID Document. See {@link ResolutionOptions}.
   * @returns {Promise<DidDocument>} The resolved DID Document object.
   * @throws {DidError} if the DID hrp is invalid, no sidecarData passed and hrp = "x".
   */
  static async currentDocument({
    did,
    didComponents,
    genesisDocument
  }: {
    did: string;
    didComponents: DidComponents;
    genesisDocument: GenesisDocument
  }): Promise<DidDocument> {
    // Deconstruct the hrp from the components
    const hrp = didComponents.hrp;

    // Validate the hrp is either 'k' or 'x'
    if (!(hrp in IdentifierHrp)) {
      throw new MethodError(`Invalid DID hrp ${hrp}`, INVALID_DID, { hrp });
    }

    //  Make sure options.sidecarData is not null if hrp === x
    if (hrp === IdentifierHrp.x && !genesisDocument) {
      throw new MethodError('External resolution requires genesisDocument', NOT_FOUND);
    }

    return hrp === IdentifierHrp.k
      ? this.deterministic({ did, didComponents })
      : await this.external({ did, didComponents, genesisDocument });

  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#if-genesis_bytes-is-a-secp256k1-public-key | 7.2.d.1 if genesis bytes is a secp256k1 Public Key}.
   *
   * @param {DeterministicParams} params See {@link DeterministicParams} for details.
   * @param {string} params.did The did-btcr2 version.
   * @param {DidComponents} params.didComponents The decoded components of the did.
   * @returns {DidDocument} The resolved DID Document object.
   */
  static deterministic({ did, didComponents }: {
    did: string;
    didComponents: DidComponents;
  }): DidDocument {
    // Deconstruct the components
    const { network, genesisBytes } = didComponents;

    // Construct a new CompressedSecp256k1PublicKey and deconstruct the publicKey and publicKeyMultibase
    const {
      compressed: publicKey,
      multibase: publicKeyMultibase
    } = new CompressedSecp256k1PublicKey(genesisBytes);

    // Generate the service field for the DID Document
    const service = BeaconUtils.generateBeaconServices({
      did,
      publicKey,
      network : getNetwork(network),
      type    : 'SingletonBeacon',
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
   *
   * @param {ExternalParams} params see {@link ExternalParams} for details.
   * @param {string} params.did The DID to be resolved.
   * @param {DidComponents} params.didComponents The decoded components of the did.
   * @param {GenesisDocument} params.genesisDocument The genesis document for resolving the DID Document.
   * @returns {DidDocument} The resolved DID Document object
   */
  static async external({ did, didComponents, genesisDocument }: {
    did: string;
    didComponents: DidComponents;
    genesisDocument: GenesisDocument;
  }): Promise<DidDocument> {
    // If genesisDocument, get initial document from sidecar.
    // Else get initial document from CAS.
    const currentDocument = genesisDocument
      ? this.sidecar({ didComponents, genesisDocument })
      : await this.cas({ did, didComponents });

    // Validate initial document as DID document conformant to DID Core 1.1 specification.
    DidDocument.validate(currentDocument);

    // 4. Return currentDocument.
    return currentDocument;
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#sidecar-initial-document-validation | 4.2.2.2.1 Sidecar Initial Document Validation}.
   *
   * The Sidecar Initial Document Validation algorithm validates an currentDocument against its did, by first
   * constructing the intermediateDocumentRepresentation and verifying the hash of this document matches the bytes
   * encoded within the did. It takes in a did:btcr2 did, didComponents and a
   * currentDocument. It returns the currentDocument if validated, otherwise it throws an error.
   *
   * @param {SidecarParams} params Required params for calling the sidecar method
   * @param {string} params.did The DID to be resolved
   * @param {DidComponents} params.didComponents The components of the DID did
   * @param {DidDocument} params.currentDocument The initial DID Document provided by the user
   * @returns {DidDocument} The resolved DID Document object
   * @throws {DidError} InvalidDidDocument if genesisBytes !== currentDocument hashBytes
   */
  static sidecar({ didComponents, genesisDocument }: SidecarParams): DidDocument {
    // Replace the placeholder did with the did throughout the currentDocument.
    const intermediateDocument = JSON.parse(
      JSON.stringify(genesisDocument).replaceAll(genesisDocument.id, ID_PLACEHOLDER_VALUE)
    );

    // Canonicalize and sha256 hash the intermediateDocument
    const hashBytes = canonicalization.process(intermediateDocument, { encoding: 'hex' });

    // Compare the genesisBytes to the hashBytes
    const genesisBytes = bytesToHex(didComponents.genesisBytes);

    // If the genesisBytes do not match the hashBytes, throw an error
    if (genesisBytes !== hashBytes) {
      throw new MethodError(
        `Initial document mismatch: genesisBytes ${genesisBytes} !== hashBytes ${hashBytes}`,
        INVALID_DID_DOCUMENT, { genesisBytes, hashBytes }
      );
    }

    // Return a W3C conformant DID Document
    return new DidDocument(genesisDocument);
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#cas-retrieval | 4.2.2.2.2 CAS Retrieval}.
   *
   * The CAS Retrieval algorithm attempts to retrieve an currentDocument from a Content Addressable Storage (CAS) system
   * by converting the bytes in the did into a Content Identifier (CID). It takes in an did and
   * an didComponents object. It returns an currentDocument.
   *
   * @param {CasParams} params See {@link CasParams} for details.
   * @param {string} params.did BTCR2 DID used to resolve the DID Document
   * @param {DidComponents} params.didComponents BTCR2 DID components used to resolve the DID Document
   * @returns {DidDocument} The resolved DID Document object
   * @throws {MethodError} if the DID Document content is invalid
   */
  static async cas({ did, didComponents }: {
    did: string;
    didComponents: DidComponents;
  }): Promise<DidDocument> {
    // 1. Set hashBytes to didComponents.genesisBytes.
    const hashBytes = didComponents.genesisBytes;

    // 3. Set intermediateDocumentRepresentation to the result of fetching the cid against a Content Addressable Storage
    //    (CAS) system such as IPFS.
    const intermediateDocument = await Appendix.fetchFromCas(hashBytes);

    // Validate the intermediateDocument is not null and is parsable JSON
    if (!intermediateDocument || !JSONUtils.isParsable(intermediateDocument)) {
      throw new MethodError(INVALID_DID_DOCUMENT, 'Invalid DID Document content', { intermediateDocument });
    }
    // 5. Replace the placeholder did with the did throughout the currentDocument.
    const currentDocument = JSON.parse(
      intermediateDocument.replaceAll(ID_PLACEHOLDER_VALUE, did)
    );

    // 6. Return currentDocument.
    return new DidDocument(currentDocument);
  }

  static async processBeaconSignals({ currentDocument, resolutionOptions }: {
    currentDocument: DidDocument;
    resolutionOptions: ResolutionOptions;
  }): Promise<DidDocument> {
    /**
     * TODO: Process Beacon Signals -> Process <Singleton|CAS|SMT> Beacon
     * TODO: Process updates array -> check update targetVersionId -> confirm duplicate -> apply update -> Check update proof
     */
    // // Set the network from the options or default to mainnet
    // const network = resolutionOptions.network!;

    // // 1. If resolutionOptions.versionId is not null, set targetVersionId to resolutionOptions.versionId.
    // const targetVersionId = resolutionOptions.versionId;

    // // 2. Else if resolutionOptions.versionTime is not null, set targetTime to resolutionOptions.versionTime.
    // // 3. Else set targetTime to the UNIX timestamp for now at the moment of execution.
    // const targetTime = resolutionOptions.versionTime ?? DateUtils.toUnixSeconds();

    // // 4. Set signalsMetadata to resolutionOptions.sidecar.signalsMetadata.
    // const sidecar = resolutionOptions.sidecar;

    // // 5. Set currentVersionId to 1
    // const currentVersionId = '1';

    // // 6. If currentVersionId equals targetVersionId return currentDocument.
    // if (currentVersionId === targetVersionId) {
    //   return new DidDocument(currentDocument);
    // }

    const beacons = currentDocument.service
      .filter(BeaconUtils.isBeaconService)
      .map(BeaconUtils.parseBeaconServiceEndpoint);
    // // 10. Set targetDocument to the result of calling the Traverse Bitcoin Blockchain History algorithm
    // // passing in contemporaryDIDDocument, contemporaryBlockheight, currentVersionId, targetVersionId,
    // // targetTime, didDocumentHistory, updateHashHistory, signalsMetadata, and network.
    // const targetDocument = this.traverseBlockchainHistory({
    //   contemporaryDidDocument : currentDocument,
    //   contemporaryBlockHeight : 0,
    //   currentVersionId,
    //   targetTime,
    //   didDocumentHistory      : new Array(),
    //   updateHashHistory       : new Array(),
    //   sidecar,
    //   network
    // });

    // 11. Return targetDocument.
    return targetDocument;
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#traverse-blockchain-history | 4.2.3.2 Traverse Blockchain History}.
   *
   * The Traverse Blockchain History algorithm traverses Bitcoin blocks, starting from the block with the
   * contemporaryBlockheight, to find beaconSignals emitted by Beacons within the contemporaryDidDocument. Each
   * beaconSignal is processed to retrieve a didUpdatePayload to the DID document. Each update is applied to the
   * document and duplicates are ignored. If the algorithm reaches the block with the blockheight specified by a
   * targetBlockheight, the contemporaryDidDocument at that blockheight is returned assuming a single canonical history
   * of the DID document has been constructed up to that point. It takes in contemporaryDidDocument,
   * contemporaryBlockHeight, currentVersionId, targetVersionId, targetBlockheight, updateHashHistory, signalsMetadata
   * and network. It returns the contemporaryDidDocument once either the targetBlockheight or targetVersionId have been
   * reached.
   *
   * @protected
   * @param {ReadBlockchainParams} params The parameters for the traverseBlockchainHistory operation.
   * @param {DidDocument} params.contemporaryDidDocument The DID document for the did:btcr2 did being resolved.
   *    It should be "current" (contemporary) at the blockheight of the contemporaryBlockheight.
   *    It should be a DID Core conformant DID document.
   * @param {number} params.contemporaryBlockHeight The Bitcoin blockheight signaling the "contemporary time" of the
   *    contemporary DID Document that is being resolved and updated using the Traverse Blockchain History algorithm.
   * @param {number} params.currentVersionId The version of the contemporary DID document starting from 1 and
   *    incrementing by 1 with each BTCR2 Update applied to the DID document.
   * @param {number} params.targetVersionId The version of the DID document where resolution will complete.
   * @param {UnixTimestamp} params.targetTime The timestamp used to target specific historical states of a DID document.
   *    Only Beacon Signals included in the Bitcoin blockchain before the targetTime are processed.
   * @param {boolean} params.didDocumentHistory An array of DID documents ordered ascensing by version (1...N).
   * @param {boolean} params.updateHashHistory An array of SHA256 hashes of BTCR2 Updates ordered by version that are
   *    applied to the DID document in order to construct the contemporaryDIDDocument.
   * @param {SignalsMetadata} params.signalsMetadata See {@link SignalsMetadata} for details.
   * @param {string} params.network The bitcoin network to connect to (mainnet, signet, testnet, regtest).
   * @returns {Promise<DidDocument>} The resolved DID Document object with a validated single, canonical history.
   */
  protected static async traverseBlockchainHistory({
    contemporaryDidDocument,
    contemporaryBlockHeight,
    currentVersionId,
    targetTime,
    didDocumentHistory,
    updateHashHistory,
    sidecar,
    network
  }: {
    contemporaryDidDocument: DidDocument;
    contemporaryBlockHeight: number;
    currentVersionId: string;
    targetTime: number;
    didDocumentHistory: DidDocument[];
    updateHashHistory: string[];
    sidecar: SidecarData;
    network: string;
  }): Promise<DidDocument> {
    // 1. Set contemporaryHash to the SHA256 hash of the contemporaryDidDocument
    let contemporaryHash = canonicalization.process(contemporaryDidDocument, { encoding: 'base58' });

    // 2. Find all BTCR2 Beacons in contemporaryDIDDocument.service where service.type equals one of
    //    SingletonBeacon, CASBeacon and SMTBeacon.
    // 3. For each beacon in beacons convert the beacon.serviceEndpoint to a Bitcoin address
    //    following BIP21. Set beacon.address to the Bitcoin address.
    const beacons = BeaconUtils.toBeaconServiceAddress(
      BeaconUtils.getBeaconServices(contemporaryDidDocument)
    );

    // 4. Set nextSignals to the result of calling algorithm Find Next Signals passing in contemporaryBlockheight,
    //    beacons and network.
    const nextSignals = await this.findNextSignals({ contemporaryBlockHeight, beacons, network, targetTime });
    if (!nextSignals || nextSignals.length === 0) {
      // 5. If nextSignals is null or empty, return contemporaryDidDocument.
      return new DidDocument(contemporaryDidDocument);
    }

    // 6. If nextSignals[0].blocktime is greater than targetTime, return contemporaryDIDDocument.
    if (nextSignals[0].blocktime > targetTime) {
      return new DidDocument(contemporaryDidDocument);
    }

    // 8. Set updates to the result of calling algorithm Process Beacon Signals passing in signals and sidecarData.
    // 9. Set orderedUpdates to the list of updates ordered by the targetVersionId property.
    const orderedUpdates = (
      await Promise.all(
        nextSignals.map(
          async signal => await this.processBeaconSignal(signal, sidecar)
        )
      )
    ).sort((a: { targetVersionId: number; }, b: { targetVersionId: number; }) => a.targetVersionId - b.targetVersionId);

    // 10. For update in orderedUpdates:
    for (let update of orderedUpdates) {
      const targetVersionId = update.targetVersionId;
      // 10.1. If update.targetVersionId is less than or equal to currentVersionId, run Algorithm Confirm Duplicate
      //      Update passing in update, documentHistory, and contemporaryHash.
      if (targetVersionId <= Number(currentVersionId)) {
        updateHashHistory.push(contemporaryHash);
        await this.confirmDuplicateUpdate({ update, updateHashHistory: updateHashHistory });

        //  10.2. If update.targetVersionId equals currentVersionId + 1:
      } else if (targetVersionId === Number(currentVersionId) + 1) {
        // Prepend `z` to the sourceHash if it does not start with it
        const sourceHash = update.sourceHash.startsWith('z') ? update.sourceHash : `z${update.sourceHash}`;

        //  10.2.1. Check that update.sourceHash equals contemporaryHash, else MUST raise latePublishing error.
        if (sourceHash !== contemporaryHash) {
          throw new ResolveError(
            `Hash mismatch: sourceHash ${sourceHash} !== contemporaryHash ${contemporaryHash}`,
            LATE_PUBLISHING_ERROR, { sourceHash: sourceHash, contemporaryHash }
          );
        }

        // 10.2.2. Set contemporaryDidDocument to the result of calling Apply DID Update algorithm passing in
        //        contemporaryDidDocument, update.
        contemporaryDidDocument = await this.applyDidUpdate({ contemporaryDidDocument, update });

        // 10.2.4 Push contemporaryDIDDocument onto didDocumentHistory.
        didDocumentHistory.push(contemporaryDidDocument);

        // 10.2.4. Increment currentVersionId.
        currentVersionId = `${currentVersionId+1}`;

        // 10.2.6 Remove the proof property from the unsecuredUpdate object.
        const { proof, ...unsecuredUpdate } = update;

        // 10.2.7 Set updateHash to the result of passing unsecuredUpdate into the JSON Canonicalization and Hash algorithm.
        const updateHash = await canonicalization.process(unsecuredUpdate, { encoding: 'base58' });

        // 10.2.8. Push updateHash onto updateHashHistory.
        updateHashHistory.push(updateHash as string);

        // 10.2.9. Set contemporaryHash to result of passing contemporaryDIDDocument into the JSON Canonicalization and Hash algorithm.
        contemporaryHash = await canonicalization.process(contemporaryDidDocument, { encoding: 'base58' });

        //  10.3. If update.targetVersionId is greater than currentVersionId + 1, MUST throw a LatePublishing error.
      } else if (update.targetVersionId > Number(currentVersionId) + 1) {
        throw new ResolveError(
          `Version Id Mismatch: target ${update.targetVersionId} cannot be > current+1 ${currentVersionId + 1}`,
          'LATE_PUBLISHING_ERROR'
        );
      }
    }

    // 13. If targetVersionId in not null, set targetDocument to the index at the targetVersionId of the didDocumentHistory array.

    // 14. Return contemporaryDidDocument.
    return new DidDocument(contemporaryDidDocument);
  }


  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#find-next-signals | 4.2.3.3 Find Next Signals}.
   *
   * The Find Next Signals algorithm finds the next Bitcoin block containing Beacon Signals from one or more of the
   * beacons and retuns all Beacon Signals within that block.
   *
   * It takes the following inputs:
   *  - `contemporaryBlockhieght`: The height of the block this function is looking for Beacon Signals in.
   *                               An integer greater or equal to 0.
   *  - `targetBlockheight`: The height of the Bitcoin block that the resolution algorithm searches for Beacon Signals
   *                         up to. An integer greater or equal to 0.
   *  - `beacons`: An array of Beacon services in the contemporary DID document. Each Beacon contains properties:
   *      - `id`: The id of the Beacon service in the DID document. A string.
   *      - `type`: The type of the Beacon service in the DID document. A string whose values MUST be
   *                          either SingletonBeacon, CASBeacon or SMTBeacon.
   *      - `serviceEndpoint`: A BIP21 URI representing a Bitcoin address.
   *      - `address`: The Bitcoin address decoded from the `serviceEndpoint value.
   *  - `network`: A string identifying the Bitcoin network of the did:btcr2 did. This algorithm MUST query the
   *               Bitcoin blockchain identified by the network.
   *
   * It returns a nextSignals struct, containing the following properties:
   *  - blockheight: The Bitcoin blockheight for the block containing the Beacon Signals.
   *  - signals: An array of signals. Each signal is a struct containing the following:
   *      - beaconId: The id for the Beacon that the signal was announced by.
   *      - beaconType: The type of the Beacon that announced the signal.
   *      - tx: The Bitcoin transaction that is the Beacon Signal.
   *
   * @public
   * @param {FindNextSignalsParams} params The parameters for the findNextSignals operation.
   * @param {number} params.contemporaryBlockHeight The blockheight to start looking for beacon signals.
   * @param {Array<BeaconService>} params.beacons The beacons to look for in the block.
   * @param {Array<BeaconService>} params.network The bitcoin network to connect to (mainnet, signet, testnet, regtest).
   * @param {UnixTimestamp} params.targetTime The timestamp used to target specific historical states of a DID document.
   *    Only Beacon Signals included in the Bitcoin blockchain before the targetTime are processed.
   * @returns {Promise<Array<BeaconSignal>>} An array of BeaconSignal objects with blockHeight and signals.
   */
  static async findNextSignals({ contemporaryBlockHeight, targetTime, network, beacons }: {
    contemporaryBlockHeight: number;
    beacons: Array<BeaconServiceAddress>;
    network: string;
    targetTime: UnixTimestamp;
  }): Promise<Array<BeaconSignal>> {
    let height = contemporaryBlockHeight;

    // Create an default beaconSignal and beaconSignals array
    let beaconSignals: BeaconSignals = [];

    // Get the bitcoin network connection
    bitcoin.setActiveNetwork(network);

    // Opt into REST connection if available
    if(bitcoin.network.rest) {
      return await this.findSignalsRest(beacons);
    }

    // If no rest and no rpc connection is available, throw an error
    if (!bitcoin.network.rpc) {
      throw new ResolveError(
        `No Bitcoin connection available, cannot find next signals`,
        'NO_BITCOIN_CONNECTION'
      );
    }

    // Opt into rpc connection to get the block data at the blockhash
    let block = await bitcoin.network.rpc.getBlock({ height }) as BlockV3;

    Logger.info(`Searching for signals, please wait ...`);
    while (block.time <= targetTime) {
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
          const prevout = await bitcoin.network.rpc.getRawTransaction(vin.txid, 2) as RawTransactionV2;

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
          const beaconAddresses = BeaconUtils.getBeaconServiceAddressMap(beacons);
          const beacon = (beaconAddresses.get(scriptPubKey.address) ?? {}) as BeaconServiceAddress;
          if (!beacon || !(beacon.id && beacon.type)) {
            continue;
          }

          // If the prevout.vout[vin.vout].scriptPubKey.asm does not include 'OP_RETURN', continue ...
          if(!prevout.vout[vin.vout].scriptPubKey.asm.includes('OP_RETURN')) {
            continue;
          }

          // Log the found txid and beacon
          Logger.info(`Tx ${tx.txid} contains beacon address ${scriptPubKey.address} and OP_RETURN!`, tx);

          // Push the signal object to to signals array
          beaconSignals.push({
            beaconId      : beacon.id,
            beaconType    : beacon.type,
            beaconAddress : beacon.address,
            tx,
            blockheight   : block.height,
            blocktime     : block.time
          });
        };
      }

      height += 1;
      const tip = await bitcoin.network.rpc.getBlockCount();
      if(height > tip) {
        Logger.info(`Chain tip reached ${height}, breaking ...`);
        break;
      }

      // Reset the block to the next block
      block = await bitcoin.network.rpc.getBlock({ height }) as BlockV3;
    }

    return beaconSignals;
  }

  /**
   * Helper method for the {@link findNextSignals | Find Next Signals} algorithm.
   * @param {Array<BeaconService>} beacons The beacons to process.
   * @returns {Promise<Array<BeaconSignal>>} The beacon signals found in the block.
   */
  static async findSignalsRest(beacons: Array<BeaconService>): Promise<Array<BeaconSignal>> {
    // Empty array of beaconSignals
    const beaconSignals = new Array<BeaconSignal>();

    // Iterate over each beacon
    for (const beacon of BeaconUtils.toBeaconServiceAddress(beacons)) {
      // Get the transactions for the beacon address via REST
      const transactions = await bitcoin.network.rest.address.getTxs(beacon.address);

      // If no transactions are found, continue
      if (!transactions || transactions.length === 0) {
        continue;
      }

      // Iterate over each transaction and push a beaconSignal
      for (const tx of transactions) {
        for(const vout of tx.vout) {
          if(vout.scriptpubkey_asm.includes('OP_RETURN')) {
            beaconSignals.push({
              beaconId      : beacon.id,
              beaconType    : beacon.type,
              beaconAddress : beacon.address,
              tx,
              blockheight   : tx.status.block_height,
              blocktime     : tx.status.block_time,
            });
          }
        }
      }
    }

    // Return the beaconSignals
    return beaconSignals;
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#process-beacon-signals | 4.2.3.4 Process Beacon Signals}.
   *
   * The Process Beacon Signals algorithm processes each Beacon Signal by attempting to retrieve and validate an
   * announce signed update for that signal according to the type of the Beacon.
   *
   * It takes as inputs
   *  - `beaconSignals`: An array of Beacon Signals retrieved from the Find Next Signals algorithm. Each signal contains:
   *    - `beaconId`: The id for the Beacon that the signal was announced by.
   *    - `beaconType`: The type of the Beacon that announced the signal.
   *    - `tx`: The Bitcoin transaction that is the Beacon Signal.
   *  - `signalsMetadata`: Maps Beacon Signal Bitcoin transaction ids to a SignalMetadata object containing:
   *    - `updatePayload`: A signed update which should match the update announced by the Beacon Signal.
   *                       In the case of a SMT proof of non-inclusion, no signed update may be provided.
   *    - `proofs`: Sparse Merkle Tree proof used to verify that the `updatePayload` exists as the leaf indexed by the
   *                did:btcr2 did being resolved.
   *
   * It returns an array of {@link https://dcdpr.github.io/did-btcr2/#def-did-update-payload | DID Update Payloads}.
   *
   * @public
   * @param {BeaconSignal} signal The beacon signals to process.
   * @param {SignalsMetadata} signalsMetadata The sidecar data for the DID Document.
   * @returns {BTCR2SignedUpdate[]} The updated DID Document object.
   */
  static async processBeaconSignal(signal: BeaconSignal, sidecar: SidecarData): Promise<BTCR2SignedUpdate> {
    // 1. Set updates to an empty array.
    const updates = new Array<BTCR2SignedUpdate>();

    // 2. For beaconSignal in beaconSignals:
    // 2.1 Set type to beaconSignal.beaconType.
    // 2.2 Set signalTx to beaconSignal.tx.
    // 2.3 Set signalId to signalTx.id.
    const {
      beaconId: id,
      beaconType: type,
      beaconAddress: address,
      tx
    } = signal;
    const signalTx = tx as RawTransactionRest | RawTransactionV2;

    // Construct a service object from the beaconId and type
    // and set the serviceEndpoint to the BIP21 URI for the Bitcoin address.
    const service = { id, type, serviceEndpoint: `bitcoin:${address}` };

    // Establish a Beacon instance using the service and sidecar
    const beacon = BeaconFactory.establish(service, sidecar);

    // 2.5 Set didUpdate to null.
    const didUpdate = await beacon.processSignal(signalTx, sidecar) ?? null;

    // If the updates is null, throw an error
    if (!didUpdate) {
      throw new MethodError(
        'No didUpdate for beacon', 'PROCESS_BEACON_SIGNALS_ERROR',
        { tx, sidecar }
      );
    }

    // 2.9 If didUpdate is not null, push didUpdate to updates.
    updates.push(didUpdate);

    // 3. Return updates.
    return didUpdate;
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#confirm-duplicate-update | 7.2.2.4 Confirm Duplicate Update}.
   *
   * The Confirm Duplicate Update algorithm takes in a {@link BTCR2SignedUpdate | signed update} and verifies that
   * the update is a duplicate against the hash history of previously applied updates. The algorithm takes in an update
   * and an array of hashes, updateHashHistory. It throws an error if the update is not a duplicate, otherwise it
   * returns.
   *
   * @public
   * @param {ConfirmDuplicateParams} params Parameters for confirmDuplicateUpdate.
   * @param {BTCR2SignedUpdate} params.update The signed update to confirm.
   * @param {Array<string>} params.updateHashHistory The history of hashes for previously applied updates.
   * @returns {Promise<void>} A promise that resolves if the update is a duplicate, otherwise throws an error.
   * @throws {ResolveError} if the update hash does not match the historical hash.
   */
  static async confirmDuplicateUpdate({ update, updateHashHistory }: {
    update: BTCR2SignedUpdate;
    updateHashHistory: string[];
  }): Promise<void> {
    // 1. Let unsecuredUpdate be a copy of the update object.
    const unsecuredUpdate = update;

    // 2. Remove the proof property from the unsecuredUpdate object.
    delete unsecuredUpdate.proof;

    // 3. Let updateHash equal the result of passing unsecuredUpdate into the JSON Canonicalization and Hash algorithm.
    const updateHash = await canonicalization.process(unsecuredUpdate);

    // 4. Let updateHashIndex equal update.targetVersionId - 2.
    // const updateHashIndex = update.targetVersionId - 2;

    // 5. Let historicalUpdateHash equal updateHashHistory[updateHashIndex].
    const historicalUpdateHash = updateHashHistory[update.targetVersionId - 2];

    // Check if the updateHash matches the historical hash
    if (historicalUpdateHash !== updateHash) {
      throw new ResolveError(
        `Invalid duplicate: ${updateHash} does not match ${historicalUpdateHash}`,
        'LATE_PUBLISHING_ERROR', { updateHash, updateHashHistory }
      );
    }
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#apply-did-update | 4.2.3.6 Apply DID Update}.
   *
   * This algorithm attempts to apply a DID Update to a DID document, it first verifies the proof on the update is a
   * valid capabilityInvocation of the root authority over the DID being resolved. Then it applies the JSON patch
   * transformation to the DID document, checks the transformed DID document matches the targetHash specified by the
   * update and validates it is a conformant DID document before returning it. This algorithm takes inputs
   * contemporaryDidDocument and an update.
   *
   * @public
   * @param {ApplyDidUpdateParams} params Parameters for applyDidUpdate.
   * @param {DidDocument} params.contemporaryDidDocument The current DID Document to update.
   * @param {BTCR2SignedUpdate} params.update The signed update to apply.
   * @param {Bytes} params.genesisBytes The genesis bytes for the DID Document.
   * @returns {Promise<DidDocument>}
   */
  static async applyDidUpdate({ contemporaryDidDocument, update }: {
    contemporaryDidDocument: DidDocument;
    update: BTCR2SignedUpdate;
  }): Promise<DidDocument> {
    // 1. Set capabilityId to update.proof.capability.
    const capabilityId = update.proof?.capability;
    if (!capabilityId) {
      throw new ResolveError('No capabilityId found in update', INVALID_DID_UPDATE);
    }

    // 2. Set rootCapability to the result of passing capabilityId to the Dereference Root Capability Identifier algorithm.
    const rootCapability = Appendix.derefernceRootCapabilityIdentifier(capabilityId);

    // 3. If rootCapability.invocationTarget does not equal contemporaryDidDocument.id
    //    and rootCapability.controller does not equal contemporaryDidDocument.id, MUST throw an invalidDidUpdate error.
    const { invocationTarget, controller: rootController } = rootCapability;
    if (![invocationTarget, rootController].every((id) => id === contemporaryDidDocument.id)) {
      throw new ResolveError(`Invalid root capability: ${rootCapability}`, INVALID_DID_UPDATE);
    }

    // 4. Instantiate a bip340-jcs-2025 cryptosuite instance using the key referenced by the verificationMethod field in the update.
    // Get the verificationMethod field from the update.
    const methodId = update.proof?.verificationMethod;
    if(!methodId) {
      throw new ResolveError('No verificationMethod found in update', INVALID_DID_UPDATE, update);
    }

    // Get the verificationMethod from the DID Document using the methodId.
    const { id: vmId, publicKeyMultibase } = DidBtcr2.getSigningMethod({ didDocument: contemporaryDidDocument, methodId });

    // Split the vmId by the `#` to get the id and controller.
    const [controller, id] = vmId.split('#');

    // Construct a new Multikey.
    const multikey = SchnorrMultikey.fromPublicKeyMultibase({ id: `#${id}`, controller, publicKeyMultibase });
    const cryptosuite = new Cryptosuite({ cryptosuite: 'bip340-jcs-2025', multikey });

    // 7. Set documentBytes to the bytes representation of update.
    const documentBytes = await canonicalization.canonicalize(update);

    // 8. Set verificationResult to the result of passing mediaType, documentBytes, cryptosuite, and
    //    expectedProofPurpose into the Verify Proof algorithm defined in the VC Data Integrity specification.
    const diProof = new DataIntegrityProof(cryptosuite);
    const verificationResult = await diProof.verifyProof({ document: documentBytes, expectedPurpose: 'capabilityInvocation' });

    // 9. If verificationResult.verified equals False, MUST raise a invalidUpdateProof exception.
    if (!verificationResult.verified) {
      throw new MethodError('Invalid update: proof not verified', INVALID_DID_UPDATE, verificationResult);
    }

    // 10. Set targetDIDDocument to a copy of contemporaryDidDocument.
    let targetDIDDocument = contemporaryDidDocument;

    // 11. Use JSON Patch to apply the update.patch to the targetDIDDOcument.
    targetDIDDocument = JSONPatch.apply(targetDIDDocument, update.patch) as DidDocument;

    // 12. Verify that targetDIDDocument is conformant with the data model specified by the DID Core specification.
    DidDocument.validate(targetDIDDocument);

    // 13. Set targetHash to the SHA256 hash of targetDIDDocument.
    const targetHash = await canonicalization.process(targetDIDDocument, { encoding: 'base58' });

    // Prepend the sourceHash if it does not start with `z`
    const updateTargetHash = update.targetHash.startsWith('z')
      ? update.targetHash
      : `z${update.targetHash}`;
    // 14. Check that targetHash equals update.targetHash, else raise InvalidDIDUpdate error.
    if (updateTargetHash !== targetHash) {
      throw new MethodError(`Invalid update: updateTargetHash ${updateTargetHash} does not match targetHash ${targetHash}`, INVALID_DID_UPDATE);
    }

    // 15. Return targetDIDDocument.
    return targetDIDDocument;
  }
}