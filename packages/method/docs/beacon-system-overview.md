# How the Beacon System Works Together

The system has two sides: **announce** (write path) and **resolve** (read path). They're connected by what goes on-chain and what goes in sidecar data.

---

## The Three Beacon Types

Each beacon type differs in what it commits to the blockchain and how many DIDs it can serve per transaction:

| | Singleton | CAS | SMT |
|---|---|---|---|
| **Scope** | 1 DID per TX | N DIDs per TX | N DIDs per TX |
| **OP_RETURN** | `hash(canonicalize(signedUpdate))` | `hash(canonicalize(announcement))` | `tree.rootHash` |
| **Sidecar** | `SignedBTCR2Update` | CAS Announcement + updates | SMT Proof + updates |
| **Verification** | Hash match | Hash match | SMT proof |
| **Signing** | Single-party PSBT | Single-party PSBT | MuSig2 multi-party |

The on-chain footprint is always the same: one OP_RETURN output with 32 bytes. The difference is in how many DID updates those 32 bytes commit to.

---

## Announce Path: Single-Party (Singleton & CAS)

Both `SingletonBeacon.broadcastSignal()` and `CASBeacon.broadcastSignal()` follow the same PSBT pattern:

1. Compute signal bytes (update hash or announcement hash)
2. Fetch the most recent UTXO at the beacon address
3. Build a PSBT: input = beacon UTXO, output 0 = change, output 1 = OP_RETURN
4. Sign with the beacon address key via ECDSA
5. Broadcast

`SMTBeacon.broadcastSignal()` does the same thing but builds a single-entry `BTCR2MerkleTree` first to get the root hash as signal bytes. This is the single-party path for SMT -- when a DID owner operates their own SMT beacon without aggregation.

---

## Announce Path: Multi-Party Aggregation

This is where the coordinator/participant protocol comes in. The aggregation flow has four phases:

### Phase 1 -- Cohort Formation (Keygen)

```
Coordinator                          Participant
    |                                    |
    |--- BEACON_COHORT_ADVERT --------->|  (cohortId, minParticipants, network, beaconType)
    |                                    |  participant opts in with its signer key
    |<-- BEACON_COHORT_OPT_IN ---------|  (participantPk)
    |                                    |
    |  (when minParticipants reached)    |
    |  finalizeKeygen(cohortId)          |
    |  -> sorts keys, computes the       |
    |    script-tree P2TR address        |
    |                                    |
    |--- BEACON_COHORT_READY ---------->|  (cohortKeys, beaconAddress)
    |                                    |  participant checks keys, address, and beacon type
```

A participant uses the key of its signer for every cohort. Two cohorts with the same cohort keys, fallback threshold (k), recovery key, recovery sequence, funding model, and network have the same beacon address. A beacon address must have one beacon type. Thus the participant refuses a cohort at the beacon address of another of its cohorts with another beacon type (BEACON_TYPE_CONFLICT). This check knows only the cohorts of one participant object.

The beacon address is a Taproot output. Its internal key is the MuSig2 aggregate of the cohort keys. Its script tree holds the k-of-n fallback leaf and the CSV recovery leaf. The prevout script of a beacon transaction must be this output script (`cohort.beaconScript`).

### Phase 2 -- Update Collection

```
Coordinator                          Participant
    |                                    |
    |<-- SUBMIT_UPDATE ----------------|  (cohortId, updateHash)
    |                                    |
    | cohort.addUpdate(from, updateHash) |
    |  (repeats for each participant)    |
    |                                    |
    |  When all collected:               |
    |  cohort.buildCASAnnouncement()     |
    |    or cohort.buildSMTTree()        |
```

A participant sends only the `updateHash` of its update, not the update (ADR 168). The coordinator checks only that the `updateHash` is a string that decodes to exactly 32 bytes.

For CAS: the `updateHash` is the JSON Document Hash of the update. `buildCASAnnouncement()` makes a map of each DID to its `updateHash`, then sets `signalBytes = hash(canonicalize(announcement))`. A participant with no update sends `SUBMIT_NONINCLUDED` and is absent from the map.

For SMT: the participant makes a 256-bit nonce for each round and keeps it. Its `updateHash` is the leaf value: `hash(hash(nonce) + updateId)` for an update, or `hash(hash(nonce))` for no update. The `updateId` is the JSON Document Hash of the update. Thus the coordinator does not get the nonce, and it cannot tell an update from no update.

`buildSMTTree()` puts each `updateHash` at the index `hash(did)` of the sender, and sets `signalBytes` to the root. Each proof has `id`, `collapsed`, and `hashes`, but no `nonce` and no `updateId`. The index stays empty for a `SUBMIT_NONINCLUDED`, or for a value equal to `cachedZero[0]`.

### Phase 3 -- Validation

