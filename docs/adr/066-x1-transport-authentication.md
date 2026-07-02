---
title: "ADR 066: Trustless Transport Authentication for EXTERNAL (x1) DIDs via In-Band Genesis Documents"
---

# ADR 066: Trustless Transport Authentication for EXTERNAL (x1) DIDs via In-Band Genesis Documents

**Status:** Accepted

**Date:** 2026-07-02

**Branch / PR:** `feat/x1-k1-transport-auth`

**References:** [ADR 016](016-sans-io-resolver.md), [ADR 028](028-http-transport-additive.md), [ADR 046](046-extract-aggregation-package.md), [ADR 050](050-split-aggregation-packages.md), [ADR 051](051-update-verifies-signing-key.md), [ADR 054](054-cryptosuite-method-agnostic.md), [ADR 062](062-identifier-encoding-hardening.md)

## Context

An aggregation cohort is a set of DID controllers who coordinate a single on-chain
beacon transaction. To join a cohort over a transport that authenticates inbound
messages (today, HTTP/REST), a participant sends a signed opt-in envelope, and the
service verifies that envelope against a communication public key it resolves from the
participant's DID.

did:btcr2 has two identifier types (ADR 062). A **KEY** (`k1`) identifier is a Bech32m
encoding of a 33-byte compressed secp256k1 public key: the DID string *is* the key. An
**EXTERNAL** (`x1`) identifier is a Bech32m encoding of the SHA-256 hash of a genesis DID
document: the DID string is a cryptographic commitment to a document, not a key.

The HTTP transport resolves the sender key through an injected callback that method
supplies, `resolveBtcr2SenderPk` (`packages/method/src/core/did-sender-resolver.ts`). That
callback only handled the KEY case:

```ts
const components = Identifier.decode(did);
if (components.idType === 'KEY') {
  return new CompressedSecp256k1PublicKey(components.genesisBytes); // k1: DID is the key
}
return undefined; // x1: genesisBytes are a document hash, not a key
```

For an `x1` sender the callback returns `undefined`, so
`HttpServerTransport.#handleMessagesPost` rejects the opt-in `401 unknown_sender` before
any handler runs. The service *does* already learn a participant's communication key from
the opt-in body and register it (`service-runner.ts`, `registerPeer(msg.from,
optIn.communicationPk)`), but that code never executes for an `x1` sender because the
envelope is rejected before the runner sees it. This is a chicken-and-egg deadlock: the
peer registry is populated from the opt-in, but the opt-in cannot be authenticated until
the registry is populated.

The functional requirement is that **both `k1` and `x1` identifiers participate as
first-class cohort members over every transport** (`http`, `nostr`, `in-memory`, and any
future transport). Today only `k1` works over HTTP.

### Why the gap is HTTP-specific

`NostrTransport` never resolves `did -> pk` to authenticate inbound messages: each message
is a self-signed Nostr event, authenticity rides the event signature, and the DID is merely
asserted in the content. Its peer registry is used only to encrypt and route outbound
messages, so the population timing does not gate authentication. `in-memory` enforces no
inbound auth at all. The HTTP transport made the opposite, stricter choice (verify a
detached envelope against a resolved key), which is why only it rejects an unregistered
`x1` sender. The fix targets how and when the peer registry is populated, and trusted, for
`x1` senders on transports that authenticate inbound.

### The insight that makes a trustless fix possible

An `x1` DID is a commitment to its genesis document: `x1 = bech32m('x', [versionNetworkByte,
...sha256(canonical genesis document)])` (`Identifier.encode`, EXTERNAL branch). A genesis
document supplied by an untrusted party is therefore **self-verifying**: recompute its
canonical SHA-256 hash and compare to the `genesisBytes` decoded from the DID; if they
match, the document authentically belongs to that DID. The genesis document declares the
DID's verification methods, so the authoritative communication key can be extracted from it
with zero trust, exactly as a `k1` key is extracted from the DID string with zero trust.
This means no trust-on-first-use is needed. Two things are required: (a) get the `x1`
controller's genesis document to the verifier, and (b) define which verification method in
it is the communication key.

