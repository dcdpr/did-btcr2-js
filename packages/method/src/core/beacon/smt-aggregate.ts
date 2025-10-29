import { RawTransactionV2 } from '@did-btcr2/bitcoin';
import { DidUpdatePayload, MethodError } from '@did-btcr2/common';
import { DidServiceEndpoint } from '@web5/dids';
import { Beacon } from '../../interfaces/beacon.js';
import { BeaconService, BeaconSignal } from '../../interfaces/ibeacon.js';
import { BeaconSidecarData, SignalsMetadata, SMTAggregateSidecar } from '../../types/crud.js';

/**
 * TODO: Finish implementation
 *
 * Implements {@link https://dcdpr.github.io/did-btcr2/#smtaggregate-beacon | 5.3 SMTAggregate Beacon}.
 *
 * A SMTAggregate Beacon is a Beacon whose Beacon Signals are Bitcoin transactions containing the root of a Sparse
 * Merkle Tree (SMT). The SMT root attests to a set of DID Update Payloads, however, the updates themselves MUST be
 * provided along with a proof of inclusion against the SMT root through a Sidecar mechanism during resolution. Using
 * the SMT root a resolver can then verify the inclusion proof for the given DID Update Payload. If a DID document
 * includes a SMTAggregator Beacon in their set of Beacon services, then they MUST provide proofs for each signal that
 * the Beacon broadcasts. If they did not submit an update to their DID in a signal, then they MUST provide a proof of
 * non-inclusion for that signal.
 *
 * @class SMTAggregateBeacon
 * @type {SMTAggregateBeacon}
 * @extends {Beacon}
 */
export class SMTAggregateBeacon extends Beacon {
  /**
   * Creates an instance of SMTAggregateBeacon.
   * @param {BeaconService} service The Beacon service.
   * @param {?BeaconSidecarData} [sidecar] Optional sidecar data.
   */
  constructor(service: BeaconService, sidecar?: BeaconSidecarData<SMTAggregateSidecar>) {
    super({ ...service, type: 'SMTAggregateBeacon' }, sidecar);
  }

  /**
   * Get the Beacon service.
   * @readonly
   * @type {BeaconService} The Beacon service.
   */
  get service(): BeaconService {
    const service = {
      type            : this.type,
      id              : this.id,
      serviceEndpoint : this.serviceEndpoint
    };
    return service;
  }

  /**
   * TODO: Figure out if this is necessary or not.
   * @param {string} didUpdatePayload The DID Update Payload to generate the signal for.
   * @returns {BeaconSignal} The generated signal.
   * @throws {MethodError} if the signal is invalid.
   */
  public generateSignal(didUpdatePayload: string): BeaconSignal {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, {didUpdatePayload});
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#establish-beacon | 5.3.1 Establish Beacon}.
   *
   * The Establish Beacon algorithm is essentially the same as for the CIDAggregate Beacon in Establish CIDAggregate
   * Beacon. A cohort of DID controllers need to coordinate to produce a Bitcoin address that will act as the Beacon.
   * It is RECOMMENDED this is an n-of-n P2TR address, with n being the set of DID controllers in the cohort. Once the
   * address has been created, and all parties in the cohort acknowledge their intention to participate in that Beacon,
   * each DID controller SHOULD add the Beacon as a service to their DID document.
   *
   * Additionally, the SMTAggregate Beacon cohort participants MUST register the did:btcr2 identifiers they intend use
   * this Beacon with. This is so the Beacon coordinator can generate the necessary proofs of both inclusion and
   * non-inclusion for each DID.
   *
   * Static, convenience method for establishing a Beacon object.
   *
   * @param {string} id The Beacon ID.
   * @param {string} type The Beacon type.
   * @param {DidServiceEndpoint} serviceEndpoint The service endpoint.
   * @returns {Beacon} The Beacon.
   */
  public static establish(id: string, type: string, serviceEndpoint: DidServiceEndpoint): SMTAggregateBeacon {
    return new SMTAggregateBeacon({ id, type, serviceEndpoint });
  }

  /**
   *
   * Implements {@link https://dcdpr.github.io/did-btcr2/#broadcast-smtaggregate-beacon-signal | 5.3.2 Broadcast SMTAggregate Beacon Signal}.
   *
   * See {@link Beacon.broadcastSignal | Beacon Interface Method broadcastSignal} for more information.
   *
   * To publish a DID Update Payload, the DID controller MUST get a hash of the DID Update Payload included at the leaf
   * of the Sparse Merkle Tree (SMT) identified by their did:btcr2 identifier and receive an inclusion proof for this
   * data. If a member of the Beacon cohort does not wish to announce an update in a Beacon Signal, they MUST receive
   * and verify a proof of non-inclusion for their DID. Upon verifying the non-inclusion proof against the SMT root
   * contained in the Beacon Signal, they SHOULD accept and authorize the signal following the MuSig2 protocol. Once all
   * members of the cohort have authorized the signal, it can be broadcast as a transaction to the Bitcoin network. DID
   * controllers are responsible for persisting their DID updates and proofs, these will need to be provided through a
   * Sidecar mechanism during a resolution process.
   *
   * @param {DidUpdatePayload} didUpdatePayload The DID Update Payload to broadcast.
   * @returns {Promise<SignalMetadata>} The signal metadata.
   * @throws {MethodError} if the signal is invalid.
   */
  public broadcastSignal(didUpdatePayload: DidUpdatePayload): Promise<SignalsMetadata> {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, didUpdatePayload);
  }


  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#process-smtaggregate-beacon-signal | 5.3.3 Process SMTAggregate Beacon Signal}.
   *
   * See {@link Beacon.processSignal | Beacon Interface Method processSignal} for more information.
   *
   * A Beacon Signal from a SMTAggregate Beacon is a Bitcoin transaction with the first transaction output of the format
   * [OP_RETURN, OP_PUSH32, <32bytes>]. The 32 bytes of data contained within this transaction output represent the root
   * of a Sparse Merkle Tree (SMT). This SMT aggregates a set of hashes of DID Update payloads. In order to process
   * these Beacon Signals, the resolver MUST have been passed Sidecar data for this signal containing either the DID
   * Update payload object and a SMT proof that the hash of this object is in the SMT at the leaf indexed by the
   * did:Identifier being resolved. Or theSidecar data:: MUST contain a proof that the leaf indexed by the
   * did:Identifier is empty, thereby proving that theSMT:: does not contain an update for their identifier.
   *
   * The Process SMTAggregate Beacon Signal is called by the Process Beacon Signals algorithm as part of the Read
   * operation. It takes as inputs a did:btcr2 identifier, Identifier, a Beacon Signal, tx, and a optional object,
   * signalSidecarData, containing any sidecar data provided to the resolver for the Beacon Signal identified by the
   * Bitcoin transaction identifier.
   *
   * It returns the DID Update payload announced by the Beacon Signal for the did:btcr2 identifier being resolved or
   * throws an error.
   *
   * @param {RawTransactionV2} signal The raw transaction signal.
   * @param {SignalsMetadata} signalsMetadata The signals metadata.
   * @returns {Promise<DidUpdatePayload | undefined>} The updated DID document.
   * @throws {MethodError} if the signal is invalid.
   */
  public processSignal(signal: RawTransactionV2, signalsMetadata: SignalsMetadata): Promise<DidUpdatePayload | undefined> {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, {signal, signalsMetadata});
  }
}
