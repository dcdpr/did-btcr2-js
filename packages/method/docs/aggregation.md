# Aggregation

Multi-party coordination for aggregated BTCR2 updates, implementing the [Aggregate Beacon protocol](https://dcdpr.github.io/did-btcr2/beacons/aggregate-beacons.html).

This guide is a step-by-step walkthrough. If you've never used the aggregation subsystem before, read it top to bottom. If you already know what you're doing, jump to the [Service Step-by-Step](#service-step-by-step) or [Participant Step-by-Step](#participant-step-by-step) sections.

---

## Table of Contents

1. [What Aggregation Solves](#what-aggregation-solves)
2. [Spec Roles and Class Mapping](#spec-roles-and-class-mapping)
3. [Two-Layer Architecture](#two-layer-architecture)
4. [Setting Up the Transport](#setting-up-the-transport)
5. [Service Step-by-Step](#service-step-by-step)
6. [Participant Step-by-Step](#participant-step-by-step)
7. [Decision Callbacks Reference](#decision-callbacks-reference)
8. [Events Reference](#events-reference)
9. [Error Handling](#error-handling)
10. [Power-User: State Machine Layer](#power-user-state-machine-layer)
11. [Running the E2E Demos](#running-the-e2e-demos)
12. [Production Deployment Notes](#production-deployment-notes)

---

## What Aggregation Solves

Without aggregation, every BTCR2 DID update has to be broadcast individually as its own Bitcoin transaction via a Singleton Beacon. That doesn't scale: every DID controller pays Bitcoin fees for every update, and the chain fills up with one-shot transactions.

Aggregation lets a coordinator (the **Aggregation Service**) batch updates from many DID controllers (the **Aggregation Participants**) into a single Bitcoin transaction. All participants jointly sign that transaction using **MuSig2** — an n-of-n Schnorr aggregation scheme — so the on-chain footprint is just one signature regardless of how many participants joined.

The result: every participant's DID update is committed on-chain, but the cost and bandwidth are amortized across the cohort.

---

## Spec Roles and Class Mapping

The [spec](https://dcdpr.github.io/did-btcr2/beacons/aggregate-beacons.html) defines three roles:

| Spec Role | Description | Runner Class | State Machine Class |
|---|---|---|---|
| **Aggregation Service** | Coordinator that runs the protocol and broadcasts the final tx | `AggregationServiceRunner` | `AggregationService` |
| **Aggregation Participant** | DID controller submitting an update | `AggregationParticipantRunner` | `AggregationParticipant` |
| **Aggregation Cohort** | The group of accepted participants | (data) | `AggregationCohort` |

Two beacon types are supported:

- **`CASBeacon`** — Aggregated updates form a CAS Announcement Map (DID → updateHash). The service publishes the map to a Content-Addressed Store (e.g., IPFS) and commits its hash on-chain.
- **`SMTBeacon`** — Aggregated updates form a Sparse Merkle Tree. The SMT root is committed on-chain; participants get individual Merkle proofs.

---

## Two-Layer Architecture

The aggregation subsystem is built in two layers, both public:

```
┌────────────────────────────────────────────────────┐
│  Runner layer (default API)                        │
│  - AggregationServiceRunner                        │
│  - AggregationParticipantRunner                    │
│  - Wires Transport to state machine                │
│  - Decision callbacks + progress events            │
│  - Use this 95% of the time                        │
└────────────────────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────┐
│  State machine layer (advanced)                    │
│  - AggregationService (sans-I/O)                   │
│  - AggregationParticipant (sans-I/O)               │
│  - Pure logic, explicit action methods             │
│  - Use for tests, custom transports, debugging     │
└────────────────────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────┐
│  Transport layer (pluggable)                       │
│  - Transport interface                             │
│  - NostrTransport (production)                     │
│  - DidCommTransport (stub)                         │
│  - MockTransport (in tests)                        │
└────────────────────────────────────────────────────┘
```

**Pick the Runner unless you have a reason not to.** It's the default API. The state machine layer exists so the protocol logic stays testable in isolation and so you can build your own integrations on top.

---

## Setting Up the Transport

Every actor (service or participant) needs a `Transport` to send and receive messages. The shipped `NostrTransport` uses Nostr relays as the wire protocol.

A single `Transport` instance can serve multiple registered actors. In production each process typically registers exactly one actor (its own identity); in tests one transport often serves several actors at once for easy in-process round-trips.

```typescript
import { NostrTransport } from '@did-btcr2/method';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { DidBtcr2 } from '@did-btcr2/method';

// 1. Generate identity
const keys = SchnorrKeyPair.generate();
const did = DidBtcr2.create(keys.publicKey.compressed, {
  idType  : 'KEY',
  network : 'mutinynet',
});

// 2. Create transport pointing at one or more Nostr relays
const transport = new NostrTransport({
  relays: ['wss://relay.damus.io', 'wss://nos.lol'],
});

// 3. Register the actor (DID + keys) with the transport
transport.registerActor(did, keys);

// 4. Open relay connections
transport.start();
```

That's the entire transport setup. From here on, you only interact with the Runner — the transport is plumbing.

---

## Service Step-by-Step

The service is the coordinator. It creates a cohort, advertises it, accepts participants, finalizes keygen, distributes aggregated data, and drives MuSig2 signing.

### Step 1 — Construct the runner

```typescript
import { AggregationServiceRunner } from '@did-btcr2/method';

const runner = new AggregationServiceRunner({
  transport,                     // from previous section
  did       : serviceDid,
  keys      : serviceKeys,

  config: {
    minParticipants : 2,
    network         : 'mutinynet',
    beaconType      : 'CASBeacon',
  },

  // REQUIRED: provide the Bitcoin transaction to be MuSig2-signed
  onProvideTxData: async ({ cohortId, beaconAddress, signalBytes }) => {
    // In production: query Bitcoin for a UTXO at beaconAddress, build a tx
    // that spends it with an OP_RETURN containing signalBytes.
    return await buildBeaconTransaction(beaconAddress, signalBytes, bitcoin);
  },
});
```

The `config` object follows the spec's "Aggregation Cohort definition" — at minimum you need participant count, network, and beacon type. Optional fields (max participants, time windows, fees) can be added in your `onOptInReceived` and `onReadyToFinalize` callbacks.

### Step 2 — Subscribe to events (optional)

Events are useful for logging, UI updates, or driving side-effects:

```typescript
runner.on('cohort-advertised', ({ cohortId }) => console.log('advertised', cohortId));
runner.on('opt-in-received',   (optIn)        => console.log('opt-in from', optIn.participantDid));
runner.on('participant-accepted', ({ participantDid }) => console.log('accepted', participantDid));
runner.on('keygen-complete',   ({ beaconAddress })     => console.log('beacon:', beaconAddress));
runner.on('update-received',   ({ participantDid })    => console.log('update from', participantDid));
runner.on('data-distributed',  ()                      => console.log('aggregated data sent'));
runner.on('validation-received', ({ participantDid, approved }) => console.log(participantDid, approved));
runner.on('signing-started',   ()  => console.log('starting MuSig2'));
runner.on('nonce-received',    ({ participantDid }) => console.log('nonce from', participantDid));
runner.on('signing-complete',  (result) => console.log('signature:', result.signature));
runner.on('error',             (err)    => console.error(err));
```

Subscribing is purely optional. Skipping events doesn't change the protocol — they're a side channel for observability.

### Step 3 — Run the protocol to completion

```typescript
const result = await runner.run();
console.log('Final signature:', result.signature);
console.log('Signed tx hex:',   result.signedTx.toHex());
console.log('Cohort id:',       result.cohortId);
```

`runner.run()` returns a Promise that resolves with the final aggregation result once the MuSig2 signing session completes. That's it — internally it has just driven the cohort through all four spec steps.

### What `run()` actually does internally

So you understand what's happening behind the scenes:

1. **Cohort Formation (spec Step 1)**
   - Creates an `AggregationCohort` and emits `cohort-advertised`
   - Sends a `COHORT_ADVERT` broadcast over the transport
   - For each incoming `COHORT_OPT_IN` message:
     - Calls `onOptInReceived(optIn)` — your decision callback
     - If accepted, registers the peer's communication key, sends `COHORT_OPT_IN_ACCEPT`, emits `participant-accepted`
   - Once `minParticipants` is reached, calls `onReadyToFinalize` — your decision callback
   - If `finalize: true`, computes the n-of-n MuSig2 Taproot beacon address, sends `COHORT_READY` to all participants, emits `keygen-complete`

2. **Update Submission (spec Step 2)**
   - For each incoming `SUBMIT_UPDATE` message: calls `session.receive()` and emits `update-received`
   - Once all participants have submitted, the cohort phase becomes `UpdatesCollected`

3. **Aggregate & Validate (spec Step 3)**
   - Builds the CAS Announcement Map (or SMT tree, depending on `beaconType`)
   - Sends `DISTRIBUTE_AGGREGATED_DATA` to all participants, emits `data-distributed`
   - For each incoming `VALIDATION_ACK`: tracks approval, emits `validation-received`
   - Once all participants approve, calls `onProvideTxData` — your data callback
   - Sends `AUTHORIZATION_REQUEST` to all participants with the unsigned tx, emits `signing-started`

4. **Signing & Broadcast (spec Step 4)**
   - For each incoming `NONCE_CONTRIBUTION`: tracks the nonce, emits `nonce-received`
   - Once all nonces are in, sends the aggregated nonce back via `AGGREGATED_NONCE`
   - For each incoming `SIGNATURE_AUTHORIZATION` (a partial signature): adds it to the session
   - Once all partial signatures are in, generates the final 64-byte Schnorr signature, attaches it to the tx, emits `signing-complete`, and resolves `run()`

You can broadcast the resulting signed transaction yourself using `result.signedTx.toHex()` — the runner doesn't broadcast for you (that's a transport-layer concern outside its scope).

---

## Participant Step-by-Step

The participant joins cohorts advertised by services, submits its own DID update, validates the aggregated data, and contributes its share of the MuSig2 signature.

### Step 1 — Construct the runner

```typescript
import { AggregationParticipantRunner, Resolver, Update } from '@did-btcr2/method';

const runner = new AggregationParticipantRunner({
  transport,                    // from the transport setup section
  did  : myDid,
  keys : myKeys,

  // Filter discovered cohorts. Default rejects all — you MUST override this.
  shouldJoin: async (advert) => advert.beaconType === 'CASBeacon' && advert.network === 'mutinynet',

  // REQUIRED: build and sign an update for the cohort's beacon
  onProvideUpdate: async ({ cohortId, beaconAddress }) => {
    // Resolve the current document, then construct an update that adds
    // the cohort's beacon address as a CASBeacon service entry.
    const doc = Resolver.deterministic({
      genesisBytes : myKeys.publicKey.compressed,
      hrp          : 'k',
      idType       : 'KEY',
      version      : 1,
      network      : 'mutinynet',
    });

    const unsigned = Update.construct(doc, [{
      op    : 'add',
      path  : '/service/-',
      value : {
        id              : `${myDid}#beacon-cas`,
        type            : 'CASBeacon',
        serviceEndpoint : `bitcoin:${beaconAddress}`,
      }
    }], 1);

    return Update.sign(myDid, unsigned, doc.verificationMethod![0], myKeys.raw.secret!);
  },
});
```

Two callbacks are required for the participant:
- **`shouldJoin`** — filter which cohorts to join. Default is "reject everything"; you MUST override it.
- **`onProvideUpdate`** — build the BTCR2 update you want included in the aggregated batch.

Two more callbacks are optional:
- **`onValidateData`** — approve/reject aggregated data. Default approves if the data correctly includes your update.
- **`onApproveSigning`** — approve/reject the actual signing. Default approves.

### Step 2 — Subscribe to events (optional)

```typescript
runner.on('cohort-discovered',  (advert)             => console.log('found:', advert.cohortId));
runner.on('cohort-joined',      ({ cohortId })       => console.log('joined:', cohortId));
runner.on('cohort-ready',       ({ beaconAddress }) => console.log('beacon:', beaconAddress));
runner.on('update-submitted',   ({ cohortId })       => console.log('update sent'));
runner.on('validation-requested', (info)             => console.log('validating', info.cohortId));
runner.on('signing-requested',  (req)                => console.log('signing requested', req.sessionId));
runner.on('cohort-complete',    ({ beaconAddress }) => console.log('done:', beaconAddress));
runner.on('cohort-failed',      ({ reason })         => console.error('failed:', reason));
runner.on('error',              (err)                => console.error(err));
```

### Step 3 — Start the runner

Unlike the service, the participant runner is **long-running**. It listens indefinitely for new cohort adverts and processes each accepted cohort in parallel.

```typescript
await runner.start();
// runner is now listening — control returns immediately
// Cohort processing happens via callbacks and events as messages arrive
```

To stop the runner cleanly:

```typescript
runner.stop();
```

### Step 3b — One-shot mode

For tests, demos, or scripts that should exit after joining a single cohort, use the `joinFirst` static helper:

```typescript
const result = await AggregationParticipantRunner.joinFirst({
  transport,
  did             : myDid,
  keys            : myKeys,
  shouldJoin      : async (advert) => advert.serviceDid === expectedServiceDid,
  onProvideUpdate : async ({ beaconAddress }) => buildAndSignUpdate(beaconAddress),
});

console.log(`Joined cohort ${result.cohortId}, beacon: ${result.beaconAddress}`);
```

`joinFirst` waits for a matching cohort, joins it, drives the protocol to completion, and resolves with `{ cohortId, beaconAddress }`.

### What the participant runner does internally

1. **Cohort Discovery (spec Step 1)**
   - Listens for `COHORT_ADVERT` broadcasts on the transport
   - For each advert: emits `cohort-discovered` and calls `shouldJoin(advert)`
   - If the filter accepts, registers the service's communication key, sends `COHORT_OPT_IN`, emits `cohort-joined`
   - Waits for `COHORT_OPT_IN_ACCEPT` (acknowledgment)
   - Waits for `COHORT_READY` containing the cohort's MuSig2 beacon address; validates the address against locally-computed value, emits `cohort-ready`

2. **Update Submission (spec Step 2)**
   - Calls `onProvideUpdate({ cohortId, beaconAddress })` — your data callback
   - Sends the resulting `SignedBTCR2Update` via `SUBMIT_UPDATE`, emits `update-submitted`

3. **Validation (spec Step 3)**
   - Waits for `DISTRIBUTE_AGGREGATED_DATA` containing the CAS announcement (or SMT proof)
   - Verifies that the aggregated data correctly includes the participant's submitted update
   - Calls `onValidateData(info)` — your decision callback (default: approve if hash matches)
   - Sends `VALIDATION_ACK` (approved or rejected)
   - On rejection, emits `cohort-failed` and stops processing this cohort

4. **Signing (spec Step 4)**
   - Waits for `AUTHORIZATION_REQUEST` containing the unsigned tx
   - Calls `onApproveSigning(req)` — your decision callback (default: approve)
   - On rejection, emits `cohort-failed` and stops
   - On approval: generates a MuSig2 nonce, sends `NONCE_CONTRIBUTION`
   - Waits for `AGGREGATED_NONCE` from the service
   - Generates and sends the `SIGNATURE_AUTHORIZATION` (partial signature)
   - Emits `cohort-complete`

---

## Decision Callbacks Reference

### Service callbacks

| Callback | Required? | Default | Purpose |
|---|---|---|---|
| `onProvideTxData` | ✅ yes | — | Build the Bitcoin tx to MuSig2-sign once validation completes |
| `onOptInReceived` | optional | auto-accept | Decide whether to admit each participant who opts in |
| `onReadyToFinalize` | optional | finalize at minParticipants | Decide whether to finalize keygen now or wait for more |

### Participant callbacks

| Callback | Required? | Default | Purpose |
|---|---|---|---|
| `onProvideUpdate` | ✅ yes | — | Build and sign the update to include in this cohort |
| `shouldJoin` | optional | reject all | Filter which advertised cohorts to join |
| `onValidateData` | optional | approve if hash matches | Approve/reject the aggregated data |
| `onApproveSigning` | optional | approve | Approve/reject signing the Bitcoin tx |

> The defaults are designed so the simplest possible runner — provide only the required callbacks — works correctly for the happy path. Override the optional callbacks when you need user prompts, custom filters, fee policies, or audit logs.

---

## Events Reference

### `AggregationServiceRunner` events

| Event | Payload | Fires when |
|---|---|---|
| `cohort-advertised` | `{ cohortId }` | After the cohort is created and advert is queued for broadcast |
| `opt-in-received` | `PendingOptIn` | A participant opts in (before `onOptInReceived` is called) |
| `participant-accepted` | `{ participantDid }` | After the operator accepts an opt-in |
| `keygen-complete` | `{ cohortId, beaconAddress }` | MuSig2 keygen finalizes — beacon address is now known |
| `update-received` | `{ participantDid }` | A participant submits a signed update |
| `data-distributed` | `{ cohortId }` | CAS announcement / SMT tree built and sent for validation |
| `validation-received` | `{ participantDid, approved }` | A participant's validation ack arrives |
| `signing-started` | `{ sessionId }` | MuSig2 signing session begins (auth requests sent) |
| `nonce-received` | `{ participantDid }` | A participant's MuSig2 nonce arrives |
| `signing-complete` | `AggregationResult` | Final signature computed (also resolves `run()`) |
| `error` | `Error` | Protocol or transport error (rejects `run()` for fatal errors) |

### `AggregationParticipantRunner` events

| Event | Payload | Fires when |
|---|---|---|
| `cohort-discovered` | `CohortAdvert` | A new cohort advert arrives (before `shouldJoin`) |
| `cohort-joined` | `{ cohortId }` | After opt-in is sent |
| `cohort-ready` | `{ cohortId, beaconAddress }` | Cohort keygen finalizes |
| `update-submitted` | `{ cohortId }` | After the signed update is sent |
| `validation-requested` | `PendingValidation` | Aggregated data arrives (before `onValidateData`) |
| `signing-requested` | `PendingSigningRequest` | Auth request arrives (before `onApproveSigning`) |
| `cohort-complete` | `{ cohortId, beaconAddress }` | Partial signature sent — this participant is done |
| `cohort-failed` | `{ cohortId, reason }` | Validation rejected, signing rejected, or protocol error |
| `error` | `Error` | Non-fatal error |

---

## Error Handling

The runners distinguish **fatal errors** (which reject `run()` for the service or trigger `cohort-failed` for participants) from **non-fatal errors** (which only emit `error` events).

```typescript
runner.on('error', (err) => {
  // Non-fatal: log and continue
  console.warn('aggregation warning:', err.message);
});

try {
  const result = await runner.run();  // service
  // success
} catch(err) {
  // Fatal: protocol couldn't complete
  console.error('aggregation failed:', err);
}
```

For participants, `cohort-failed` is the per-cohort failure signal. The runner stays alive and continues processing other cohorts even if one fails:

```typescript
runner.on('cohort-failed', ({ cohortId, reason }) => {
  console.error(`cohort ${cohortId} failed: ${reason}`);
  // runner is still listening for other cohorts
});
```

Common fatal errors:
- The transport rejects an outgoing message (no relays accepted it)
- A required callback throws
- An incoming message references unknown state (e.g., signing without prior keygen)
- MuSig2 signature aggregation fails (e.g., a participant submitted an invalid partial signature)

---

## Power-User: State Machine Layer

For tests, custom transports, or fine-grained control, drop down to the sans-I/O state machines directly. They have no transport coupling — every action method returns `BaseMessage[]` for you to send via whatever mechanism you choose.

### Service state machine

```typescript
import { AggregationService } from '@did-btcr2/method';

const session = new AggregationService({ did: serviceDid, keys: serviceKeys });

// Step 1: Cohort Formation
const cohortId = session.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' });
const advertMsgs = session.advertise(cohortId);
// You're responsible for sending advertMsgs over your transport

// When opt-ins arrive, feed them in:
session.receive(optInMessage);

// Inspect state:
const pending = session.pendingOptIns(cohortId);

// Accept and finalize:
const acceptMsgs = session.acceptParticipant(cohortId, participantDid);
const readyMsgs = session.finalizeKeygen(cohortId);

// Step 2-3: collect updates and distribute
session.receive(submitUpdateMessage);
const distributeMsgs = session.buildAndDistribute(cohortId);

// Step 4: signing
session.receive(validationAckMessage);
const authMsgs = session.startSigning(cohortId, txData);
session.receive(nonceContributionMessage);
const aggNonceMsgs = session.sendAggregatedNonce(cohortId);
session.receive(signatureAuthorizationMessage);

// Result
const result = session.getResult(cohortId);
```

### Participant state machine

```typescript
import { AggregationParticipant } from '@did-btcr2/method';

const session = new AggregationParticipant({ did: myDid, keys: myKeys });

// Receive an advert
session.receive(cohortAdvertMessage);

// Inspect discovered cohorts:
const discovered = session.discoveredCohorts;

// Join one:
const optInMsgs = session.joinCohort(cohortId);

// After receive() COHORT_READY, inspect joined cohort:
session.receive(cohortReadyMessage);
const joined = session.joinedCohorts.get(cohortId);

// Submit update:
const submitMsgs = session.submitUpdate(cohortId, signedUpdate);

// After receive() DISTRIBUTE_AGGREGATED_DATA, inspect validation:
session.receive(distributeMessage);
const validation = session.pendingValidations.get(cohortId);

// Approve:
const ackMsgs = session.approveValidation(cohortId);

// Signing
session.receive(authorizationRequestMessage);
const nonceMsgs = session.approveNonce(cohortId);
session.receive(aggregatedNonceMessage);
const partialSigMsgs = session.generatePartialSignature(cohortId);
```

### Mixed mode

The Runner exposes the underlying state machine via `runner.session`, so you can use the Runner for the heavy lifting and reach into the session for advanced inspection:

```typescript
const runner = new AggregationServiceRunner({ /* ... */ });

runner.on('opt-in-received', () => {
  // Read directly from the underlying session
  const pending = runner.session.pendingOptIns(cohortId);
  console.log('Opt-ins so far:', pending.size);
});

await runner.run();
```

---

## Running the E2E Demos

Three runnable example scripts in `lib/operations/aggregation/` demonstrate the runner API in different deployment configurations:

| Script | Description |
|---|---|
| `e2e-shared-transport.ts` | Single process, MockTransport bus, no relay required. Fastest validation. |
| `e2e-per-actor-transport.ts` | Single process, each actor has its own NostrTransport pointing to the same relay. Tests real Nostr signing/encryption. |
| `aggregation-service.ts` + `aggregation-participant.ts` | Two truly separate processes connecting to a relay. Production-realistic. |

```bash
# Fastest — no relay required
npx tsx lib/operations/aggregation/e2e-shared-transport.ts

# Single process, real Nostr (requires a local relay)
RELAY=ws://localhost:7777 npx tsx lib/operations/aggregation/e2e-per-actor-transport.ts

# Multi-process — run each in its own terminal
RELAY=ws://localhost:7777 npx tsx lib/operations/aggregation/aggregation-service.ts
RELAY=ws://localhost:7777 SERVICE_DID=<from above> npx tsx lib/operations/aggregation/aggregation-participant.ts
```

All three scripts exercise the same protocol and produce a 64-byte Schnorr signature on the same dummy P2TR transaction. They differ only in deployment topology, not in protocol logic.

---

## Production Deployment Notes

### One transport per process

In production, each actor (service or participant) runs in its own process, with its own `NostrTransport` registering exactly one actor. Sharing one transport across actors is a testing convenience — don't do it in production unless you have a specific reason.

### Relay selection

Aggregation requires reliable delivery, especially for the encrypted directed messages (NIP-44 kind 1059). Use 2–3 relays for redundancy. Public relays may rate-limit or drop kind 1059 events under load — if you need guaranteed delivery, run your own relay.

### Beacon address funding

The `onProvideTxData` callback receives the cohort's `beaconAddress` and `signalBytes`. Before MuSig2 signing can succeed, that address must already hold a UTXO. There are two common patterns:

- **Pre-funded address**: the service operator funds the address out-of-band (e.g., via a watcher process) before the cohort starts signing. Simpler operationally.
- **First-update funding**: a participant's first update funds the beacon address itself by sending a small change output to it. Requires a more complex `onProvideTxData` that builds a tx with both the funding input and the beacon's spending input.

Either way, the runner doesn't manage funding — it only signs the tx you provide.

### Transaction broadcasting

The runner produces a signed transaction but does NOT broadcast it. After `runner.run()` resolves, you broadcast `result.signedTx.toHex()` yourself via your Bitcoin connection. This separation keeps the runner free of Bitcoin RPC dependencies.

```typescript
const result = await runner.run();
const txid = await bitcoin.rest.transaction.send(result.signedTx.toHex());
console.log('Broadcast:', txid);
```

### CAS publishing

For `CASBeacon` cohorts, the CAS Announcement Map needs to be published to a content-addressed store (typically IPFS) so that resolvers can fetch it via the on-chain hash. This is also the operator's responsibility — read it from `runner.session.getCohort(cohortId).casAnnouncement` after `signing-complete` and publish via your CAS client.

### Decision callback latency

Decision callbacks are awaited inline in the protocol flow. If your `onOptInReceived` or `onProvideTxData` is slow (e.g., waiting for human review), the protocol blocks until the callback resolves. For UIs, you typically want to:

1. Surface the decision in the UI immediately (via the corresponding event)
2. Hold the callback open until the user clicks
3. Resolve the callback with the user's decision

This is exactly the pattern an interactive client app should follow.

### Error recovery

There is no built-in retry mechanism. If a participant drops out mid-signing, the cohort fails. Your application should:

- Use a generous `minParticipants` floor so a single dropout isn't fatal
- Track which cohorts have completed via the `signing-complete` / `cohort-complete` events
- For long-running participant runners, restart on the `error` event if necessary

---

## Quick Reference

| Task | Where to look |
|---|---|
| Create a service runner | [Service Step-by-Step](#service-step-by-step) |
| Create a participant runner | [Participant Step-by-Step](#participant-step-by-step) |
| Decide what callbacks to override | [Decision Callbacks Reference](#decision-callbacks-reference) |
| Wire up event listeners | [Events Reference](#events-reference) |
| Handle errors | [Error Handling](#error-handling) |
| Work with the raw state machine | [Power-User: State Machine Layer](#power-user-state-machine-layer) |
| Run example scripts | [Running the E2E Demos](#running-the-e2e-demos) |
| Deploy to production | [Production Deployment Notes](#production-deployment-notes) |