## Decision

Keep `k1` behavior byte-identical. Add an `x1` path that is trustless and backward-compatible.
The design is captured by four locked decisions (labelled A through D, from the source
specification) plus the implementation-level decisions this ADR records (D1 through D9).

### A. Synchronous, genesis-in-hand sender resolution (`@did-btcr2/method`)

`resolveBtcr2SenderPk` gains an optional second parameter and stays synchronous:

```ts
export function resolveBtcr2SenderPk(
  did: string,
  opts?: { genesisDocument?: object },
): CompressedSecp256k1PublicKey | undefined;
```

- `k1`: unchanged. The genesis document is ignored; the key is decoded from the DID.
- `x1`: if `opts.genesisDocument` is supplied and it hashes to the DID, return the
  designated communication verification method's public key (rule B). Otherwise
  `undefined`, which preserves the exact one-argument behavior when no genesis is supplied.

The hash check and document resolution reuse `Resolver.external(Identifier.decode(did),
genesisDocument)` verbatim (D3): that method already recomputes `canonicalHashBytes(genesis)`,
compares it to the identifier's `genesisBytes` with `equalBytes` (throwing on mismatch),
re-encodes the DID, and returns a resolved `DidDocument` with the `did:btcr2:_` placeholder
replaced by the absolute DID (so string references in `capabilityInvocation` become absolute
verification-method ids). Any throw from that path is caught and mapped to `undefined`, so a
mismatched or malformed genesis behaves exactly like "no genesis supplied."

A genesis-*fetching* resolver (one that resolves the DID or reads a store to obtain the
genesis itself) is deliberately deferred: the genesis is always carried in-band on the
opt-in (decision C), so the resolver is handed the bytes and never performs I/O. Keeping it
synchronous means no change to the existing synchronous `#resolveSenderPk` call sites.

### B. The communication key is `capabilityInvocation[0]`

The aggregation communication key for a DID is the verification method referenced by
`capabilityInvocation[0]`, resolved to its public key. For `k1` the deterministic document's
single key is already the sole `capabilityInvocation` entry, so this rule is a no-op for KEY
DIDs and preserves their behavior. For `x1`, `capabilityInvocation[0]` is resolved against
the genesis document (a string reference dereferenced by id in `verificationMethod`, or an
embedded verification method used directly), and its `publicKeyMultibase` (`zQ3s...`) is
decoded to the key.

**No `verificationMethod[0]` fallback.** If `capabilityInvocation` is absent, the `x1`
participant is **rejected**. A document without `capabilityInvocation` cannot be updated at
all (the update path requires a `capabilityInvocation` verification method: construct and
sign check the signing method is in `capabilityInvocation`, the proof is built with
`proofPurpose: 'capabilityInvocation'`, and resolve verifies it against that same
relationship), so it is useless for aggregation, and binding to any other verification
method would break the invariant below.

Binding the transport communication key to `capabilityInvocation` (rather than
`authentication`, the DID-core-orthodox choice for sender authentication) yields the
invariant **transport-authenticated as D implies control of a `capabilityInvocation` key of
D implies authorized to update D**. An impostor who cannot update D is rejected at opt-in
time rather than later at update-submit time, and the rule stays consistent with how `k1`
already behaves. `authentication[0]` was considered and rejected: it would permit a separate
cold update key and weaken the binding.

This is a new normative rule, and it must be identical on all three sides: the participant
(the key it signs envelopes with and declares as `communicationPk`), the resolver (the key
`resolveBtcr2SenderPk` returns), and the service (which cross-checks the declared
`communicationPk` against it). It is implemented once as an exported helper,
`getAggregationCommunicationKey(document)`, so the three sides cannot drift.

### C. Deliver the genesis in-band on the opt-in

