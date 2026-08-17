---
title: "ADR 090: Bind a Message's Claimed Sender to Its Authenticated Key on Every Aggregation Receive Path"
---

# ADR 090: Bind a Message's Claimed Sender to Its Authenticated Key on Every Aggregation Receive Path

**Status:** Accepted

**Date:** 2026-08-19

**Branch / PR:** `fix/critical-high-security-findings`

**References:** [ADR 027](027-aggregation-security-hardening.md), [ADR 028](028-http-transport-additive.md), [ADR 038](038-musig2-key-custody.md), [ADR 046](046-extract-aggregation-package.md), [ADR 050](050-split-aggregation-packages.md), [ADR 062](062-identifier-encoding-hardening.md), [ADR 066](066-x1-transport-authentication.md), [ADR 088](088-read-path-update-authorization.md)

**Relationship to ADR 066:** this ADR **extends** ADR 066; it does not supersede it. Every
decision 066 records (A through D, D1 through D9) stands unchanged: `capabilityInvocation[0]`
is still the aggregation communication key, the genesis still rides in-band on the opt-in, the
server still refuses trust-on-first-use, and the HTTP `POST /v1/messages` bootstrap ordering is
untouched. What changes is scope. ADR 066 stated the inner-to-outer sender bind as a general
transport-auth property but implemented it on exactly one route, and it recorded that
`NostrTransport` "authenticates by event signature, so an `x1` participant already completes a
cohort." That second claim was too generous: the event signature authenticates the *event*, not
the DID asserted inside it. This ADR closes that gap and generalizes the rule to every receive
path on every transport.

## Context

Every aggregation protocol message carries a self-declared `from` DID, and the state machines act
on that claim rather than on any transport identity. A participant records the service DID an
advert names and registers the communication key that advert declares
(`participant/participant-runner.ts:274`). A service seats the DID an opt-in names and registers
the key it declares (`service/service-runner.ts:675`). Meanwhile each transport authenticates a
*key*: a nostr event carries a BIP-340 signature that `nostr-tools` verifies before delivery, and
an HTTP request carries a detached envelope signature that `verifyEnvelope` checks. Nothing joined
the two on most receive paths, so the party that authenticated and the party the protocol acted on
could be different people.

Five concrete gaps existed:

1. **`NostrTransport` performed no inbound authentication at all.** Neither
   `#makeActorEventHandler` (directed, kinds 1 and 1059) nor `#handleBroadcastEvent` (kind 1)
   compared `message.from` to `event.pubkey`. Anyone who could reach a relay could publish an
   event whose content claimed any DID.
2. **`POST /v1/adverts` lacked the bind that `POST /v1/messages` had.** ADR 066 added
   `401 sender_mismatch` to the messages route only.
3. **`HttpClientTransport`'s broadcast and inbox dispatch loops** revived, flattened, and
   dispatched the inner message without comparing its `from` to the authenticated `envelope.from`.
4. **The advertised-versus-authenticated key cross-check lived only inside the `x1` bootstrap.**
   ADR 066 decision B says a controller's communication key is a property of its DID; outside the
   bootstrap nothing enforced that the key a sender advertised was the key it signed with.
5. **`AggregationParticipant` accepted service-originated messages from any DID.** Handlers
   looked up the cohort by `cohortId` and proceeded, so a stranger who knew (or guessed, or
   observed) a cohort id could drive a member's state machine directly.

The sharpest consequence is a confidentiality break, not merely a nuisance. On nostr, a forged
`COHORT_ADVERT` naming a reputable service DID and carrying the attacker's `communicationPk`
causes the participant runner to register `serviceDid -> attackerKey`, after which every NIP-44
message that member sends to "the service" is encrypted to the attacker. The mirror image on the
service side is slot squatting: a forged opt-in seats a victim DID in a cohort under an
attacker-held key.

## Decision

### 1. Every receive path binds the claimed sender to the key that authenticated it

**Nostr.** Both receive paths route through `#flattenAndAuthenticate` before dispatch
(`core/transport/nostr.ts:475` for directed events, `:503` for broadcasts). Flattening happens
first, because the fields the check consults (`communicationPk`, `genesisDocument`) ride in
`body` and the handlers downstream read the flat shape; `#dispatchMessage` no longer flattens.
`#authenticateSender` then requires, in order:

- a non-empty string `from`;
- that `from` resolves to a key. Resolution consults the peer registry first, then the injected
  `NostrTransportConfig.resolveSenderPk`, exactly the order the HTTP transports use;
