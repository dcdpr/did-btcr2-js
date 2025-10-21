import { MethodError, DidUpdateInvocation, DidUpdatePayload } from '@did-btcr2/common';
import { DidServiceEndpoint } from '@web5/dids';
import { Beacon } from './beacon.js';
import { BeaconService, BeaconSignal } from './interface.js';
import { RawTransactionV2 } from '@did-btcr2/bitcoin';
import { BeaconSidecarData, CIDAggregateSidecar, SignalsMetadata } from '../crud/types.js';

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/#cidaggregate-beacon | 5.2 CIDAggregate Beacon}.
 *
 * A Beacon of the type CIDAggregatoBeacon is a Beacon that publishes Bitcoin transactions containing a Content
 * Identifier (CID) announcing an Aggregated DID Update Bundle. An Aggregated DID Update Bundle is a JSON object that
 * maps did:btcr2 identifiers to CID values for the individual DID Update Payloads. The Aggregated DID Update Bundle CID
 * (bundleCID) SHOULD be resolvable against a Content Addressable Storage (CAS) system such as IPFS, while the CID for
 * the DID Update Payload (payloadCID) MAY be resolvable against a CAS or provided through a Sidecar mechanism. It is
 * RECOMMENDED that this type of Beacon is only included in a DID document if the DID controller is REQUIRED to
 * participate in authorizing Bitcoin transactions from this Beacon. In other words, this Beacon SHOULD identify an
 * n-of-n P2TR Bitcoin address where n is the number of unique DID controllers submitting updates through the Beacon.
 *
 * @class CIDAggregateBeacon
 * @type {CIDAggregateBeacon}
 * @extends {Beacon}
 */
export class CIDAggregateBeacon extends Beacon {
  /**
   * Creates an instance of CIDAggregateBeacon.
   * @param {BeaconService} service The service of the Beacon.
   * @param {?BeaconSidecarData} [sidecar] The sidecar data of the Beacon.
   */
  constructor(service: BeaconService, sidecar?: BeaconSidecarData<CIDAggregateSidecar>) {
    super({ ...service, type: 'CIDAggregateBeacon' }, sidecar);
  }
  get service(): BeaconService {
    return {
      type            : this.type,
      id              : this.id,
      serviceEndpoint : this.serviceEndpoint
    };
  }


  /**
   * TODO: Finish implementation
   *
   * Implements {@link https://dcdpr.github.io/did-btcr2/#establish-cidaggregate-beacon | 5.2.1 Establish CIDAggregate Beacon}.
   *
   * To establish a CIDAggregatorBeacon, a cohort of cooperating parties SHOULD generate an n-of-n P2TR Bitcoin address
   * where each party contributes a public key. Furthermore, each party SHOULD verify that their key is part of the
   * address and all other keys that are part of the address are keys with controllers able to produce valid signatures.
   * To establish a Beacon there are two roles. One is the cohort participant, they want to join a Beacon cohort and
   * submit a request to do so with a key and proof of control over that key. The other is the Beacon coordinator, they
   * advertise and curate Beacon cohorts by combining Beacon participants into cohorts, verifying proofs of control, and
   * producing Beacon addresses.
   *
   * @param {string} id The identifier of the Beacon.
   * @param {string} type The type of the Beacon.
   * @param {DidServiceEndpoint} serviceEndpoint The service endpoint of the Beacon.
   * @returns {CIDAggregateBeacon} The established CIDAggregate Beacon.
   */
  static establish(id: string, type: string, serviceEndpoint: DidServiceEndpoint): CIDAggregateBeacon {
    return new CIDAggregateBeacon({ id, type, serviceEndpoint });
  }