`CohortOptInBody` gains an optional `genesisDocument` field (typed
`Record<string, unknown>`, D5). It is populated when the joining identity is `x1` and omitted
for `k1`. This is the least protocol churn and is symmetric with how the service already
learns `communicationPk` from the opt-in. A dedicated registration endpoint or handshake
message was rejected (see below).

### D. Trustless only; no trust-on-first-use

The genesis is self-verifying against the `x1` DID, so the communication key is extracted
with zero trust. The service never registers a self-asserted key on faith. Trust-on-first-use
(registering whatever `communicationPk` an unauthenticated opt-in declares, then trusting it
thereafter) is rejected for a public, self-hostable aggregator: it would let anyone occupy a
cohort slot as any `x1` DID and grief or deny service to a cohort, even though they still
could not produce a valid signed update. A deployment that ever wants that behavior can gate
it behind an explicit, default-off flag; it is not the default.

### Server bootstrap ordering (D4)

The cross-check happens at the transport boundary, in
`HttpServerTransport.#handleMessagesPost`, replacing the bare `401` that previously fired
when `#resolveSenderPk` returned `undefined`. The bootstrap derives and verifies a key but
registers nothing itself; registration is deferred until the request clears every downstream
gate. The order is strict and every failure keeps the `401` (no trust-on-first-use, no
partial registration):

1. Revive and flatten the still-untrusted envelope's message; require it to be a
   `COHORT_OPT_IN` carrying a `genesisDocument`. (A non-opt-in from an unknown sender, or an
   opt-in with no genesis, stays `401` as before.)
2. Derive the key: `resolveSenderPk(from, { genesisDocument })`. A genesis that does not hash
   to `from`, or a document with no usable `capabilityInvocation` key, yields `undefined` and
   stays `401`.
3. Cross-check the derived key against the opt-in's declared `communicationPk`
   (`equalBytes`); a mismatch stays `401`. This prevents a controller from authenticating
   with one key while advertising a different signing key to the cohort.
4. Verify the envelope signature against the derived key (`verifyEnvelope`). Failure is a
   `401` and, crucially, mutates no state (the bootstrap holds the derived key in a local, not
   the peer registry).
5. Continue through the normal gates on the same request: replay/nonce (`409`),
   rate-limit (`429`), recipient present and a registered actor (`400` / `404`), and the
   sender-binding check below.
6. Only after all of the above pass, `registerPeer(from, derivedKey)` using the
   **genesis-derived** key, never the self-asserted one, then dispatch. A request that is
   rejected at any gate leaves no peer-registry entry behind, so an unauthenticated party
   cannot grow the (unbounded) registry by replaying self-minted `x1` opt-ins to a
   nonexistent recipient.

### Bind the inner message to the authenticated envelope

The envelope signature authenticates `envelope.from`, but the dispatched message carries its
own `from`, and the runner trusts that inner `from` (it records the opt-in and registers a
peer under `message.from`). The transport therefore rejects (`401 sender_mismatch`) any
request whose flattened `message.from` differs from the authenticated `envelope.from`, before
dispatch or registration. Without this bind, a party authenticated as its own DID `A` could
carry an inner `COHORT_OPT_IN` claiming `from: x1:Victim`, and the runner would seat `Victim`
into the cohort under `A`'s key and poison the peer registry `Victim -> A`'s key, defeating
the whole point of authenticating the sender. This binding is not specific to `x1` (a `k1`
`A` could spoof any inner `from` the same way); it is a general transport-auth property that
this change adds so the invariant "transport-authenticated as `D`" actually holds for the DID
the cohort acts on. With the bind in place, `message.from == envelope.from`, so the runner's
existing `registerPeer(msg.from, optIn.communicationPk)` re-registers the same
genesis-derived key the transport just registered (an idempotent no-op for the `x1` peer) and
needs no functional change (D9); it is left in place with a clarifying comment.

### D6. Bound the bootstrap body size

Genesis verification is a hash plus a few field checks, but the genesis arrives from an
unauthenticated party before that check runs. A new optional `maxBodyBytes` transport config
(default 64 KiB, comfortably above a real genesis document) bounds the parsed body of the
authenticated POST routes and returns `413` before the body is read, so a large fake genesis
cannot exhaust memory ahead of the hash check.