```
Coordinator                          Participant
    |                                    |
    |--- DISTRIBUTE_DATA -------------->|  (beaconType, signalBytesHex, casAnnouncement/smtProof)
    |                                    |
    |                                    |  CAS: verify announcement[myDid] == hash(myUpdate)
    |                                    |  SMT: add own nonce and updateId to the proof, then verify it
    |                                    |
    |<-- VALIDATION_ACK ----------------|  (approved: true/false)
    |                                    |
    |  cohort.addValidation(from, ok)    |
    |  When all approved -> VALIDATED    |
```

This is the trust gate. Each participant independently verifies that the aggregated data correctly includes their update before signing the transaction.

### Phase 4 -- MuSig2 Signing

```
Coordinator                          Participant
    |                                    |
    |  buildAggregationBeaconTx(opts)    |
    |  -> fetches beacon UTXO            |
    |  -> builds TX: input + change +    |
    |    OP_RETURN(signalBytes)          |
    |  startSigning: prevout script must |
    |    be the beacon script            |
    |                                    |
    |--- AUTHORIZATION_REQUEST -------->|  (pendingTx, sessionId)
    |                                    |  refuses a prevout script that is
    |                                    |    not the beacon script
    |                                    |  creates signing session
    |<-- NONCE_CONTRIBUTION ------------|  (musig2 nonce)
    |                                    |
    |  session.generateAggregatedNonce() |
    |                                    |
    |--- AGGREGATED_NONCE ------------->|
    |                                    |  session.generatePartialSignature(sk)
    |<-- SIGNATURE_AUTHORIZATION -------|  (partial sig)
    |                                    |
    |  session.generateFinalSignature()  |
    |  -> partialSigAgg([...sigs])       |
    |                                    |
    |  broadcastSignedTransaction()      |
    |  -> setWitness(0, [signature])     |
    |  -> broadcast to Bitcoin network   |
```

The final transaction has a Taproot key-path witness: a single 64-byte Schnorr signature that is the MuSig2 aggregate of all participants' partial signatures. On-chain, this looks identical to a single-signer Taproot spend.

---

## Resolve Path

The resolver is a sans-I/O state machine. It never touches the network -- the caller drives it:

```typescript
const resolver = DidBtcr2.resolve(did, { sidecar });
let state = resolver.resolve();

while (state.status === 'action-required') {
  for (const need of state.needs) {
    switch (need.kind) {
      case 'NeedBeaconSignals':
        // Query Bitcoin for OP_RETURN signals at beacon addresses
        const signals = await BeaconSignalDiscovery.indexer(need.services, bitcoin);
        resolver.provide(need, signals);
        break;
      case 'NeedCASAnnouncement':
        // Fetch from IPFS or sidecar
        resolver.provide(need, announcement);
        break;
      case 'NeedSMTProof':
        // Fetch from sidecar or proof server
        resolver.provide(need, smtProof);
        break;
      case 'NeedSignedUpdate':
        // Fetch from sidecar or CAS
        resolver.provide(need, signedUpdate);
        break;
    }
  }
  state = resolver.resolve();
}
// state.status === 'resolved' -> state.result is the DID document
```

Each beacon's `processSignals()` follows the same contract -- returns `{ updates, needs }` -- but the internal logic differs:

**Singleton:** Signal bytes (hex) -> direct `updateMap` lookup. One indirection.

**CAS:** Signal bytes (hex) -> `casMap` lookup -> decode the value of `announcement[did]` to hex (`update_hash`) -> `updateMap` lookup. An announcement with no entry for the DID announces no update. A value for the DID that does not decode to 32 bytes raises `MISSING_UPDATE_DATA` (ADR 146). An entry of another DID has no effect. An announcement that is not a JSON object is not available: `MISSING_UPDATE_DATA` (ADR 160). Two indirections.

**SMT:** Signal bytes (hex) -> `smtMap` lookup by root hash (the key is the hex of the decoded `id`) -> the decoded `id` of the proof must equal the root -> verify the proof (`verifyProof(proof, did)`) -> a proof with no `updateId` announces no update -> decode `proof.updateId` to hex -> `updateMap` lookup. Two indirections plus cryptographic verification.

The SMT proof verification (spec section SMT Proof Verification) selects the leaf value from the `nonce` and `updateId` fields of the proof: `hash(hash(nonce) || updateId)`, `hash(hash(nonce))`, `updateId`, or the value of an empty leaf. It walks the sparse Merkle tree path from the leaf to confirm that it produces the on-chain root. A proof whose decoded `id` is not the root raises `INVALID_SIGNAL_DATA`. A proof that does not verify, also a proof whose other fields do not decode, raises `INVALID_SIGNAL_DATA`. This is the only beacon type that requires cryptographic verification at resolve time -- Singleton and CAS rely on the hash commitment being unforgeable.

`Resolver.sidecarData` ignores a sidecar proof whose `id` does not decode to 32 bytes. For a beacon signal that needs the proof, `SMTBeacon.processSignals` emits `NeedSMTProof`. For a pad-bit `id`, `provide(NeedSMTProof)` raises `MISSING_UPDATE_DATA`. `SMTBeacon.processSignals` treats a pad-bit proof in a caller-built map as absent. On those two paths, another `id` that does not decode raises `INVALID_SIGNAL_DATA` (ADR 146).