- that `bytesToHex(senderPk.x) === event.pubkey` (case-normalized), which is the bind itself;
- that a declared `communicationPk`, when present, is a `Uint8Array` equal to the authenticated
  key's compressed form. This is ADR 066's step-3 cross-check lifted out of the `x1` bootstrap and
  applied to every message that advertises a key (adverts and opt-ins). Without it a sender
  authenticates as itself and still tells the cohort to encrypt to, and attribute keys to,
  somebody else.

A failure at any step drops the event with a debug log. In particular, **an unresolvable sender is
dropped, not dispatched**: the transport fails closed. That matches the posture
`HttpClientTransport.#dispatchBroadcast` has always had for a broadcast from an unresolvable DID,
so the three transports now agree rather than one of them inventing a policy. The alternative,
dispatching when the DID cannot be resolved, would leave the whole class open in the default
configuration, since an attacker only ever needs to claim a DID the victim trusts.

**HTTP client.** Both dispatch loops drop a message whose inner `from` is not `envelope.from`
(`participant/http-client.ts:337-356` on broadcast, `:386-396` on inbox), and the broadcast loop
additionally applies the `communicationPk` cross-check.

**HTTP server.** `POST /v1/adverts` gains the `401 sender_mismatch` answer
(`service/http-server.ts:472-480`), placed after envelope verification, replay, rate limiting, and
the registered-actor check, and before the advert is cached or relayed. A mismatched advert
therefore never becomes `#currentAdvert` and never reaches a broadcast subscriber, and an
unregistered sender is still turned away by `403 not_an_actor` before the bind is even consulted.

### 2. Why binding to `event.pubkey` is sufficient on nostr

A nostr event id is a hash over `pubkey`, `created_at`, `kind`, `tags`, and `content`, and the
event's BIP-340 signature is over that id. The relay pool verifies it before `onevent` fires, so by
the time a handler sees an event, `event.pubkey` is an authenticated identity *and* it is
authenticated over the very content that carries the message's `from` claim. Comparing the two is
therefore a complete bind: there is no unsigned region an attacker could vary.

This is why nostr needs no second, detached envelope signature of the kind HTTP uses. HTTP has no
transport-level signature to borrow, so ADR 028 introduced a signed envelope and ADR 066 bound the
inner message to it. On nostr the transport already supplies the signature, so the fix is a
comparison rather than a new wire field. The wire format is unchanged, nothing is double-signed,
and an old publisher's events remain byte-identical to a new one's.

### 3. Why the advert route in particular

An advert is the one message a server relays **verbatim to every broadcast subscriber**, and it is
the message that bootstraps trust rather than consuming it. It names two things a recipient will
act on before it has any other source of truth: the service DID a participant will join (which the
participant's join filter matches against, and which every subsequent `#serviceCohortState` check
is measured against) and the communication key the participant will encrypt to. An unbound advert
therefore lets any actor the server relays for advertise a cohort in another DID's name and receive
the traffic encrypted to itself. Every later authorization decision in that cohort is downstream of
a lie told once, at the point where nothing yet exists to contradict it. The same reasoning is why
the nostr broadcast path is authenticated with the same rigor as the directed path.

### 4. The participant state machine holds messages to its cohort's service

Transport authentication is the first line; the state machine refuses to act on a stranger's
say-so regardless of transport, including the deliberately unauthenticated `InMemoryTransport` and
any caller driving the machine by hand. `#serviceCohortState` (`participant/participant.ts:289-296`)
resolves the named cohort and requires `message.from === state.serviceDid`; `COHORT_READY`,
`DISTRIBUTE_AGGREGATED_DATA`, `AUTHORIZATION_REQUEST`, `AGGREGATED_NONCE`, and
`FALLBACK_AUTHORIZATION_REQUEST` all route through it. `AGGREGATED_NONCE` additionally requires
the message to name the signing session the member is actually in
(`participant/participant.ts:829`), and the fallback request requires the optimistic round's id;
the service already applied the identical session check to everything it receives, so this makes
the two sides symmetric.

`COHORT_ADVERT` is deliberately exempt: the advert is what *establishes* the service DID, so there
is nothing yet to compare it against. Its authenticity is purely a transport property, which is
precisely why decision 3 above matters.

## Consequences

- The claim a message makes about who sent it is now backed by a key on every receive path of
  every transport that has one. Forged adverts, slot squatting, service impersonation, and
  advertised-key substitution are refused at the transport boundary, and service impersonation is
  refused a second time inside the participant.