### D1, D2, D7: placement and participant coupling

- **D1.** The `getAggregationCommunicationKey` helper lives in
  `did-sender-resolver.ts` alongside `resolveBtcr2SenderPk`, so it is exported through the
  existing barrel and stays coupled to the resolver that consumes it.
- **D2.** The helper decodes `publicKeyMultibase` through the existing
  `SchnorrMultikey.fromVerificationMethod(vm).publicKey` path (the same canonical `zQ3s`
  to 33-byte decode the resolver already uses to verify update proofs), rather than an
  inline base58 decoder. It dereferences `capabilityInvocation[0]` with a small local lookup
  by id against `verificationMethod`, not `getSigningMethod`, which defaults to `#initialKey`
  and does not resolve embedded methods.
- **D7.** For an `x1` participant, the caller supplies the `capabilityInvocation[0]`
  verification method's keypair as the participant's signing keys and registers that same key
  as the transport actor. This makes `communicationPk == participant public key == envelope
  signing key == genesis-derived key`, so the server cross-check passes. This is a documented
  caller contract; the server cross-check enforces it rather than trusting it.

### D8: out of scope, deferred

Client-side bootstrap (a participant authenticating an `x1` *service*), `x1` on the
inbox-subscribe GET, and any async genesis-fetching resolver are out of scope for this change
and left as follow-ups. The participant-side and service-side HTTP `resolveSenderPk` type is
widened symmetrically (D5) so both compile against the genesis-aware signature, but only the
server performs the bootstrap.

### Transport symmetry (D9)

`in-memory` and `nostr` need no code change: `in-memory` enforces no inbound auth, and
`nostr` authenticates by event signature, so an `x1` participant already completes a cohort
on both once the participant emits its genesis-derived signing key. `in-memory` gains a unit
symmetry test (a mixed `k1` + `x1` cohort completing with a valid aggregate signature); the
`nostr` path, which needs a live relay, is exercised by the `e2e-nostr-transport.ts` script
(one KEY and one EXTERNAL participant), mirroring the HTTP e2e. The `didcomm` stub gains a
comment noting the same `x1` requirement for when it is implemented.

### Method-agnosticism preserved (ADR 046, ADR 054)

`@did-btcr2/aggregation` still does not depend on `@did-btcr2/method` (method remains a
dev-only dependency for its tests). The `genesisDocument` field is typed
`Record<string, unknown>` on the wire, matching the sibling opt-in body fields, and the
genesis-aware resolver stays injected: the only in-repo injector is the aggregation e2e
harness, which stands in for an external application. The transport learns nothing about
did:btcr2 beyond "the injected resolver may consume a `genesisDocument` hint from a bootstrap
opt-in."

## Security analysis

- **Trustless binding.** Because `x1 = commit(hash(genesis))`, a supplied genesis that hashes
  to the DID authenticates the DID's key set with zero trust, equivalent to `k1`'s
  decode-the-key. An attacker cannot register `x1:Victim -> attackerKey`: they would need a
  genesis that hashes to `x1:Victim` yet authorizes `attackerKey`, i.e. a SHA-256 second
  preimage of the victim's genesis. So `x1` is exactly as squat-resistant as `k1`.
- **Impersonation with the real genesis.** An attacker who replays the victim's real genesis
  derives the victim's key `Kv`, but `verifyEnvelope` then fails because the attacker cannot
  sign with `Kv`'s secret. Rejected `401`.
- **Advertised-vs-authenticated key split.** The `communicationPk` cross-check (step 3)
  guarantees the key a controller authenticates with is the key it advertises to the cohort,
  closing a split where a controller could authenticate as one key and have the cohort
  encrypt or attribute to another.
