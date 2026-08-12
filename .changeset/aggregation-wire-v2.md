---
'@did-btcr2/aggregation': minor
---

Authenticate the aggregation wire protocol, bind participant signatures to cohort state, and bound service resources.

BREAKING:

- The aggregation wire version is bumped to 2: signed Nostr envelopes are mandatory (unsigned events are dropped) and `ValidationAckBody.signalBytesHex` is required, so mixed-version peers fail loudly on a version mismatch instead of silently dropping each other's messages.
- Participants refuse to sign a beacon transaction unless input 0 spends the funded outpoint declared on the authorization request, the transaction has exactly one input (the beacon spend), the OP_RETURN signal recomputes from the cohort's validated update set, change returns to the beacon address, and the fee stays within the configured ceiling.
- `buildRecoverySpend` zeroizes the caller's recovery-secret buffer once the key has been consumed (on the signing path and on the key-mismatch throw). Parameter-validation throws still leave the buffer intact for a corrected retry; callers that need the key beyond one call must pass a copy.

Added:

- MuSig2 intake validation: nonce points are point-checked and partial signatures length-checked, and an invalid partial signature triggers a bounded blame-and-retry with the offender evicted rather than failing the whole cohort.
- Service resource bounds: a default participant ceiling, opt-in pruning, a fail-closed nonce cache (a full cache rejects new admissions instead of evicting live in-window entries), and DID-keyed rate limiting ahead of nonce admission.
- Transport hardening: fail-closed event parsing with sentinel validation, sender authentication on cohort-driving handlers, stale-replay rejection, a clamped clock-skew window, and rebinding or dropping HTTP client messages whose inner sender mismatches the authenticated sender.
- The transport factory accepts and forwards `resolveSenderPk` and `clockSkewSec` for Nostr transports, so factory-built peers can receive a first advert from an unregistered sender.

Fixed:

- Cohort-kill vectors: malformed opt-in keys, non-string proof fields, and wrong-length partial signatures are recorded as per-message rejections instead of escaping as untyped throws that fail the cohort.
- Validation acknowledgments are bound to the distributed signal hash, and fallback authorization requests are bound to the in-flight session.