- **Observable behavior changes.** `NostrTransport` drops any event whose message `from` is
  unresolvable, was not signed by that DID's key, or advertises a `communicationPk` other than the
  authenticating one. `POST /v1/adverts` answers `401 sender_mismatch`. `HttpClientTransport`
  silently drops mismatched broadcast and inbox messages. `AggregationParticipant` ignores
  service-originated messages from any DID other than its cohort's service, and nonce or fallback
  messages for any session other than the active one.
- `TransportFactory` forwards `resolveSenderPk`, and `NostrTransportConfigOption` now extends
  `NostrTransportConfig` rather than restating its fields, so future transport config additions
  reach the factory automatically.
- `@did-btcr2/aggregation` takes a minor bump under 0.x semantics: the config field is additive,
  but the transport refuses traffic it previously dispatched.

### The migration requirement for nostr consumers

`NostrTransportConfig.resolveSenderPk` is **optional and has no default**, and both receive paths
now authenticate through it. A transport constructed without it can only answer from the peer
registry, and that registry is bootstrapped by exactly the two messages the new check drops: a
participant registers the service only after handling an advert
(`participant/participant-runner.ts:274`), and a service registers a participant only after
receiving an opt-in (`service/service-runner.ts:675`). The result is a closed loop. An existing
consumer that upgrades and keeps

```ts
new NostrTransport({ relays });
```

finds that its cohorts never form: adverts and opt-ins are dropped, the registry stays empty, and
the only signal is a debug log. There is no error and no thrown exception.

This is a migration requirement, not a tuning knob. Callers driving did:btcr2 identities must pass
method's resolver:

```ts
new NostrTransport({
  relays,
  resolveSenderPk : resolveBtcr2SenderPk,
});
```

The aggregation package cannot ship that as a default. `resolveBtcr2SenderPk` lives in
`@did-btcr2/method`, and per ADR 046 and ADR 066 aggregation does not depend on method (it is a
dev-only dependency for tests). Injecting the resolver is what keeps the transport
DID-method-agnostic. The in-repo demo scripts under `packages/aggregation/lib/operations/` were
updated to inject it, and `packages/method/docs/aggregation.md` documents the requirement.

**Follow-up:** emit a one-time warning from the `NostrTransport` constructor when no
`resolveSenderPk` is supplied, naming the consequence ("only registered peers will be accepted").
A silent misconfiguration whose only symptom is "nothing ever happens" is the worst failure mode
this change introduces, and a constructor-time warning costs nothing.

## Residuals

Stated plainly, because each is a live limitation rather than a hypothetical.

### An EXTERNAL (`x1`) service cannot advertise over nostr

`CohortAdvertMessage` carries no `genesisDocument` field
(`core/messages/factories.ts:25-30`), unlike `CohortOptInMessage`, which does (`:31-38`). An `x1`
DID commits to a document hash, not a key, so with no genesis in hand `resolveSenderPk` returns
undefined and the advert is dropped. `x1` *participants* are unaffected: their opt-ins already
carry the genesis, so they authenticate exactly as ADR 066 intended, on nostr and over HTTP alike.
The same barrier already existed on the HTTP advert route, where an unresolvable sender has always
drawn `401 unknown_sender`; this change extends it to nostr.