- **Inner/outer sender confusion.** The transport authenticates `envelope.from` but the runner
  acts on the inner `message.from`. Binding the two (`message.from == envelope.from`, else
  `401 sender_mismatch`) is what makes the trustless `x1` bootstrap meaningful: without it a
  party authenticated as its own DID could carry an inner opt-in claiming `x1:Victim` and poison
  the registry `Victim -> attacker key` (a hole that predates this change and applies equally to
  `k1`). The bind closes it for both identifier types.
- **No trust-on-first-use, no state mutation on failure.** Registration happens only with the
  genesis-derived key and only after every gate (verify, replay, rate-limit, recipient,
  sender-binding) passes, so an unauthenticated or otherwise-rejected opt-in cannot seat itself
  in the registry. In particular a self-minted `x1` opt-in addressed to a nonexistent recipient
  is rejected `404` with no registry write, so it cannot be replayed to grow the (unbounded)
  peer map.
- **Denial of service.** The `maxBodyBytes` cap bounds the pre-hash memory an unauthenticated
  genesis can consume. Replay, nonce, and rate-limit paths are unchanged: the bootstrap only
  supplies the key consumed by the existing verify pipeline. The genesis hash is computed
  before the per-`from` rate limiter (as `verifyEnvelope` already hashes the envelope), so a
  flood of fresh self-minted `x1` DIDs is throttled only by the body cap, not the per-`from`
  limiter; a deployment exposed to that can add a per-IP limit at its own proxy.

## Consequences

- An `x1` participant completes a cohort over HTTP, in-memory, and nostr, and a mixed
  `k1` + `x1` cohort produces a valid aggregate signature.
- `resolveBtcr2SenderPk(did)` with no second argument is unchanged (`k1` to key, `x1` to
  `undefined`); every existing call site compiles and behaves identically. The new
  `getAggregationCommunicationKey` and the widened resolver signature become part of the
  method package's public surface via the existing barrel.
- `CohortOptInBody.genesisDocument` is optional; existing `k1` opt-ins and older participants
  are unaffected. No change to MuSig2, cohort finalization, beacon-tx construction, or DID
  resolution.
- The communication-key selection rule is defined once and shared, so participant, resolver,
  and service cannot disagree about which key authenticates an `x1` DID.
- `@did-btcr2/method` and `@did-btcr2/aggregation` both take a minor bump under 0.x semantics:
  the change is additive (a new optional parameter, a new optional wire field, a new exported
  helper, a new transport config) and this ADR serves as the release note. `api` and `cli`
  have no functional change (neither injects the resolver).

## Rejected alternatives

- **Trust-on-first-use.** Register whatever `communicationPk` an unauthenticated opt-in
  declares. Rejected: it lets anyone occupy a cohort slot as any `x1` DID and grief a cohort.
  The genesis makes a fully trustless binding available, so there is no reason to accept a
  weaker one by default.
- **A dedicated `/v1/register` route or `PEER_HELLO` message.** Carry `{ did, genesisDocument
  }` in a separate self-signed step that populates the registry before the opt-in. Cleaner
  transport layering, but it adds a route and an onboarding round-trip. Rejected in favor of
  carrying the genesis on the opt-in, which reuses the existing "learn the key from the
  opt-in" flow with no new endpoint.
- **`authentication[0]` as the communication key.** DID-core-orthodox for sender
  authentication and would allow a separate cold update key. Rejected in favor of
  `capabilityInvocation[0]`, which gives the stronger transport-authenticated-implies-
  authorized-to-update invariant and matches `k1`.
- **A `verificationMethod[0]` fallback when `capabilityInvocation` is absent.** Rejected: such
  a document cannot be updated and is useless for aggregation, and any fallback verification
  method would break the update-authorization invariant. Absent `capabilityInvocation` is a
  hard rejection.
- **An async, genesis-fetching resolver.** Resolve the DID or read a store to obtain the
  genesis server-side. Rejected for now: it would make `#resolveSenderPk` asynchronous and add
  an I/O dependency to the transport. The genesis is already in hand on the opt-in, so a
  synchronous resolver is sufficient. Deferred as a follow-up if a non-in-band delivery is
  ever needed.
