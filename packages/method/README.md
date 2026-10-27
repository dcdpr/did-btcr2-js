# @did-btcr2/method

TypeScript reference implementation of the [did:btcr2 DID Method](https://dcdpr.github.io/did-btcr2/): a censorship-resistant Decentralized Identifier method using Bitcoin as a verifiable data registry.

This package is the core of the `did-btcr2-js` monorepo. It implements DID create/resolve/update operations and the three beacon types (Singleton, CAS, SMT). Multi-party aggregation over MuSig2 and the pluggable peer-to-peer transport layer live in the companion [`@did-btcr2/aggregation`](https://github.com/dcdpr/did-btcr2-js/tree/main/packages/aggregation) package, which builds on this one.

## Installation

```bash
pnpm add @did-btcr2/method
```

## What's in the Box

| Feature | Entry point |
|---|---|
| Create a DID (offline, deterministic or external) | `DidBtcr2.create()` |
| Resolve a DID (sans-I/O state machine) | `DidBtcr2.resolve()` |
| Update a DID (sans-I/O state machine) | `DidBtcr2.update()` returns an `Updater` |
| Deactivate a DID (the update with the fixed patch) | `DidBtcr2.deactivate()` returns an `Updater`; `DEACTIVATION_PATCH` |
| Update utilities (construct, signing method, sign, announce) | `Updater.construct()`, `Updater.signingMethod()`, `Updater.sign()`, `Updater.announce()` |
| Beacon types (Singleton, CAS, SMT) | `SingletonBeacon`, `CASBeacon`, `SMTBeacon` |
| Fee estimation (pluggable) | `FeeEstimator`, `StaticFeeEstimator` |
| Signer abstraction (local key, KMS, custom) | `Signer` / `LocalSigner` from `@did-btcr2/keypair`; `KeyManagerSigner` from `@did-btcr2/key-manager` |
| DID document types and builders | `Btcr2DidDocument`, `DidDocumentBuilder` |
| Multi-party aggregation (MuSig2) and transport | `@did-btcr2/aggregation` (separate package) |

## Quick Start

### Create a DID

```typescript
import { DidBtcr2 } from '@did-btcr2/method';
import { SchnorrKeyPair } from '@did-btcr2/keypair';

// Deterministic (k-type): the identifier IS the public key
const keys = SchnorrKeyPair.generate();
const did = DidBtcr2.create(keys.publicKey.compressed, {
  idType  : 'KEY',
  network : 'mutinynet',
});
// did:btcr2:k1q5p...
```

### Resolve a DID

`DidBtcr2.resolve()` returns a sans-I/O state machine. The caller drives resolution by fulfilling typed data needs (beacon signals, CAS announcements, signed updates).

```typescript
import { DidBtcr2 } from '@did-btcr2/method';

const resolver = DidBtcr2.resolve(did, { sidecar });
let state = resolver.resolve();

while (state.status === 'action-required') {
  for (const need of state.needs) {
    const data = await fetchData(need);  // your I/O goes here
    resolver.provide(need, data);
  }
  state = resolver.resolve();
}

const { didDocument, metadata } = state.result;
```

See [`src/core/resolver.ts`](./src/core/resolver.ts) for the full `DataNeed` union and phase transitions.

Resolution processes a beacon signal only if its transaction has at least `minConf` confirmations. The default is `6` (`DEFAULT_MIN_CONF`), the value the specification mandates. A signal below the threshold is excluded as if it did not exist yet; the other signals are processed. Indexer signal discovery skips a mempool transaction before the threshold applies.

Pass `{ minConf: 1 }` to see a fresh update after one block, at a higher exposure to a block reorganization. `metadata.confirmations` reports the depth of the signal of the resolved version. A `minConf` that is not a positive integer fails with a `ResolveError` of type `INVALID_OPTIONS`.

The `metadata` of the result is the DID document metadata of the specification. `versionId`, `confirmations`, and `deactivated` are always present. `confirmations` is `0` and `updated` is absent if the resolved version is 1. Otherwise, `confirmations` and `updated` report the block of the update that yields the resolved version. `updated` is the `mediantime` of that block. A duplicate re-announcement does not change them.

An identifier that does not conform to the DID syntax fails with an `IdentifierError` of type `INVALID_DID`. A valid DID of another method, for example `did:example:a:b`, fails with the type `METHOD_NOT_SUPPORTED` (ADR 157). A did:btcr2 identifier that does not decode fails with `INVALID_DID`, also if the Bech32m decoder rejects the body. A sidecar genesis document whose hash is not the genesis bytes of the identifier fails with a `ResolveError` of type `INVALID_DID`.

Each hash step of the resolver uses JCS (RFC 8785). A value with no JCS form, for example a value that holds NaN, Infinity, or a lone surrogate, has no hash (ADR 154). The resolver handles such a value as follows:

- A genesis document fails with a `ResolveError` of type `INVALID_DID_DOCUMENT`.
- A signed update that `provide` gets for a `NeedSignedUpdate` fails with `INVALID_SIGNAL_DATA`, as an update with another hash does.
- A CAS Announcement that `provide` gets for a `NeedCASAnnouncement` fails with `MISSING_UPDATE_DATA`, as an announcement with another hash does.
- An update or a CAS Announcement in the sidecar data stays out of the lookup maps, so it has no effect. If a beacon signal needs it, the resolver asks for it with a data need.

The `data.cause` of each of these errors gives the type and the message of the `CanonicalizationError`. On the write path, `Updater.construct` and `Updater.sign` refuse a source document or a patch with no JCS form with an `UpdateError` of type `INVALID_DID_UPDATE`.

A genesis document from the sidecar or from the CAS gives the initial DID document. The resolver replaces each `did:btcr2:_` in the genesis document with the DID, and it adds no member (ADR 148). Then `@context` must contain the two btcr2 contexts, and the members must conform to DID Core v1.1 with the rules of a consumer (ADR 149). For example, each verification method needs a string `id` and `type` and a DID as its `controller`, and its key material must have a valid form. On the read path, the check does not read the syntax of a top-level `controller` item, an `alsoKnownAs` item, a service `id`, or a `serviceEndpoint`. A failed check gives a `DidDocumentError` of type `INVALID_DID_DOCUMENT`. For example, a genesis document without `@context` fails with the message `Invalid "@context"`. A genesis document without `service` gives a DID document without `service`, and the resolver asks for no beacon signal.

Two resolution options select a version. The two options are mutually exclusive. A request with both, or with a value that does not parse, fails with `INVALID_OPTIONS` before any data need. The resolver processes the updates in version order. Each option selects the version as follows:

- **`versionId`** is an ASCII string of an integer, for example `"2"`. The resolver keeps the state at this version, so `"1"` returns the genesis document also if updates exist. A version that the history does not reach, also a version after a deactivation, fails with a `ResolveError` of type `NOT_FOUND`.
- **`versionTime`** is an XML Datetime in UTC with the `Z` designator and no fraction, for example `"2026-07-01T00:00:00Z"`. The resolver keeps the state before the first new version whose block `mediantime` (median time past) is after that instant. A `mediantime` equal to the instant is not after it. If no new version is after the instant, the result is the current version. Every conformant resolver reads the same `mediantime` from the block chain, so every resolver selects the same version.

After the resolver keeps the state, it processes the rest of the history. Then it returns the kept state (ADR 145). Thus an error in a later update fails a historical request, as it fails a request for the current version. Examples are `LATE_PUBLISHING` for a second, different update with the same version, and `INVALID_DID_UPDATE` for an invalid later update. The resolver also emits the data needs of each later update, for example `NeedBeaconSignals` for a beacon that a later update adds. An opt-in `maxDiscoveryRounds` counts the discovery rounds of the full history.

`DidBtcr2.resolve` checks the resolution options after the DID and before it returns the `Resolver`, in the order of DID Resolution v1, section 4.4 (ADR 157). An option with the value `undefined` is absent.

- An option name that `ResolutionOptions` does not hold fails with a `ResolveError` of type `FEATURE_NOT_SUPPORTED`.
- `expandRelativeUrls: true` fails with `FEATURE_NOT_SUPPORTED`. The resolver returns each relative DID URL of the DID document unchanged. `false` has no effect.
- `accept` must be an Accept header value (RFC 9110, section 12.5.1), for example `'application/did'`. The resolver returns a data structure, so the value has no effect.
- `noCache` must be `true`, `false`, `'true'`, or `'false'`. The resolver keeps no cache, so the value has no effect.
- A wrong value of `accept`, `expandRelativeUrls`, `noCache`, `sidecar` (not an object), or `maxDiscoveryRounds` (not a number) fails with `INVALID_OPTIONS`.

The resolver processes one update per pass, as the specification describes. After each applied update it scans the beacon addresses that the document now carries and that it did not scan yet, then it continues with the next update. The resolver ignores a signal at a beacon address that an applied update removed from the document: the signal stamps no metadata and changes no version. A `BeaconSignal` carries the block `height`, the header `time`, the `mediantime`, and the `confirmations` of its block. Both discovery paths fill `mediantime`: the indexer path reads the Esplora block record once per distinct block, the fullnode path reads the RPC block.

### Update a DID

`DidBtcr2.update()` returns a sans-I/O state machine: the counterpart to the Resolver. The caller drives the update by fulfilling typed data needs (signing key, funding confirmation, broadcast).

```typescript
import { DidBtcr2, Updater } from '@did-btcr2/method';
import { LocalSigner } from '@did-btcr2/keypair';
import { BitcoinConnection } from '@did-btcr2/bitcoin';

// Build a Signer from a raw secret key. For KMS-backed keys use KeyManagerSigner
// from '@did-btcr2/key-manager' instead.
const signer = new LocalSigner(secretKeyBytes);
const bitcoin = new BitcoinConnection({ network: 'mutinynet', rest: { host: 'https://mutinynet.com/api' } });

// Ids are resolved against the source document before matching, so either the
// absolute DID URL (`${did}#initialKey`) or the relative one (`#initialKey`)
// works, whichever the document itself uses. Documents this package generates
// write the absolute spelling.
const updater = DidBtcr2.update({
  sourceDocument,
  patches              : [{ op: 'add', path: '/service/-', value: newService }],
  sourceVersionId      : 1,
  verificationMethodId : `${sourceDocument.id}#initialKey`,
  // `service` is optional (ADR 148). Nobody can announce an update for a document without a beacon service.
  beaconId             : sourceDocument.service![0].id,
});

let state = updater.advance();
while (state.status === 'action-required') {
  for (const need of state.needs) {
    switch (need.kind) {
      case 'NeedSigningKey':
        // need.verificationMethodId is the absolute DID URL of the method.
        // If the caller gave the relative id '#initialKey', it is '<did>#initialKey'.
        updater.provide(need, signer);
        break;
      case 'NeedFunding':
        // Check UTXOs at need.beaconAddress, fund if needed
        updater.provide(need);
        break;
      case 'NeedBroadcast': {
        // Capture the BroadcastResult: broadcast.txid, plus broadcast.announcement
        // (CAS beacons) and broadcast.proof (SMT beacons; must be retained, the
        // proof's nonce exists nowhere else).
        const broadcast = await Updater.announce(
          need.beaconService, need.did, need.signedUpdate, signer, bitcoin
        );
        updater.provide(need);
        break;
      }
    }
  }
  state = updater.advance();
}

const { signedUpdate } = state.result;
```

See [`src/core/updater.ts`](./src/core/updater.ts) for the full `UpdaterDataNeed` union and phase transitions.

An update carries the `@context` array that the specification pins, in this order: `https://w3id.org/json-ld-patch/v1`, `https://w3id.org/zcap/v1`, `https://w3id.org/security/data-integrity/v2`, `https://btcr2.dev/context/v1`. `Updater.construct()` writes the array, and the proof of the signed update repeats it. The package exports the array as `BTCR2_UPDATE_CONTEXT`. The array is inside the hashed and signed bytes, so an update with a different array is a different update. The resolver rejects an update with a different array, or with a proof `@context` that differs from the update `@context`, with a `ResolveError` of type `INVALID_DID_UPDATE`.

Both update paths apply the checks of the specification. Each failure that the specification names is an `UpdateError` on the write path, or a `ResolveError` on the read path, of type `INVALID_DID_UPDATE`. The inner error of the cryptosuite, the multikey, or the patch rides along as `data.cause`.

Both paths apply the patch with the rules of RFC 6902 and RFC 6901 (ADR 155). The first operation that fails, a failed `test` included, fails the whole patch. These operations fail, for example:

- an unknown `op`, or an `add` with no `value`
- a pointer with a wrong syntax
- an array index with a leading zero or past the end
- a `remove` or a `replace` of a location that does not exist
- a `move` into a child of its `from`
- a path to an inherited JavaScript member, such as `toString`

Each member name is data, also `constructor` and `__proto__`.

The patched document must keep the DID as its `id`, and it must conform to DID Core. The write path applies the rules of a producer, and the read path applies the rules of a consumer (ADR 149). A producer also refuses an item that occurs two times in a set, two methods or services with one `id`, a `secretKeyMultibase`, and a URL with a wrong syntax.

`Updater.signingMethod(sourceDocument, verificationMethodId)` returns the verification method that signs an update. `DidBtcr2.update()` calls it before it returns the `Updater`, and `Updater.sign()` calls it again. An entry of `capabilityInvocation` must identify `verificationMethodId`, as a reference or as an embedded method object. `Updater.signingMethod()` resolves the id of each entry and `verificationMethodId` to absolute DID URLs before it compares them. A reference entry must name a member of `verificationMethod`. The resolver applies the same lookup and the same method conditions to `update.proof` (ADR 147).

The id of the method must be a DID URL under the DID: the DID, then a fragment, a query, or a path. Examples are `<did>#key-1`, `<did>?key=1`, and `<did>/keys/1`. A relative id must start with `#`. The write path refuses the relative ids `?key=1` and `/keys/1`, an id under another DID, and a URI that is not a DID URL. The proof and `NeedSigningKey.verificationMethodId` name the method by its absolute DID URL.

The method must agree with three conditions:

1. `type` is `Multikey`.
2. `controller` is the DID, `sourceDocument.id`.
3. `publicKeyMultibase` encodes a secp256k1 public key as a BIP340 Multikey, in the base58btc text of the key. A value that only starts with `zQ3s` does not agree with this condition.

A method that fails a condition gives an `UpdateError` of type `INVALID_DID_UPDATE`. An example message is `Invalid update: verificationMethod.type must equal "Multikey"`. `data.field` names the field that fails. If `publicKeyMultibase` is a string, a key failure also gives `data.cause`. It holds the type and the message of the decode error. For text that is not the canonical encoding of the key, it holds the type `VERIFICATION_METHOD_ERROR` and the message `Invalid publicKeyMultibase: not the base58btc encoding of the key`. The conditions apply only to the method that signs. For each other verification method, `DidDocument` checks only that `id`, `type`, and `controller` are strings.

`Updater.sign(sourceDocument, unsignedUpdate, verificationMethodId, signer)` signs an update of `sourceDocument`. Make `unsignedUpdate` with `Updater.construct()` from the same `sourceDocument`. Before it signs, `Updater.sign()` checks the unsigned update in this order:

1. `unsignedUpdate` is an object with no `proof` member.
2. `targetVersionId` is an integer of 2 or more.
3. `@context` is the array `BTCR2_UPDATE_CONTEXT`.
4. `sourceHash` is the hash of `sourceDocument`.
5. `patch` gives a valid DID document from `sourceDocument`.
6. `targetHash` is the hash of that DID document.

The first check that fails gives an `UpdateError` of type `INVALID_DID_UPDATE`, with a message that starts with `Invalid unsignedUpdate:`. Each check after the object check names its field in `data.field`. For the patch check, `data.cause` holds the error of `Updater.construct()`. `Updater.sign()` does not get the version number of `sourceDocument`. The caller must make sure that `targetVersionId` is the version of `sourceDocument` plus 1. A resolver refuses another value.

The public key of the signer must be the key of the method. If the two keys differ, `Updater.sign()` gives an `UpdateError` with a message that starts with `Signing key does not match verification method`.

`Updater.sign()` wraps an error of the signer or of the cryptosuite as an `UpdateError` of type `INVALID_DID_UPDATE`, with the inner error in `data.cause`. The message of a wrapped error starts with `Invalid signer:` if the public key of the signer does not decode. If the public key decodes, the message starts with `Invalid update: cannot make the proof with`. For example, a key manager that holds only the public key gives the second message, with `KEY_NOT_SIGNER` in `data.cause.type`.

`Updater.sign()` verifies the proof with the public key of the verification method before the state machine asks for funding. A signer that returns a wrong signature spends no beacon UTXO. `Updater.sign()` returns a new object and adds no proof to its input, so the caller can sign the same unsigned update again.

`Updater.construct()` refuses a `sourceVersionId` that is not an integer of 1 or more, with `Invalid sourceVersionId: expected an integer of 1 or more.` `DidBtcr2.update()` also refuses such a `sourceVersionId`.

`Updater.construct()` also refuses a `sourceDocument` that is not an object, with `Invalid sourceDocument: expected a DID document object.` It refuses a `sourceDocument.id` that is not a string, with a message that starts with `Invalid sourceDocument: expected a string id`. Each refusal is an `UpdateError` of type `INVALID_DID_UPDATE` (ADR 156).

On the read path, the resolver checks each proof field by string equality before it verifies the signature. `type` is `DataIntegrityProof`, `cryptosuite` is `bip340-jcs-2025`, `proofPurpose` is `capabilityInvocation`, `capabilityAction` is `Write`, `capability` is `urn:zcap:root:${encodeURIComponent(did)}`, and `invocationTarget` is the DID. A proof can carry `created` and `expires`. Each value must be an XML Datetime with a timezone. `created` must not be after the header time of the block that contains the Beacon Signal. `expires` must not be before the `mediantime` of that block, and not before `created`. The write path sets neither field.

`DidBtcr2.deactivate()` is `DidBtcr2.update()` with the patch `[{ "op": "add", "path": "/deactivated", "value": true }]`, exported as `DEACTIVATION_PATCH`. Resolution stops at the deactivation for good. The factory does not refuse a source document that is deactivated already. The api does.

### Update Aggregation (Multi-Party MuSig2)

Aggregation lets multiple DID controllers coordinate a single Bitcoin transaction that announces all of their updates at once, signed n-of-n with MuSig2. That subsystem now ships as its own package, [`@did-btcr2/aggregation`](https://github.com/dcdpr/did-btcr2-js/tree/main/packages/aggregation), which builds on this one. Its high-level `Runner` API hides the message routing and decision plumbing:

```typescript
import { AggregationServiceRunner } from '@did-btcr2/aggregation/service';
import { TransportFactory } from '@did-btcr2/aggregation';
import { getNetwork } from '@did-btcr2/bitcoin';
import { buildAggregationBeaconTx } from '@did-btcr2/method';

// Pick a transport. Nostr (relay-based) or HTTP/REST (operator-hosted).
const transport = TransportFactory.establish({
  type   : 'nostr',
  relays : ['wss://relay.damus.io'],
});
// Or for HTTP: { type: 'http', role: 'server' } on the operator side,
//              { type: 'http', role: 'client', baseUrl: '...' } on the participant side.

transport.registerActor(serviceDid, serviceKeys);
transport.start();

// onProvideTxData reads `runner`. The runner calls onProvideTxData only after
// the constructor returns.
const runner: AggregationServiceRunner = new AggregationServiceRunner({
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
  // The transaction must spend the beacon output. buildAggregationBeaconTx finds
  // a UTXO at beaconAddress and puts signalBytes in the last output (OP_RETURN).
  onProvideTxData : async ({ cohortId, beaconAddress, signalBytes, feeEstimator }) => {
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
});

runner.on('signing-complete', (result) => console.log('done'));
const result = await runner.run();
```

The full step-by-step protocol walkthrough (service flow, participant flow, decision callbacks, events, the low-level state machine API, and production deployment notes) is in [`docs/aggregation.md`](./docs/aggregation.md). The HTTP/REST transport has its own walkthrough in [`docs/http-transport.md`](./docs/http-transport.md). See the [`@did-btcr2/aggregation`](https://github.com/dcdpr/did-btcr2-js/tree/main/packages/aggregation) package for the runnable APIs those guides describe.

This package exports `resolveBtcr2SenderPk`, which gives the communication key of a sender DID to the aggregation transports. For an EXTERNAL (`x1`) sender, the key is the key of the `capabilityInvocation[0]` method in the initial DID document that its genesis document gives. That method must agree with the three conditions of the method that signs an update. If it does not, `resolveBtcr2SenderPk` returns `undefined`, and the transport drops the message.

If the resolver refuses the genesis document, `resolveBtcr2SenderPk` also returns `undefined`. For example, the resolver refuses a genesis document without `@context` (ADR 148). A genesis document without `service` gives the key, if the method agrees with the three conditions.

`resolveBtcr2SenderPk` reads no current DID document, so it gives the genesis key also after an update removes that key (ADR 153). After a leak of that key, the holder can act as the DID in a cohort and can make the DID invalid. The steps after a key rotation are in [Sender authentication](./docs/aggregation.md#sender-authentication).

## Architecture Principles

- **Sans-I/O core.** The Resolver (read path) and Updater (write path) state machines perform zero I/O. They compute state transitions and emit typed needs. Callers handle all network operations. The aggregation state machines in `@did-btcr2/aggregation` follow the same pattern.
- **Layered APIs.** High-level facades encapsulate boilerplate; low-level state machines stay available for tests, custom transports, and fine-grained control.
- **Pluggable transport.** The `@did-btcr2/aggregation` package decouples protocol logic from the wire format via a `Transport` interface, shipping Nostr (relay-based) and HTTP/REST (framework-agnostic, browser-compatible) adapters, plus a DIDComm stub. Add your own for libp2p or anything else.
- **Browser-compatible.** All code targets both Node.js (>= 22) and modern browsers. No Node-only APIs in the core.
- **Primitive values in error messages.** An error message holds a value of the caller only if the value is a primitive, for example a string or a number. For an object or a function, the message holds no value. The error `data` always holds the value (ADR 156).

## Build & Test

```bash
# From packages/method/
pnpm build              # Compile ESM + CJS + browser bundle
pnpm build:tests        # Compile tests to tests/compiled/
pnpm test               # Run the test suite with coverage
pnpm lint               # ESLint (zero warnings tolerated)
```

Tests run from compiled JS, so run `pnpm build:tests` before `pnpm test` after any test changes.

## Documentation

- **Package docs on btcr2.dev** [btcr2.dev/impls/ts](https://btcr2.dev/impls/ts)
- **[`docs/beacon-system-overview.md`](./docs/beacon-system-overview.md)** Beacon architecture, Singleton / CAS / SMT behavior, signal discovery
- **[`docs/aggregation.md`](./docs/aggregation.md)** Multi-party aggregation protocol, Runner and state machine APIs, e2e examples (the runnable APIs live in `@did-btcr2/aggregation`)
- **[`docs/http-transport.md`](./docs/http-transport.md)** HTTP/REST transport: wire protocol, signed envelopes, SSE subscriptions, Hono/Node framework mount example, permissive CORS (shipped by `@did-btcr2/aggregation`)
- **Source reference** See JSDoc comments on public classes; the most important entry points are `DidBtcr2` (facade), `Resolver` (read path), and `Updater` (write path).

## License

[MPL-2.0](https://github.com/dcdpr/did-btcr2-js/blob/main/LICENSE)
