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
| **Verification** | Hash match | Hash match | Merkle inclusion proof |
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
    |                                    |  participant derives HD key for cohort
    |<-- BEACON_COHORT_OPT_IN ---------|  (participantPk)
    |                                    |
    |  (when minParticipants reached)    |
    |  cohort.finalize()                 |
    |  -> sorts keys, computes Taproot   |
    |    multisig address via p2tr()     |
    |                                    |
    |--- BEACON_COHORT_READY ---------->|  (cohortKeys, beaconAddress)
    |                                    |  participant validates keys match
```

Each participant derives a fresh BIP-32 child key per cohort. The beacon address is a Taproot key-path spend address derived from the MuSig2 aggregate of all cohort public keys.

### Phase 2 -- Update Collection

```
Coordinator                          Participant
    |                                    |
    |<-- SUBMIT_UPDATE ----------------|  (cohortId, signedUpdate)
    |                                    |
    |  cohort.addUpdate(from, update)    |
    |  (repeats for each participant)    |
    |                                    |
    |  When all collected:               |
    |  cohort.buildCASAnnouncement()     |
    |    or cohort.buildSMTTree()        |
```

For CAS: `buildCASAnnouncement()` creates a `{ did -> canonicalHash(signedUpdate) }` map, then sets `signalBytes = hash(canonicalize(announcement))`.

For SMT: `buildSMTTree()` creates a `BTCR2MerkleTree` with one entry per participant `{ did, nonce, signedUpdate }`, calls `tree.finalize()`, generates per-participant serialized proofs, and sets `signalBytes = tree.rootHash`.

### Phase 3 -- Validation

```
Coordinator                          Participant
    |                                    |
    |--- DISTRIBUTE_DATA -------------->|  (beaconType, signalBytesHex, casAnnouncement/smtProof)
    |                                    |
    |                                    |  CAS: verify announcement[myDid] == hash(myUpdate)
    |                                    |  SMT: verify Merkle proof includes myUpdate
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
    |  buildBeaconTransaction(cohortId)  |
    |  -> fetches beacon UTXO            |
    |  -> builds TX: input + change +    |
    |    OP_RETURN(signalBytes)          |
    |                                    |
    |--- AUTHORIZATION_REQUEST -------->|  (pendingTx, sessionId)
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

**Singleton:** Signal bytes (hex) -> decode to base64url -> direct `updateMap` lookup. One indirection.

**CAS:** Signal bytes (hex) -> decode to base64url -> `casMap` lookup -> extract `announcement[did]` -> `updateMap` lookup. Two indirections.

**SMT:** Signal bytes (hex) -> `smtMap` lookup by root hash -> verify Merkle proof (`verifySerializedProof(proof, didToIndex(did), candidateHash)`) -> decode `proof.updateId` to base64url -> `updateMap` lookup. Two indirections plus cryptographic verification.

The SMT proof verification (spec section SMT Proof Verification) computes the candidate leaf hash as `hash(hash(nonce) || updateId)` and walks the sparse Merkle tree path to confirm it produces the on-chain root. This is the only beacon type that requires cryptographic verification at resolve time -- Singleton and CAS rely on the hash commitment being unforgeable.

---

## Spec Conformance

**Resolution (spec section 7.2.e.1):** Each beacon type implements the spec's "Process [Type] Beacon" algorithm:
- Singleton: signal bytes -> update hash -> lookup. Direct match to spec.
- CAS: signal bytes -> announcement hash -> lookup announcement -> extract DID entry -> lookup update. Matches spec's two-phase CAS lookup.
- SMT: signal bytes -> root hash -> lookup proof -> verify inclusion -> extract updateId -> lookup update. Matches spec's proof verification requirement that only SMT beacons perform Merkle verification.

**Announcement (spec section 8.2):** The `broadcastSignal()` methods construct transactions per spec: spend beacon UTXO, OP_RETURN with signal bytes, change output back to beacon address. The beacon address chain acts as the append-only signal log.

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
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import {
  AggregationServiceRunner,
  AggregationParticipantRunner,
  DidBtcr2,
  NostrTransport,
} from '@did-btcr2/method';

// --- Service Setup ---
const serviceKeys = SchnorrKeyPair.generate();
const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
const transport = new NostrTransport({ relays: ['wss://relay.example'] });

const service = new AggregationServiceRunner({
  transport,
  did    : serviceDid,
  keys   : serviceKeys,
  config : { minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' },
  onProvideTxData: async ({ beaconAddress, signalBytes }) => {
    // Build the Bitcoin transaction for MuSig2 signing
    // (fetch UTXO, construct PSBT with OP_RETURN, return tx + prevout data)
    return { tx, prevOutScripts: [...], prevOutValues: [...] };
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

await alice.start(); // Long-running — listens for cohort adverts
```

The runners drive the full 4-step protocol automatically. The caller only needs to supply callbacks for decisions (should I join this cohort? what update should I submit? what transaction data should the signing session use?).
