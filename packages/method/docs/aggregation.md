# Aggregation

Multi-party coordination for aggregated BTCR2 updates, implementing the [Aggregate Beacon protocol](https://dcdpr.github.io/did-btcr2/beacons/aggregate-beacons.html).

This guide is a step-by-step walkthrough. If you've never used the aggregation subsystem before, read it top to bottom. If you already know what you're doing, jump to the [Service Step-by-Step](#service-step-by-step) or [Participant Step-by-Step](#participant-step-by-step) sections.

> **Which package exports what.** Aggregation lives in the standalone `@did-btcr2/aggregation` package: every runner, state machine, transport, message type, and beacon strategy in this guide is imported from there, not from `@did-btcr2/method`. `@did-btcr2/method` has no dependency on it and exports no aggregation symbols; what method contributes is the did:btcr2 side of the examples (`DidBtcr2`, `Identifier`, `Resolver`, `Updater`) plus `resolveBtcr2SenderPk`, the DID-to-key decode the transports take as `resolveSenderPk`. The examples below import the whole aggregation surface from the umbrella entry `@did-btcr2/aggregation`; applications that want to keep client code out of a server bundle (or the reverse) can import the same symbols from the role entries `@did-btcr2/aggregation/core`, `/participant`, and `/service`.

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
13. [Extension Points](#extension-points)

---

## What Aggregation Solves

Without aggregation, every BTCR2 DID update has to be broadcast individually as its own Bitcoin transaction via a Singleton Beacon. That doesn't scale: every DID controller pays Bitcoin fees for every update, and the chain fills up with one-shot transactions.

Aggregation lets a coordinator (the **Aggregation Service**) batch updates from many DID controllers (the **Aggregation Participants**) into a single Bitcoin transaction. All participants jointly sign that transaction using **MuSig2** (an n-of-n Schnorr aggregation scheme) so the on-chain footprint is just one signature regardless of how many participants joined.

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

- **`CASBeacon`**: Aggregated updates form a CAS Announcement Map (DID to updateHash). The service publishes the map to a Content-Addressed Store (e.g., IPFS) and commits its hash on-chain.
- **`SMTBeacon`**: Aggregated updates form a Sparse Merkle Tree. The SMT root is committed on-chain; participants get individual Merkle proofs.

The beacon type is not an input of the beacon address. A CAS cohort and an SMT cohort with the same members, recovery key, recovery sequence, funding model, fallback threshold (k), and network get one beacon address. A member refuses the second cohort (`BEACON_TYPE_CONFLICT`) only if its `AggregationParticipant` object knows the first cohort. Then the second cohort does not complete.

If the member uses a new `AggregationParticipant` object, the member signs the second cohort. The signal of the second cohort can make a DID of the member invalid. To offer both beacon types to the same members, use another `recoverySequence` for each beacon type (ADR 152).

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
│  - NostrTransport              (production)        │
│  - HttpClientTransport + HttpServerTransport       │
│                                (production)        │
│  - DidCommTransport            (stub)              │
│  - MockTransport               (in tests)          │
└────────────────────────────────────────────────────┘
```

**Pick the Runner unless you have a reason not to.** It's the default API. The state machine layer exists so the protocol logic stays testable in isolation and so you can build your own integrations on top.

---

## Setting Up the Transport

Every actor (service or participant) needs a `Transport` to send and receive messages. Two production transports ship, both implementing the same `Transport` interface:

- **`NostrTransport`**: relay-based. Censorship-resistant via multi-relay redundancy. Each message with a recipient goes as a kind 1059 event, with NIP-44 v2 encryption for the key of the recipient. Only a `COHORT_ADVERT` can go with no recipient, as a public kind 1 event. A plaintext above 65,535 bytes gives `MESSAGE_TOO_LARGE`, so a Nostr cohort has a size limit (see [Relay selection](#relay-selection-nostr-transport-only)). Requires at least one running relay.
- **`HttpClientTransport` + `HttpServerTransport`**: HTTP/REST. Operator-hosted. Browser-compatible clients via `fetch` + fetch-based SSE. Framework-agnostic server (caller mounts `handleRequest` / `handleSse` in Hono / Express / Fastify / Workers / Bun). TLS-only confidentiality; signed-envelope authenticity per request.

Runners and state machines are transport-agnostic: you pick a transport at construction time and the rest of the system doesn't care. Pick `NostrTransport` when you want censorship resistance and multi-relay redundancy; pick the HTTP pair when you want operational familiarity, browser-native clients, or REST-tooling interop.

This section walks through the Nostr setup. For the HTTP walkthrough (wire protocol, Hono snippet, CORS and rate-limit configuration), see [http-transport.md](./http-transport.md).

A single `Transport` instance can serve multiple registered actors. In production each process typically registers exactly one actor (its own identity); in tests one transport often serves several actors at once for easy in-process round-trips.

```typescript
import { NostrTransport, SILENT_LOGGER } from '@did-btcr2/aggregation';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { DidBtcr2, resolveBtcr2SenderPk } from '@did-btcr2/method';

// 1. Generate identity
const keys = SchnorrKeyPair.generate();
const did = DidBtcr2.create(keys.publicKey.compressed, {
  idType  : 'KEY',
  network : 'mutinynet',
});

// 2. Create transport pointing at one or more Nostr relays
const transport = new NostrTransport({
  relays              : ['wss://relay.damus.io', 'wss://nos.lol'],
  // Optional: pass SILENT_LOGGER to suppress transport diagnostics, or a
  // custom Logger to route to pino/winston/etc. Defaults to CONSOLE_LOGGER.
  logger              : SILENT_LOGGER,
  // Optional: `since` filter window (ms) on the COHORT_ADVERT subscription.
  // Some relays don't backfill historical events to late subscribers; this
  // gives them a bounded window of recent events to replay. Default 5 min.
  broadcastLookbackMs : 5 * 60 * 1000,
  // Authenticates inbound senders: binds each message's declared `from` DID to
  // the key that signed the event carrying it. Without it the transport accepts
  // messages only from peers already registered via registerPeer().
  resolveSenderPk     : resolveBtcr2SenderPk,
});

// 3. Register the actor (DID + keys) with the transport
transport.registerActor(did, keys);

// 4. Open relay connections
transport.start();

// 5. When done, cleanly tear down (releases relay subscriptions + handlers)
transport.unregisterActor(did);
```

That's the entire transport setup. From here on, you only interact with the Runner: the transport is plumbing.

### `NostrTransportConfig` options

| Option | Default | Purpose |
|---|---|---|
| `relays` | `DEFAULT_NOSTR_RELAYS` (4 public relays) | Array of relay URLs to connect to |
| `logger` | `CONSOLE_LOGGER` | Injectable `Logger` for transport diagnostics |
| `broadcastLookbackMs` | 5 min | `since` filter on broadcast (COHORT_ADVERT) subscription. Set to `0` to disable. |
| `resolveSenderPk` | none | DID-to-key decode used to authenticate inbound senders. Without it, only already-registered peers are accepted. See [Sender authentication](#sender-authentication). |

### Choosing between Nostr and HTTP

Both transports carry identical protocol semantics. Differences that matter at deployment time:

| Dimension | Nostr | HTTP |
|---|:---:|:---:|
| Wire infrastructure | One or more Nostr relays | One HTTP server (operator-hosted) |
| Censorship resistance | High (multi-relay redundancy) | Low-to-medium (single operator) |
| Confidentiality against the wire | Strong (NIP-44 v2 for each message with a recipient; adverts are public) | TLS only (operator sees plaintext) |
| Largest cohort (did:btcr2 KEY DIDs) | About 533 members for CAS, about 804 for SMT (the 65,535-byte plaintext limit of the transport) | No transport limit by default (see [`maxSseEventBytes`](./http-transport.md#sse-event-size-limit)) |
| Browser participants | Requires a Nostr library | Native (`fetch` + streaming) |
| Ops / debugging surface | Relay internals | curl, access logs, OpenAPI |
| Test harness | Needs a relay | Plain HTTP mock or in-process parity test |

Factory invocation for each:

```typescript
import { TransportFactory } from '@did-btcr2/aggregation';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';

// Nostr
const transport = TransportFactory.establish({
  type            : 'nostr',
  relays          : ['wss://relay.damus.io', 'wss://nos.lol'],
  resolveSenderPk : resolveBtcr2SenderPk,
});

// HTTP client (participant side)
const transport = TransportFactory.establish({
  type            : 'http',
  role            : 'client',
  baseUrl         : 'https://aggregator.example.com/',
  resolveSenderPk : resolveBtcr2SenderPk,
});

// HTTP server (operator side): mount handleRequest + handleSse in a web framework
const transport = TransportFactory.establish({
  type            : 'http',
  role            : 'server',
  resolveSenderPk : resolveBtcr2SenderPk,
});
```

### `Transport` lifecycle methods

| Method | Purpose |
|---|---|
| `registerActor(did, keys)` | Register an actor identity |
| `unregisterActor(did)` | Detach an actor: close its relay subscriptions, drop handlers + keys |
| `registerMessageHandler(did, type, handler)` | Install a per-(actor, type) handler |
| `unregisterMessageHandler(did, type)` | Remove a handler. Also called automatically by `runner.stop()` |
| `sendMessage(msg, sender, recipient?)` | Publish once |
| `publishRepeating(msg, sender, intervalMs, recipient?)` | Publish once immediately, then on an interval; returns an idempotent stop handle |

---

## Service Step-by-Step

The service is the coordinator. It creates a cohort, advertises it, accepts participants, finalizes keygen, distributes aggregated data, and drives MuSig2 signing.

### Step 1: Construct the runner

```typescript
import { AggregationServiceRunner } from '@did-btcr2/aggregation';
import { getNetwork } from '@did-btcr2/bitcoin';
import { buildAggregationBeaconTx } from '@did-btcr2/method';

// onProvideTxData reads `runner`. The runner calls onProvideTxData only after
// the constructor returns.
const runner: AggregationServiceRunner = new AggregationServiceRunner({
  transport,                     // from previous section
  did       : serviceDid,
  keys      : serviceKeys,

  config: {
    minParticipants  : 2,
    network          : 'mutinynet',
    beaconType       : 'CASBeacon',
    recoveryKey      : recoveryKeyHex, // x-only operator recovery key, 64 hex characters
    recoverySequence : 144,            // blocks (BIP-68) before the recovery leaf is spendable
  },

  // REQUIRED: provide the Bitcoin transaction to be MuSig2-signed. The
  // transaction must spend the beacon output. buildAggregationBeaconTx finds a
  // UTXO at beaconAddress, adds a change output if change is due, and puts
  // signalBytes in the last output (OP_RETURN).
  onProvideTxData: async ({ cohortId, beaconAddress, signalBytes, feeEstimator }) => {
    const cohort = runner.session.getCohort(cohortId)!;
    return await buildAggregationBeaconTx({
      beaconAddress,
      internalPubkey : cohort.internalKey,
      signalBytes,
      bitcoin,                   // a BitcoinConnection
      network        : getNetwork(cohort.network),
      feeEstimator,
    });
  },

  // Optional hardening (all have sensible defaults):
  maxUpdateSizeBytes     : 256 * 1024,   // reject oversized updates (default 256 KiB)
  cohortTtlMs            : 10 * 60_000,  // overall deadline, emits cohort-failed on expiry
  phaseTimeoutMs         : 2 * 60_000,   // per-phase stall deadline
  advertRepeatIntervalMs : 60_000,       // re-publish COHORT_ADVERT until keygen complete
});
```

The `config` object holds the cohort conditions. The spec example in "Step 1: Create Aggregation Cohort" names conditions such as the beacon type and the number of participants. `createCohort` refuses a config without a beacon type, a minimum participant count, a recovery key, or a recovery sequence. The recovery key and the recovery sequence are not spec conditions: ADR 042 adds them. `createCohort` does not check `network`, but the cohort needs a valid network to compute the beacon address. Other conditions, for example `maxParticipants`, the time between announcements, and the costs, are optional `config` members.

#### `AggregationServiceRunnerOptions` (optional hardening)

| Option | Default | Purpose |
|---|---|---|
| `maxUpdateSizeBytes` | 256 KiB | Reject `SUBMIT_UPDATE` payloads whose canonicalized size exceeds this cap. Dropped submissions are surfaced via `message-rejected`. |
| `cohortTtlMs` | unset (disabled) | Overall deadline for `run()`. On expiry: emit `cohort-failed`, reject `run()`, GC cohort state. |
| `phaseTimeoutMs` | unset (disabled) | Per-phase stall deadline. Reset automatically on each observed phase transition. |
| `advertRepeatIntervalMs` | 60 s | Re-publish `COHORT_ADVERT` on this cadence until keygen completes, fails, or the runner stops. `0` disables re-publish (single publish). |

### Step 2: Subscribe to events (optional)

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

Subscribing is purely optional. Skipping events doesn't change the protocol: they're a side channel for observability.

### Step 3: Run the protocol to completion

```typescript
const result = await runner.run();
console.log('Final signature:', result.signature);
console.log('Signed tx hex:',   result.signedTx.toHex());
console.log('Cohort id:',       result.cohortId);
```

`runner.run()` returns a Promise that resolves with the final aggregation result once the MuSig2 signing session completes. That's it: internally it has just driven the cohort through all four spec steps.

### What `run()` actually does internally

So you understand what's happening behind the scenes:

1. **Cohort Formation (spec Step 1)**
   - Creates an `AggregationCohort` and emits `cohort-advertised`
   - Sends a `COHORT_ADVERT` broadcast over the transport
   - For each incoming `COHORT_OPT_IN` message:
     - Calls `onOptInReceived(optIn)`: your decision callback
     - If accepted, registers the peer's communication key, sends `COHORT_OPT_IN_ACCEPT`, emits `participant-accepted`
   - Once `minParticipants` is reached, calls `onReadyToFinalize`: your decision callback
   - If `finalize: true`, computes the n-of-n MuSig2 Taproot beacon address, sends `COHORT_READY` to all participants, emits `keygen-complete`
   - After `finalizeKeygen`, the membership is final. The service drops a new `COHORT_OPT_IN`, and `acceptParticipant` throws `INVALID_PHASE`. If `onOptInReceived` approves an opt-in after this point, the runner ignores the approval. It emits `message-rejected` with the rejection code `MEMBERSHIP_FINAL`. See [Decision callback latency](#decision-callback-latency).

2. **Update Submission (spec Step 2)**
   - For each incoming `SUBMIT_UPDATE` message: calls `session.receive()` and emits `update-received`
   - Once all participants have submitted, the cohort phase becomes `UpdatesCollected`

3. **Aggregate & Validate (spec Step 3)**
   - Builds the CAS Announcement Map (or SMT tree, depending on `beaconType`)
   - Sends `DISTRIBUTE_AGGREGATED_DATA` to all participants, emits `data-distributed`
   - For each incoming `VALIDATION_ACK`: tracks approval, emits `validation-received`
   - Once all participants approve, calls `onProvideTxData`: your data callback
   - `startSigning` checks that `prevOutScripts[0]` is the output script of the beacon address. If it is not, `startSigning` throws `PREVOUT_SCRIPT_MISMATCH`, the runner emits `error`, and `run()` rejects.
   - Sends `AUTHORIZATION_REQUEST` to all participants with the unsigned tx, emits `signing-started`

4. **Signing & Broadcast (spec Step 4)**
   - For each incoming `NONCE_CONTRIBUTION`: tracks the nonce, emits `nonce-received`
   - Once all nonces are in, sends the aggregated nonce back via `AGGREGATED_NONCE`
   - For each incoming `SIGNATURE_AUTHORIZATION` (a partial signature): adds it to the session
   - Once all partial signatures are in, generates the final 64-byte Schnorr signature, attaches it to the tx, emits `signing-complete`, and resolves `run()`

You can broadcast the resulting signed transaction yourself using `result.signedTx.toHex()`: the runner doesn't broadcast for you (that's a transport-layer concern outside its scope).

---

## Participant Step-by-Step

The participant joins cohorts advertised by services, submits its own DID update, validates the aggregated data, and contributes its share of the MuSig2 signature.

### Step 1: Construct the runner

```typescript
import { AggregationParticipantRunner } from '@did-btcr2/aggregation';
import { LocalSigner } from '@did-btcr2/keypair';
import { Resolver, Updater } from '@did-btcr2/method';

const runner = new AggregationParticipantRunner({
  transport,                    // from the transport setup section
  did  : myDid,
  keys : myKeys,

  // Filter discovered cohorts. Default rejects all - you MUST override this.
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

    const unsigned = Updater.construct(doc, [{
      op    : 'add',
      path  : '/service/-',
      value : {
        id              : `${myDid}#beacon-cas`,
        type            : 'CASBeacon',
        serviceEndpoint : `bitcoin:${beaconAddress}`,
      }
    }], 1);

    // Updater.sign takes the source document, the unsigned update of that
    // document, the id of a capabilityInvocation method, and a Signer.
    // LocalSigner holds the secret key in this process. For a KMS or HSM key,
    // use KeyManagerSigner.
    return Updater.sign(doc, unsigned, '#initialKey', new LocalSigner(myKeys.raw.secret!));
  },
});
```

Two callbacks are required for the participant:
- **`shouldJoin`**: filter which cohorts to join. Default is "reject everything"; you MUST override it.
- **`onProvideUpdate`**: build the BTCR2 update you want included in the aggregated batch.

Two more callbacks are optional:
- **`onValidateData`**: approve/reject aggregated data. Default approves if `info.matches` is true. `info.matches` needs your update in the data, a signal that derives from the data, and the beacon type of the cohort in the message. If you declined the update, `info.matches` needs the data to show no update of yours.
- **`onApproveSigning`**: approve/reject the actual signing. Default approves.

### Step 2: Subscribe to events (optional)

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

### Step 3: Start the runner

Unlike the service, the participant runner is **long-running**. It listens indefinitely for new cohort adverts and processes each accepted cohort in parallel.

```typescript
await runner.start();
// runner is now listening - control returns immediately
// Cohort processing happens via callbacks and events as messages arrive
```

To stop the runner cleanly:

```typescript
runner.stop();
```

### Step 3b: One-shot mode

For tests, demos, or scripts that should exit after joining a single cohort, use the `joinFirst` static helper:

```typescript
const result = await AggregationParticipantRunner.joinFirst({
  transport,
  did             : myDid,
  keys            : myKeys,
  shouldJoin      : async (advert) => advert.serviceDid === expectedServiceDid,
  onProvideUpdate : async ({ beaconAddress, beaconType }) => buildAndSignUpdate(beaconAddress, beaconType),
});

console.log(`Joined cohort ${result.cohortId}, beacon: ${result.beaconAddress}`);
```

`joinFirst` waits for a matching cohort, joins it, drives the protocol to completion, and resolves with `{ cohortId, beaconAddress }`.

A participant refuses a cohort if another cohort of the same runner has this beacon address and another beacon type. For this refusal, the runner emits `cohort-failed`. Its `reason` is the message of an `AggregationParticipantError` of type `BEACON_TYPE_CONFLICT`. The other cohorts of the runner continue. This check knows only the cohorts of one runner. A new runner, each `joinFirst` or `joinMatching` call, each `AggregationRunner.solo` run, and a process restart start with no cohorts.

Thus your application must also do a check before the member signs:

1. Compare the beacon address with the beacon services of each DID document that uses this key.
2. If a beacon service of another type has this address, return `{ approved: false }` from `onValidateData`. `onValidateData` gets no beacon address. Keep the address of each `cohortId` from `onProvideUpdate`, or read `runner.session.joinedCohorts`.

A null return from `onProvideUpdate` declines the update, but the member still signs. Thus a null return does not refuse the cohort. Use one key for each DID. Each SMT signal at a beacon address of a DID must have an SMT proof for that DID. If two DIDs use one key, an SMT cohort of one DID can get the beacon address of the other DID.

### What the participant runner does internally

1. **Cohort Discovery (spec Step 1)**
   - Listens for `COHORT_ADVERT` broadcasts on the transport
   - Drops an advert whose `beaconType` is not `CASBeacon` or `SMTBeacon`, with no event
   - For each advert: emits `cohort-discovered` and calls `shouldJoin(advert)`
   - If the filter accepts, registers the service's communication key, sends `COHORT_OPT_IN`, emits `cohort-joined`
   - Waits for `COHORT_OPT_IN_ACCEPT` (acknowledgment)
   - Waits for `COHORT_READY` containing the cohort's MuSig2 beacon address; validates the address against locally-computed value, emits `cohort-ready`. The participant refuses `COHORT_READY` if the address is not the address that it computes (`BEACON_ADDRESS_MISMATCH`). It also refuses `COHORT_READY` if another of its cohorts has this beacon address and another beacon type (`BEACON_TYPE_CONFLICT`). For `BEACON_TYPE_CONFLICT`, the phase becomes Failed and the runner emits `cohort-failed`. For `BEACON_ADDRESS_MISMATCH`, the phase stays OptedIn and the runner emits `error`.

2. **Update Submission (spec Step 2)**
   - Calls `onProvideUpdate({ cohortId, beaconAddress, beaconType })`: your data callback. The beacon service in the DID document must have the type `beaconType`.
   - Sends the resulting `SignedBTCR2Update` via `SUBMIT_UPDATE`, emits `update-submitted`

3. **Validation (spec Step 3)**
   - Waits for `DISTRIBUTE_AGGREGATED_DATA` containing the CAS announcement (or SMT proof)
   - Validates the aggregated data with the beacon type of the cohort (from the advert), not with the type that the message names. The data must hold the submitted update of the participant (or its non-inclusion, if it declined), and the signal must derive from the data. If the message names another beacon type, `info.matches` is false.
   - Calls `onValidateData(info)`: your decision callback (default: approve if `info.matches` is true). If `info.matches` is false, the participant refuses to sign later, also if `onValidateData` approves.
   - Sends `VALIDATION_ACK` (approved or rejected)
   - On rejection, emits `cohort-failed` and stops processing this cohort

4. **Signing (spec Step 4)**
   - Waits for `AUTHORIZATION_REQUEST` containing the unsigned tx
   - Calls `onApproveSigning(req)`: your decision callback (default: approve)
   - On rejection, emits `cohort-failed` and stops
   - On approval: checks the transaction, generates a MuSig2 nonce, sends `NONCE_CONTRIBUTION`. The participant refuses to sign a transaction whose prevout script is not the beacon script of the cohort (`PREVOUT_SCRIPT_MISMATCH`). It also refuses a transaction with more than one input (`INVALID_TX_STRUCTURE`). For a refusal, the runner emits `error` and sends no nonce.
   - Waits for `AGGREGATED_NONCE` from the service
   - Generates and sends the `SIGNATURE_AUTHORIZATION` (partial signature)
   - Emits `cohort-complete`
   - The same transaction checks apply to a `FALLBACK_AUTHORIZATION_REQUEST` (the k-of-n script path). On both paths, the participant computes the sighash over the beacon script of its own cohort.

---

## Decision Callbacks Reference

### Service callbacks

| Callback | Required? | Default | Purpose |
|---|---|---|---|
| `onProvideTxData` | ✅ yes | n/a | Build the Bitcoin tx to MuSig2-sign once validation completes |
| `onOptInReceived` | optional | auto-accept | Decide whether to admit each participant who opts in |
| `onReadyToFinalize` | optional | finalize at minParticipants | Decide whether to finalize keygen now or wait for more |

### Participant callbacks

| Callback | Required? | Default | Purpose |
|---|---|---|---|
| `onProvideUpdate` | ✅ yes | n/a | Build and sign the update to include in this cohort |
| `shouldJoin` | optional | reject all | Filter which advertised cohorts to join |
| `onValidateData` | optional | approve if `info.matches` is true | Approve/reject the aggregated data |
| `onApproveSigning` | optional | approve | Approve/reject signing the Bitcoin tx |

> The defaults are designed so the simplest possible runner (provide only the required callbacks) works correctly for the happy path. Override the optional callbacks when you need user prompts, custom filters, fee policies, or audit logs.

---

## Events Reference

### `AggregationServiceRunner` events

| Event | Payload | Fires when |
|---|---|---|
| `cohort-advertised` | `{ cohortId }` | After the cohort is created and advert is queued for broadcast |
| `opt-in-received` | `PendingOptIn` | A participant opts in (before `onOptInReceived` is called) |
| `participant-accepted` | `{ participantDid }` | After the operator accepts an opt-in |
| `keygen-complete` | `{ cohortId, beaconAddress }` | MuSig2 keygen finalizes: beacon address is now known |
| `update-received` | `{ participantDid }` | A participant submits a signed update |
| `data-distributed` | `{ cohortId }` | CAS announcement / SMT tree built and sent for validation |
| `validation-received` | `{ participantDid, approved }` | A participant's validation ack arrives |
| `signing-started` | `{ sessionId }` | MuSig2 signing session begins (auth requests sent) |
| `nonce-received` | `{ participantDid }` | A participant's MuSig2 nonce arrives |
| `signing-complete` | `AggregationResult` | Final signature computed (also resolves `run()`) |
| `cohort-failed` | `{ cohortId, reason }` | Cohort entered a terminal failure state (validation rejection, TTL/phase timeout). Also rejects `run()`. |
| `message-rejected` | `Rejection & { cohortId }` | The state machine dropped an inbound message, or the runner dropped an operator approval that came too late. The rejection code `code` (a `RejectionReason`) for a dropped message is `WRONG_VERSION`, `UPDATE_TOO_LARGE`, `UPDATE_MALFORMED`, `UPDATE_SENDER_MISMATCH`, `NOT_A_MEMBER`, `DUPLICATE_RESPONSE`, `INVALID_NONCE`, `INVALID_PARTIAL_SIG`, `INVALID_FALLBACK_SIG`, or `INVALID_PARTICIPANT_KEY`. For a dropped approval, it is `MEMBERSHIP_FINAL` or `COHORT_FULL`. |
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
| `cohort-complete` | `{ cohortId, beaconAddress }` | Partial signature sent: this participant is done |
| `cohort-failed` | `{ cohortId, reason }` | Validation rejected, signing rejected, or a refused `COHORT_READY` (`BEACON_TYPE_CONFLICT`) |
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

For tests, custom transports, or fine-grained control, drop down to the sans-I/O state machines directly. They have no transport coupling: every action method returns `BaseMessage[]` for you to send via whatever mechanism you choose.

### Service state machine

```typescript
import { AggregationService } from '@did-btcr2/aggregation';

// The coordinator never signs: it aggregates public nonces and partial signatures,
// so the state machine takes only the public half of the operator's keypair (ADR 038).
// The full keypair stays the operator's transport/communication identity.
const session = new AggregationService({ did: serviceDid, publicKey: serviceKeys.publicKey });

// Step 1: Cohort Formation
const cohortId = session.createCohort({
  minParticipants  : 2,
  network          : 'mutinynet',
  beaconType       : 'CASBeacon',
  recoveryKey      : recoveryKeyHex, // x-only operator recovery key, 64 hex characters
  recoverySequence : 144,            // blocks (BIP-68) before the recovery leaf is spendable
});
const advertMsgs = session.advertise(cohortId);
// You're responsible for sending advertMsgs over your transport

// When opt-ins arrive, feed them in:
session.receive(optInMessage);

// Inspect state. pendingOptIns is empty outside the Advertised phase.
const pending = session.pendingOptIns(cohortId);

// Accept and finalize. After finalizeKeygen, the membership is final:
// acceptParticipant throws INVALID_PHASE, and the service drops a new opt-in.
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
import { AggregationParticipant, KeyPairAggregationSigner } from '@did-btcr2/aggregation';

// The participant does sign, so it takes an AggregationSigner rather than a raw
// keypair. KeyPairAggregationSigner backs one with an in-memory keypair and
// materializes the secret only for a single nonce/partial-sign step (ADR 038).
// An x1 participant also passes its genesisDocument here. The method of
// capabilityInvocation[0] in that document must have the type Multikey and a
// BIP340 Multikey key in base58btc text. Its controller must be 'did:btcr2:_'
// (resolution replaces it with the DID). The document must also have
// "@context" with the two btcr2 contexts (ADR 148). If the document does not
// agree with these conditions, resolveBtcr2SenderPk returns no key, and the
// transport drops the opt-in. The document can have no service.
const session = new AggregationParticipant({ did: myDid, signer: new KeyPairAggregationSigner(myKeys) });

// Receive an advert
session.receive(cohortAdvertMessage);

// Inspect discovered cohorts:
const discovered = session.discoveredCohorts;

// Join one:
const optInMsgs = session.joinCohort(cohortId);

// After receive() COHORT_READY, inspect the joined cohort. receive() throws if
// the participant refuses COHORT_READY (for example BEACON_ADDRESS_MISMATCH or
// BEACON_TYPE_CONFLICT). A refused cohort is not in joinedCohorts.
session.receive(cohortReadyMessage);
const joined = session.joinedCohorts.get(cohortId);

// Submit update. submitUpdate throws UPDATE_MALFORMED if the update has no
// JCS form (RFC 8785), for example if it holds NaN or a lone surrogate.
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

Five runnable scripts in `packages/aggregation/lib/operations/aggregation/` demonstrate the runner API in different deployment configurations. The commands below are run from `packages/aggregation`:

| Script | Description |
|---|---|
| `e2e-nostr-transport.ts` | Single process, each actor has its own `NostrTransport` pointing to the same relay. Tests real Nostr signing/encryption. |
| `e2e-http-transport.ts` | Single process, local `node:http` server hosting `HttpServerTransport`, participants connect as `HttpClientTransport` via real `fetch`. Full MuSig2 round over loopback HTTP. No relay, no external service. |
| `e2e-verify-signing.ts` | Like `e2e-nostr-transport.ts` but additionally verifies the aggregated signature with `@noble/curves` BIP-340 `schnorr.verify`. Exits non-zero on any assertion failure. The canonical "does MuSig2 still work end-to-end" check. |
| `aggregation-service.ts` + `aggregation-participant.ts` | Two truly separate processes connecting to a relay. Production-realistic. |

```bash
# HTTP transport: zero external dependencies, runs in ~1 second
PORT=8080 bun lib/operations/aggregation/e2e-http-transport.ts

# Nostr: single process, real relay (requires a local relay)
RELAY=ws://localhost:7777 bun lib/operations/aggregation/e2e-nostr-transport.ts

# Nostr with cryptographic signature verification (CI-droppable)
RELAY=ws://localhost:7777 bun lib/operations/aggregation/e2e-verify-signing.ts

# Multi-process: run each in its own terminal
RELAY=ws://localhost:7777 bun lib/operations/aggregation/aggregation-service.ts
RELAY=ws://localhost:7777 SERVICE_DID=<from above> bun lib/operations/aggregation/aggregation-participant.ts
```

All scripts exercise the same protocol and produce a 64-byte Schnorr signature on the same dummy P2TR transaction. They differ only in deployment topology and transport, not in protocol logic.

### Why verify the signature cryptographically?

`e2e-verify-signing.ts` captures the Taproot-tweaked x-only pubkey and the BIP-341 witness-v1 sighash inside `onProvideTxData`, then calls `schnorr.verify(signature, sighash, tweakedPk)` after `run()` resolves. If that check passes, the aggregated signature would be accepted by any BIP-340 verifier (including a Bitcoin node) without needing a funded UTXO to actually broadcast. This is the cheapest way to catch a regression anywhere in the MuSig2 pipeline: key aggregation, TapTweak, nonce aggregation, partial-sig pre-verify, or partial-sig aggregation.

---

## Production Deployment Notes

### One transport per process

In production, each actor (service or participant) runs in its own process, with its own transport instance (Nostr or HTTP) registering exactly one actor. Sharing one transport across actors is a testing convenience: don't do it in production unless you have a specific reason.

### Relay selection (Nostr transport only)

Aggregation requires reliable delivery of kind 1059 events. Each message with a recipient goes as a kind 1059 event, also the cohort formation messages (`COHORT_OPT_IN`, `COHORT_OPT_IN_ACCEPT`, `COHORT_READY`). Use 2–3 relays for redundancy. Public relays may rate-limit or drop kind 1059 events under load. If you need guaranteed delivery, run your own relay.

Observed behavior against common public relays (as of the e2e-verify-signing runs in the `refactor/aggregation` branch):

| Relay | Status | Notes |
|---|---|---|
| `ws://localhost:7777` (nostr-rs-relay) | ✅ Works | Default for local demos |
| `wss://nostr-pub.wellorder.net` | ✅ Works | Backfills historical events; serves kind 1059 |
| `wss://relay.damus.io` | ⚠️ Rate-limited | Aggressive anti-spam for anonymous writes: fine for small cohorts, fails under repeat publish |
| `wss://nos.lol` | ❌ Hangs after advert | Service publishes advert successfully; participants never receive it. Not fixed by `broadcastLookbackMs` or advert re-publish. |
| `wss://relay.snort.social` | ❌ Hangs after advert | Same failure mode as nos.lol. |

**The reliable production paths are (a) your own relay, or (b) a relay you've verified end-to-end with `e2e-verify-signing.ts` against your expected message volume.** The `broadcastLookbackMs` filter and `advertRepeatIntervalMs` re-publish are hedges that help on some flaky relays but can't overcome a relay that simply doesn't route kind 1 events between subscribers the way the protocol expects.

The transport does no NIP-42 AUTH. A relay that serves kind 1059 events only to an authenticated recipient (the NIP-59 AUTH guard) closes the directed subscription. The transport does not work with such a relay.

A kind 1059 event of this transport is not a NIP-59 gift wrap. The sender key signs it, and it has no seal. A relay thus sees the x-only keys of the sender and the recipient in the two `p` tags. It also sees the real `created_at` time and the ciphertext length (ADR 153).

This transport encrypts at most 65,535 bytes of plaintext in one message. This is the largest plaintext of the 2-byte NIP-44 v2 length prefix. A receiver on nostr-tools before 2.23.4 refuses a longer prefix. A larger message gives `MESSAGE_TOO_LARGE`, and the cohort fails. For did:btcr2 KEY DIDs, this limits the cohort size:

- A CAS cohort: about 533 members. `DISTRIBUTE_AGGREGATED_DATA` holds about 122 bytes for each member. The service sends it after it collects the update of each member.
- An SMT cohort: about 804 members. `COHORT_READY` holds 81 bytes for each cohort key. The service sends it after keygen.

No code compares `maxParticipants` with this limit. For a Nostr cohort, set `maxParticipants` below it.

### Reliability hedges (Nostr transport)

The Nostr transport and runner expose two mechanisms to improve delivery on imperfect relays:

- `NostrTransportConfig.broadcastLookbackMs` (default 5 min): applies a `since` filter to the `COHORT_ADVERT` subscription so relays that don't auto-backfill still return recent adverts to late subscribers.
- `AggregationServiceRunnerOptions.advertRepeatIntervalMs` (default 60 s): re-publishes the advert on a fixed cadence until keygen completes. Gives participants whose subscription was still settling when the initial advert went out a chance to catch a later copy.

Set either to `0` to opt out.

The HTTP transport doesn't need either hedge: the server retains the current advert and emits it to every new broadcast-SSE subscriber on connect. The HTTP client keeps the id of the last inbox event of each actor, and it sends that id in `Last-Event-ID` at each reconnect. The server then sends only the later buffered messages. At delivery, the server signs a buffered message or a local advert again if its envelope is older than `clockSkewSec / 2`. Thus the client skew check accepts it. If an inbox event is larger than `maxSseEventBytes`, the client skips that event by its id (ADR 153). The cases with no skip are in [SSE event size limit](./http-transport.md#sse-event-size-limit). See [http-transport.md](./http-transport.md) for the HTTP transport's own deployment knobs (CORS, rate limiting, inbox buffer size, advert TTL, event size limit).

### Cohort TTL and phase timeouts

Unchecked, a stalled cohort (e.g. a participant goes offline mid-signing) keeps state machine entries alive forever. Two knobs on the runner bound that:

- `cohortTtlMs`: overall wall-clock budget from `run()` to `signing-complete`. On expiry: emit `cohort-failed`, reject `run()` with a timeout error, call `session.removeCohort(cohortId)`.
- `phaseTimeoutMs`: maximum time allowed without a phase transition. Reset automatically on every observed phase change.

Both are unset by default: enable them in any production deployment.

### Message size limits

`AggregationService` enforces `maxUpdateSizeBytes` (default 256 KiB) on the canonicalized size of each `SUBMIT_UPDATE` body. It checks the size before it checks the proof of the update. Oversized payloads are dropped silently at the state-machine level and surfaced as `message-rejected` events with code `UPDATE_TOO_LARGE`. This protects against cheap bandwidth/CPU exhaustion from a hostile participant. Tune downward if your DID documents are typically smaller.

### Inbound messages never fail a cohort

`AggregationService.receive()` does not throw on anything a sender controls. Every receive-path handler checks membership and round/session duplication itself. The handlers of a partial signature and of a fallback signature also verify the signature. The handler of an update does not verify the proof of the update (see [Sender authentication](#sender-authentication)). A handler records a `Rejection` for a message that it drops, so that no cohort or signing-session invariant throws. This matters because `AggregationServiceRunner` treats an escaping error as a cohort failure (`removeCohort` + rejected completion), so a single throw on that path would be a cohort-kill available to anyone who can reach the service: a non-member ack, a never-accepted opt-in's submission, a duplicated nonce from a transport retry, or one malformed nonce.

This covers cohort formation as well. `COHORT_OPT_IN` carries the sender's own `participantPk` and `communicationPk`, and the wire guard asks only that they be bytes: a three-byte or off-curve key is checked on arrival and dropped as `INVALID_PARTICIPANT_KEY`. A stored one would not be refused until the operator accepted the sender, at which point sorting the cohort keys (or aggregating them at keygen) throws inside an operator action the runner is driving, i.e. the cohort dies for a message anyone could have sent. `AggregationCohort.isValidCohortKey()` is the shared check, and the `cohortKeys` setter applies it to every key it stores, so no inbound path can carry a malformed key as far as key aggregation.

Two consequences worth designing around:

- A contribution that is rejected is not stored, so the sender can simply send a correct one. A member blamed for a bad partial signature (`INVALID_PARTIAL_SIG`) can retry within the same round.
- A round whose members never send valid contributions now stalls rather than failing fast, exactly as it would for a silent member. Set `phaseTimeoutMs` / `cohortTtlMs` (and `autoFallbackOnStall` for the k-of-n script path) so stalls terminate in bounded time.

The operator-facing action methods (`acceptParticipant`, `finalizeKeygen`, `startSigning`, ...) still throw: those are programming errors in the caller, not untrusted input.

Rejections are retained per cohort until drained, capped at `MAX_RETAINED_REJECTIONS` (256, oldest dropped first). The runner drains after every message, so the cap only applies to callers driving the state machine directly.

### Sender authentication

Every protocol message declares its own sender in `from`, and the protocol acts on that claim. A participant records the service DID that an advert names, and encrypts to the key that the advert declares. A service seats the DID that an opt-in names. The service accepts an update of that member only if `proof.verificationMethod` is a DID URL of that DID. Apart from this check, the service validates only the structure of the proof. It does not verify the signature: a resolver verifies it (ADR 152).

Each transport separately authenticates a *key*: Nostr by the event signature (`event.pubkey`), HTTP by the signed envelope (`envelope.from`). The two must be bound, or anyone able to reach the wire can speak as any DID.

Both transports enforce that bind on every receive path, and it is what `resolveSenderPk` is for:

- **`resolveSenderPk` is required for inbound traffic from anyone who is not already a registered peer.** It maps a DID to its communication key without the transport knowing anything about did:btcr2; `@did-btcr2/method` exports `resolveBtcr2SenderPk` as that decode. A message whose `from` resolves to no key is dropped, not trusted. Pass it to `NostrTransport`, `HttpClientTransport` and `HttpServerTransport` alike.
- A message whose declared `from` did not sign the event or envelope carrying it is dropped (HTTP answers `401 sender_mismatch` on the POST routes).
- A message that advertises a `communicationPk` (a cohort advert, an opt-in) must advertise the key it just authenticated with, so a sender cannot authenticate as itself while having the cohort encrypt to, or attribute keys to, a different key.
- An EXTERNAL (`x1`) sender is authenticated from the self-verifying genesis document it carries in-band on its opt-in, on both transports (ADR 066). `resolveBtcr2SenderPk` takes the key of the `capabilityInvocation[0]` method in the initial DID document that the genesis document gives. That method must be able to sign an update of the DID (ADR 147). It must have the type `Multikey`, the DID as its controller, and a BIP340 Multikey key in base58btc text. If the method does not agree with these conditions, `resolveBtcr2SenderPk` returns no key, and the transport drops the opt-in. A KEY (`k1`) sender has no such condition: its DID decodes to its key.
- `resolveBtcr2SenderPk` also returns no key for an EXTERNAL (`x1`) sender if the resolver refuses its genesis document. For example, the resolver refuses a genesis document without `@context` (ADR 148). A genesis document without `service` gives the key, if the `capabilityInvocation[0]` method agrees with the conditions above.

`AggregationParticipant` then holds every service-originated message (`COHORT_READY`, `DISTRIBUTE_AGGREGATED_DATA`, `AUTHORIZATION_REQUEST`, `AGGREGATED_NONCE`, `FALLBACK_AUTHORIZATION_REQUEST`) to `from === serviceDid` for the cohort it names, and the nonce and fallback messages to the active signing session's id, so a stranger cannot drive a member's cohort even on a transport that does not authenticate at all. `InMemoryTransport` is exactly that transport: it is an in-process test harness and performs no inbound authentication.

The transport key of a DID is its genesis key: `resolveBtcr2SenderPk` reads no current DID document. For a KEY (`k1`) DID, this is the key in the DID. For an EXTERNAL (`x1`) DID, it is the key of the `capabilityInvocation[0]` method of the genesis document. `resolveBtcr2SenderPk` gives this key also after an update removes that key from the DID document (ADR 153). After a leak of that key, the holder can thus authenticate as the DID and join a cohort as the DID. The aggregate beacon of a cohort can be in the DID document. In that cohort, the holder can also make the cohort announce an update that no resolver can get. The DID then becomes invalid (an invalidation attack). After a rotation of that key:

- A transport accepts the current key only after `registerPeer(did, currentKey)`, or with a custom `resolveSenderPk` that calls `getAggregationCommunicationKey(currentDocument)`. `registerPeer` is a method of each transport. `getAggregationCommunicationKey` comes from `@did-btcr2/method`, and the caller resolves `currentDocument`. The peer registry comes before `resolveSenderPk`, so a registered old key stays in use until a new `registerPeer` call replaces it.
- The controller must remove from the DID document each aggregate beacon whose cohort key for the DID is the old key.

### Injectable logger

`NostrTransport` takes an optional `logger: Logger` in its config. `CONSOLE_LOGGER` is the default; `SILENT_LOGGER` is provided for tests and environments that want to suppress transport diagnostics. Implement the `Logger` interface (`debug`/`info`/`warn`/`error`) to route to pino, winston, Sentry, or a structured-logging pipeline.

### Beacon address funding

The `onProvideTxData` callback receives the cohort's `beaconAddress` and `signalBytes`. Before MuSig2 signing can succeed, that address must already hold a UTXO. There are two common patterns:

- **Pre-funded address**: the service operator funds the address out-of-band (e.g., via a watcher process) before the cohort starts signing. Simpler operationally.
- **First-update funding**: a participant funds the beacon address for its first update. It pays a small amount to the address in its own transaction, before the signing round. The beacon transaction does not also spend the funding input.

Either way, the runner doesn't manage funding: it only signs the tx you provide.

The beacon transaction must have exactly one input, and that input must spend the beacon UTXO. Each member refuses a transaction with more inputs (`INVALID_TX_STRUCTURE`) or with another prevout script (`PREVOUT_SCRIPT_MISMATCH`). `buildAggregationBeaconTx` of `@did-btcr2/method` builds a transaction with one input.

### Transaction broadcasting

The runner produces a signed transaction but does NOT broadcast it. After `runner.run()` resolves, you broadcast `result.signedTx.toHex()` yourself via your Bitcoin connection. This separation keeps the runner free of Bitcoin RPC dependencies.

```typescript
const result = await runner.run();
const txid = await bitcoin.rest.transaction.send(result.signedTx.toHex());
console.log('Broadcast:', txid);
```

### CAS publishing

For `CASBeacon` cohorts, the CAS Announcement Map needs to be published to a content-addressed store (typically IPFS) so that resolvers can fetch it via the on-chain hash. This is also the operator's responsibility: read it from `runner.session.getCohort(cohortId).casAnnouncement` after `signing-complete` and publish via your CAS client.

### Decision callback latency

Decision callbacks are awaited inline in the protocol flow. If your `onOptInReceived` or `onProvideTxData` is slow (e.g., waiting for human review), the protocol blocks until the callback resolves. For UIs, you typically want to:

1. Surface the decision in the UI immediately (via the corresponding event)
2. Hold the callback open until the user clicks
3. Resolve the callback with the user's decision

This is exactly the pattern an interactive client app should follow.

One `onOptInReceived` call blocks only its own opt-in. The service runner processes other opt-ins while the call waits. Thus the cohort can change before the operator decides. The runner ignores an approval in these cases:

- `finalizeKeygen` ran, so the membership is final. The runner emits `message-rejected` with the rejection code `MEMBERSHIP_FINAL`.
- The cohort already has `maxParticipants` members. The runner emits `message-rejected` with the rejection code `COHORT_FULL`.
- The same DID sent a new opt-in. Only the decision for the new opt-in applies. The runner emits no event for the old decision.
- The runner stopped, or the cohort completed or failed. The runner emits no event.

If the DID is not a member after an ignored approval, the participant gets no message and stays in the OptedIn phase. `AggregationParticipantRunner` has no timeout, so the participant application must set its own deadline (for example, call `stop()`).

The service runner calls `onProvideTxData` at most one time for each cohort. If the cohort fails or the runner stops while `onProvideTxData` runs, the runner does not start the signing round. In the participant runner, a callback that waits at `stop()` has no effect after it returns: the runner sends no message for it.

### Error recovery

There is no automatic retry for participant dropout. If a participant goes offline mid-protocol the cohort will either stall out until `phaseTimeoutMs`/`cohortTtlMs` fires, or deadlock indefinitely if neither is set. Your application should:

- Set `cohortTtlMs` and/or `phaseTimeoutMs` so stalls terminate in bounded time
- Listen for `cohort-failed` to drive operator UI / retry logic
- Listen for `message-rejected` to surface individual submission failures back to the offending participant
- Use a generous `minParticipants` floor so a single dropout isn't fatal
- For long-running participant runners, restart on the `error` event if necessary. A new runner does not know the cohorts of the old runner, so its `BEACON_TYPE_CONFLICT` check does not see them.
- Track which cohorts have completed via `signing-complete` / `cohort-complete`

### Wire-format version

Every `BaseMessage` carries a `version: number` field. The current version is exposed as `AGGREGATION_WIRE_VERSION`. Receive handlers reject any message whose version doesn't match: there is no implicit backward compatibility. Bumping the constant is a breaking protocol change; coordinate across all participants and any relay / transport middleware before changing it.

---

## Extension Points

### Beacon strategy registry

The service and the participant accept only the beacon types in `KNOWN_BEACON_TYPES`: `CASBeacon` and `SMTBeacon`. The [spec](https://dcdpr.github.io/did-btcr2/beacons/aggregate-beacons.html) says: "DID controllers can use a CAS Beacon, an SMT Beacon, or both to participate in BTCR2 Update Aggregation." `createCohort` refuses another type, and the participant drops an advert of another type. Thus you cannot add a beacon type. `registerBeaconStrategy(strategy)` replaces the built-in strategy of the same type, for each cohort in the process. The example below wraps the built-in `CASBeacon` strategy and keeps its checks.

```typescript
import type { AggregateBeaconStrategy } from '@did-btcr2/aggregation';
import { getBeaconStrategy, registerBeaconStrategy } from '@did-btcr2/aggregation';

// Get the built-in strategy before you replace it.
const builtIn = getBeaconStrategy('CASBeacon')!;

const LoggedCasStrategy: AggregateBeaconStrategy = {
  type : 'CASBeacon',

  // Service-side: build the aggregated data on the cohort.
  buildAggregatedData(cohort) {
    builtIn.buildAggregatedData(cohort);
    console.log('CAS Announcement Map built for cohort', cohort.id);
  },

  // Service-side: per-participant payload for DISTRIBUTE_AGGREGATED_DATA.
  getDistributePayload(cohort, participantDid) {
    return builtIn.getDistributePayload(cohort, participantDid);
  },

  // Participant-side: validate the aggregated data against the local update.
  validateParticipantView(params) {
    return builtIn.validateParticipantView(params);
  },

  // Participant-side: recompute the 32-byte signal from the data just
  // validated, the same way buildAggregatedData derives cohort.signalBytes.
  // The participant refuses to sign unless the coordinator's announced signal
  // is this value, so a strategy that cannot derive one (returns undefined)
  // never gets a signature. Do not read the announced signal back out of
  // `body`: that would bind the data to itself and authorize anything.
  deriveSignal(result) {
    return builtIn.deriveSignal(result);
  },
};

registerBeaconStrategy(LoggedCasStrategy);
```

After the call, each `CASBeacon` cohort in the process uses the new strategy, on the service side and on the participant side. The participant uses `validateParticipantView` and `deriveSignal` to decide if it signs. Thus a replacement must keep the checks of the built-in strategy.

### Discriminated message types

For consumers writing custom transports or middleware, every message type has a narrow body interface and a type guard exported from `@did-btcr2/aggregation`:

```typescript
import type { AggregationMessage, BaseMessage, CohortOptInBody } from '@did-btcr2/aggregation';
import {
  isCohortOptInMessage,
  isSubmitUpdateMessage,
  isAuthorizationRequestMessage,
} from '@did-btcr2/aggregation';

function route(msg: BaseMessage) {
  if(isCohortOptInMessage(msg)) {
    // msg.body is narrowed to CohortOptInBody here
    const { cohortId, participantPk } = msg.body;
    // ...
  } else if(isSubmitUpdateMessage(msg)) {
    // msg.body is narrowed to SubmitUpdateBody
    // ...
  }
}
```

`AggregationMessage` is the full discriminated union of every well-formed message variant.

### Sans-I/O introspection helpers

Some state-machine methods added for runner plumbing are also useful from custom transports:

| Method | Purpose |
|---|---|
| `session.drainRejections(cohortId)` | Pop the list of silent drops recorded since the last drain. The runner forwards these as `message-rejected` events. The state machine does not record `MEMBERSHIP_FINAL` or `COHORT_FULL`: the service runner emits these rejection codes for a dropped approval. |
| `session.removeCohort(cohortId)` | Remove a cohort from `#cohortStates` once it's finished. Used by the runner on successful completion and on fail. |

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
| Replace a beacon strategy | [Beacon strategy registry](#beacon-strategy-registry) |
| Narrow an incoming message | [Discriminated message types](#discriminated-message-types) |
| Pick a public Nostr relay | [Relay selection](#relay-selection-nostr-transport-only) |
| Configure the HTTP transport | [http-transport.md](./http-transport.md) |
| Bound a stalled cohort | [Cohort TTL and phase timeouts](#cohort-ttl-and-phase-timeouts) |