  /**
   * TODO: Figure out if this is necessary or not.
   * @param {string} didUpdatePayload The DID Update Payload to generate the signal for.
   * @returns {BeaconSignal} The generated signal.
   * @throws {MethodError} if the signal is invalid.
   */
  generateSignal(didUpdatePayload: string): BeaconSignal {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, {didUpdatePayload});
  }


  /**
   * TODO: Finish implementation
   *
   * Implements {@link https://dcdpr.github.io/did-btcr2/#process-cidaggregate-beacon-signal | 5.2.3 Process CIDAggregate Beacon Signal}.
   *
   * A Beacon Signal from a CIDAggregate Beacon is a Bitcoin transaction that contains the hashBytes of a DID Update
   * Bundle in its first transaction output. The corresponding DID Update Bundle MUST either be provided through Sidecar
   * Data or by converting hashBytes into a IPFS v1 Content Identifier and attempting to retrieve it from Content
   * Addressable Storage. The DID Update Bundle maps from did:btcr2 identifiers to hashes of DID Update payloads
   * applicable for that identifier. Again this algorithm attempts to retrieve and validate the DID Update Payload
   * identified for the identifier being resolved. If successful, the DID Update Payload is returned.
   *
   * The Process CIDAggregate Beacon Signal algorithm is called by the Process Beacon Signals algorithm as part of the
   * Read operation.
   *
   * It takes as inputs a did:btcr2 identifier, Identifier, a Beacon Signal, tx, and a optional
   * object, signalSidecarData, containing any sidecar data provided to the resolver for the Beacon Signal identified by
   * the Bitcoin transaction identifier.
   *
   * It returns the DID Update payload announced by the Beacon Signal for the
   * did:btcr2 identifier being resolved or throws an error.
   *
   * @param {RawTransactionV2} signal Bitcoin transaction representing a Beacon Signal.
   * @param {SignalsMetadata} signalsMetadata Optional sidecar data for the Beacon Signal.
   * @returns {Promise<DidUpdatePayload | undefined>} The DID Update payload announced by the Beacon Signal.
   * @throws {DidError} if the signalTx is invalid or the signalsMetadata is invalid.
   */
  processSignal(signal: RawTransactionV2, signalsMetadata: SignalsMetadata): Promise<DidUpdateInvocation | undefined> {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, {signal, signalsMetadata});
  }

  /**
   * TODO: Finish implementation
   *
   * Implements {@link https://dcdpr.github.io/did-btcr2/#broadcast-cidaggregate-beacon-signal | 5.2.2 Broadcast CIDAggregate Beacon Signal}.
   *
   * The Broadcast CIDAggregate Beacon Signal algorithm involving two roles: a set of cohort participants and a Beacon
   * coordinator. The Beacon coordinator collects individual DID Update Payload Content Identifiers (CIDs) for specific
   * did:btcr2 idntifiers and aggregates them into a DID Update Bundle, which is then published to a Content Addressable
   * Storage (CAS). The CID for the DID Update Bundle is included in a Partially Signed Bitcoin Transaction (PSBT) transaction
   * output spent from the Beacon’s n-of-n address. Each of the n cohort participants in the Beacon MUST sign the
   * transaction before it can be broadcast to the network. It is RECOMMENDED that cohort participants keep a copy of
   * the DID Update Bundle and separately pin it to the CAS.
   *
   * @param {DidUpdatePayload} didUpdatePayload The verificationMethod object to be used for signing.
   * @returns {SignalsMetadata} Successful output of a bitcoin transaction.
   * @throws {SingletonBeaconError} if the bitcoin address is invalid or unfunded.
   */
  broadcastSignal(didUpdatePayload: DidUpdatePayload): Promise<SignalsMetadata> {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, didUpdatePayload);
  }

  /**
   * TODO: Finish implementation
   *
   * 5.2.1.1 Create CIDAggregate Beacon Advertisement
   * Any entity MAY act in the role of Beacon coordinator, creating a Beacon advertisement that they can broadcast across any medium. A Beacon advertisement specifies the properties of the Beacon that
   * the coordinator intends to establish, including the Beacon Type, cohort size, update frequency, and response latency. Once the advertisement has been created and broadcast, the coordinator waits
   * for enough participants to opt in before establishing the Beacon.
   *
   * 5.2.1.2 CIDAggregate Beacon Opt-in
   * DID controllers who wish to participate in a Beacon cohort first find potential Beacon advertisements that meet their needs. This includes checking the Beacon terms and update frequency, etc. If
   * satisfied, they create a secp256k1 cohort keypair and send an Opt-In request to the endpoint specified in the advertisement.
   *
   * 5.2.1.3 Cohort Set
   * Once a Beacon Aggregator has received enough opt-in responses from participants to satisfy the Beacon properties, they generate the n-of-n P2TR Bitcoin address for the Beacon. The address and all
   * the cohort public keys the address is constructed from are then sent to all participants in a CohortSet message.
   *
   * 5.2.1.4 Add Beacon Service Endpoint to DID Document
   * A participant receiving a CohortSet message first verifies their cohort key is included in the cohort, then calculates the P2TR Beacon address for themselves and verifies it matches the address
   * provided. They MAY wait until the Beacon address is funded before adding the Beacon as a service in the DID document. The following is an example of the Beacon service endpoint the DID controller
   * adds into their DID document, the Beacon address is converted into a URI following BIP21:
   * {
   *    "id": "#cidAggregateBeacon",
   *    "type": "CIDAggregateBeacon",
   *    "serviceEndpoint": "bitcoin:tb1pfdnyc8vxeca2zpsg365sn308dmrpka4e0n9c5axmp2nptdf7j6ts7eqhr8"
   * }
   */
}