The out-of-band workaround is `registerPeer(serviceDid, communicationPk)` on the participant side
before subscribing, which seeds the registry from a channel the operator already trusts. The fix
direction is to let adverts carry an optional `genesisDocument` the way opt-ins do, at which point
the existing self-verifying hash check authenticates an `x1` service with zero trust. ADR 066's
D8 deferred exactly this direction ("client-side bootstrap: a participant authenticating an `x1`
service"); it is now the blocking item for `x1` service operators rather than a theoretical gap.

### `participantPk` is self-declared and not tied to the sender's DID

The MuSig2 cohort key a member declares in its opt-in is never cross-checked against a key in that
member's DID document, so a member can seat a key it controls but has not published. Two things
bound the damage:

- An update signed by a key outside the DID's `capabilityInvocation` relationship fails at
  resolution (see [ADR 088](088-read-path-update-authorization.md)), and
  `#verifySubmittedUpdate` pins `proof.verificationMethod.split('#')[0] === sender`
  (`service/service.ts:667`), so the proof must at least name the sender's own DID. The residue is
  therefore pollution of the sender's own DID, not impersonation of another controller's.
- **This is not a rogue-key risk.** The question a reader will ask is whether an unvetted member
  key lets an attacker cancel the honest members' keys and control the aggregate alone. It does
  not: cohort keys are combined with BIP-327 key aggregation
  (`keyAggregate` from `@scure/btc-signer/musig2`, called at `core/cohort.ts:236`), which derives
  `L = taggedHash('KeyAgg list', ...publicKeys)` and gives each key the coefficient
  `taggedInt('KeyAgg coefficient', L, pk_i)`. Every coefficient commits to a hash of the full,
  sorted key list, so an attacker cannot solve for a key that cancels the others: doing so would
  require choosing a key whose own coefficient is known before the list containing it is fixed.
  `AggregationCohort.isValidCohortKey` additionally refuses anything that is not a 33-byte
  compressed curve point before it reaches aggregation.

### The `to` field is not checked against the receiving actor on nostr

On HTTP, `verifyEnvelope(..., { expectedTo })` pins the recipient
(`core/transport/http/envelope.ts:100`). On nostr, routing relies on NIP-44 encryption (only the
intended recipient can decrypt a kind 1059 event) and the relay's `#p` tag filter, and the message
body's `to` is never compared to the actor that received it. In practice the encryption is the
stronger control, but the asymmetry is real and worth closing for defence in depth.

### There is no replay protection or freshness window on nostr

The nostr path has no event-id cache, no `created_at` bound, and the directed subscription
deliberately carries no `since` filter so that messages survive a reconnect or crash recovery
(`core/transport/nostr.ts:424`). An authenticated peer can therefore re-publish, and a relay can
re-deliver, any event it has seen. Two things make that acceptable today:

- `cohortId` and `sessionId` are random UUIDs (`core/cohort.ts:142`,
  `core/signing-session.ts:72`) carried inside the event-signed body, so a captured message cannot
  be retargeted at a different cohort or a different signing session without breaking the event
  signature. Replay is confined to the exact context the message was minted for.
- Within that context, the phase guards and duplicate guards in both state machines absorb it: a
  message arriving out of phase is dropped, and a second response from the same member in the same
  round is rejected as a duplicate.

The follow-up is an explicit staleness window: reject events older than a configurable bound and
keep a bounded seen-event-id cache, the nostr analogue of the HTTP transport's nonce cache and
clock-skew check. That is a behavior change for reconnect semantics, which is why it is a
follow-up rather than part of this change.

### The HTTP server does not cross-check `communicationPk` on the non-bootstrap opt-in path

Only `#bootstrapSenderPk` applies the check. A `k1` controller can therefore still advertise a
communication key other than its DID key over HTTP, which ADR 066 decision B says it should not.
The declared key is still bound to the authenticated sender's DID by `sender_mismatch`, so nobody
else's traffic is affected. Closing it is a small addition to `#handleMessagesPost`, deliberately
left out here because it changes a path that currently succeeds.

### `InMemoryTransport` still performs no inbound authentication

It is an in-process harness whose entire purpose is delivering hand-built messages, and every
existing spec depends on that. The participant-side state-machine checks (decision 4) are what
make it acceptable to leave alone.

## Rejected alternatives

- **Dispatch when the sender is unresolvable, and only log.** Backwards-compatible for nostr
  consumers, and it would have avoided the migration requirement entirely. Rejected: an attacker
  only ever needs to claim a DID the victim trusts, so a transport that dispatches unresolvable
  senders leaves the entire class open in the default configuration. Fail-closed with a documented
  migration is the honest trade.
- **Ship a default did:btcr2 resolver inside `@did-btcr2/aggregation`.** Would make the upgrade
  seamless. Rejected: it inverts the package boundary set by ADR 046 and reaffirmed by ADR 066, by
  making the aggregation package depend on `@did-btcr2/method`. The transport is meant to know
  nothing about did:btcr2 beyond "the caller injects a resolver."
- **Add a detached envelope signature to nostr messages, mirroring HTTP.** Uniform across
  transports and would let one verification routine serve both. Rejected: the nostr event
  signature already covers the full content, so a second signature authenticates nothing new,
  changes the wire format, and forces every publisher to double-sign.
- **Trust the peer registry alone and skip the injected resolver.** Simplest possible transport
  change. Rejected: the registry is bootstrapped by precisely the two message types that need
  authenticating (advert and opt-in), so registry-only authentication can never accept a first
  contact and the protocol cannot start.
- **Enforce the bind only in the state machines, leaving the transports as they were.** Attractive
  because it is one place instead of four. Rejected: the confidentiality break happens in the
  runner, before the state machine sees anything, when it registers the advert's declared key for
  encryption. A check downstream of that registration is already too late.
- **Reject a message whose `communicationPk` differs, only for adverts.** Rejected as arbitrary:
  the opt-in declares a key the service will encrypt to and attribute cohort membership by, so the
  same reasoning applies with the same force. The rule is stated once, for any message that
  advertises a key.