---

## Spec Conformance

**Resolution (spec [Find Beacon Signals](https://dcdpr.github.io/did-btcr2/operations/resolve.html#find-beacon-signals)):** Each beacon type implements the spec's "Process [Type] Beacon" algorithm:
- Singleton: signal bytes -> update hash -> lookup. Direct match to spec.
- CAS: signal bytes -> announcement hash -> lookup announcement -> extract DID entry -> lookup update. Matches spec's two-phase CAS lookup.
- SMT: signal bytes -> root hash -> lookup proof -> verify inclusion -> extract updateId -> lookup update. Matches spec's proof verification requirement that only SMT beacons perform Merkle verification.

**Announcement (spec [Announce DID Update](https://dcdpr.github.io/did-btcr2/operations/update.html#announce-did-update)):** The `broadcastSignal()` methods construct transactions per spec: spend beacon UTXO, OP_RETURN with signal bytes, change output back to beacon address. The beacon address chain acts as the append-only signal log.

**Aggregation:** The coordinator/participant protocol implements the spec's multi-party beacon coordination:
- Cohort formation with Taproot MuSig2 addresses
- Update collection with per-participant validation
- CAS builds a DID->hash announcement map; SMT builds a Merkle tree with per-DID proofs
- MuSig2 signing produces a standard Taproot key-path spend (indistinguishable from single-signer on-chain)

**Key property:** The resolve path is completely agnostic to whether the beacon signal was produced by a single party or by aggregation. A Taproot key-path spend looks the same either way. The resolver only cares about what's in the OP_RETURN and the sidecar -- it never needs to know how many parties signed the transaction.

---

## Usage Example: Runner Layer (recommended)

The runner layer handles message routing, callback orchestration, and event emission.
See `docs/aggregation.md` for the full API reference.

```typescript
import {
  AggregationServiceRunner,
  AggregationParticipantRunner,
  NostrTransport,
} from '@did-btcr2/aggregation';
import { getNetwork } from '@did-btcr2/bitcoin';
import { SchnorrKeyPair } from '@did-btcr2/keys';
import { buildAggregationBeaconTx, DidBtcr2 } from '@did-btcr2/method';

// --- Service Setup ---
const serviceKeys = SchnorrKeyPair.generate();
const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
const transport = new NostrTransport({ relays: ['wss://relay.example'] });

// onProvideTxData reads `service`. The runner calls onProvideTxData only after
// the constructor returns.
const service: AggregationServiceRunner = new AggregationServiceRunner({
  transport,
  did    : serviceDid,
  keys   : serviceKeys,
  config : {
    minParticipants  : 2,
    network          : 'mutinynet',
    beaconType       : 'CASBeacon',
    recoveryKey      : recoveryKeyHex, // x-only operator recovery key, 64 hex characters
    recoverySequence : 144,            // blocks (BIP-68) before the recovery leaf is spendable
  },
  onProvideTxData : async ({ cohortId, beaconAddress, signalBytes, feeEstimator }) => {
    // Build the Bitcoin transaction for MuSig2 signing. The transaction must
    // spend the beacon output. buildAggregationBeaconTx finds a UTXO at
    // beaconAddress and puts signalBytes in the last output (OP_RETURN).
    const cohort = service.session.getCohort(cohortId)!;
    return await buildAggregationBeaconTx({
      beaconAddress,
      internalPubkey : cohort.internalKey,
      signalBytes,
      bitcoin,                   // a BitcoinConnection
      network        : getNetwork(cohort.network),
      feeEstimator,
    });
  },
});

service.on('keygen-complete', ({ beaconAddress }) => console.log('Beacon:', beaconAddress));
service.on('signing-complete', ({ signature }) => console.log('Signed:', signature.length, 'bytes'));

const result = await service.run();
// result.signature = 64-byte Schnorr signature
// result.signedTx  = Bitcoin Transaction ready for broadcast
```

```typescript
// --- Participant Setup ---
const aliceKeys = SchnorrKeyPair.generate();
const aliceDid = DidBtcr2.create(aliceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
const aliceTransport = new NostrTransport({ relays: ['wss://relay.example'] });

const alice = new AggregationParticipantRunner({
  transport       : aliceTransport,
  did             : aliceDid,
  keys            : aliceKeys,
  shouldJoin      : async (advert) => advert.beaconType === 'CASBeacon',
  onProvideUpdate : async ({ beaconAddress }) => {
    // Build a signed update that adds the beacon address to the DID document
    return mySignedUpdate;
  },
});

alice.on('cohort-ready', ({ beaconAddress }) => console.log('Beacon:', beaconAddress));
alice.on('cohort-complete', () => console.log('Done'));

await alice.start(); // Long-running - listens for cohort adverts
```

The runners drive the full 4-step protocol automatically. The caller only needs to supply callbacks for decisions (should I join this cohort? what update should I submit? what transaction data should the signing session use?).
