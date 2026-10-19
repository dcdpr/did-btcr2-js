# ADR 150: The Api Refuses an Unknown `publishToCas` Value, and Each Option Refusal Has the Type `INVALID_OPTIONS`

- **Status:** Accepted
- **Date:** 2026-10-19
- **Packages:** `@did-btcr2/api` (MINOR: `DidMethodApi.update`, `DidMethodApi.deactivate`, `DidBtcr2Api.updateDid`, and `DidBtcr2Api.deactivateDid` refuse an `announce.publishToCas` value other than `'never'`, `'auto'`, and `'always'`. Four other option refusals change their type from `INVALID_DID_UPDATE` to `INVALID_OPTIONS`); `@did-btcr2/cli` (PATCH: dependency uptake)

## Context

### The api did not check the `publishToCas` value

`announce.publishToCas` selects the CAS publication policy of an update ([ADR 071](071-api-cas-publication-policy.md), [ADR 073](073-cas-publication-is-opt-in.md)). The type `PublishToCasMode` has three values: `'never'`, `'auto'`, and `'always'`. The default is `'never'`, so CAS publication is opt-in (ADR 073, decision 1).

The type does not apply at run time. A caller without the TypeScript types can give any value, for example a value from a JSON configuration file. The default of `DidMethodApi.update` applies only to `undefined`. `#planCasPublication` stopped the publication only for the string `'never'`. Thus each other value acted as `'auto'`.

The api checked `announce.feeRate` at run time, but not `announce.publishToCas`. The cli is not affected, because it refuses another `--publish-to-cas` value at parse time.

### Two failure modes

1. With a writable CAS, a value such as `null` or `'Never'` published the signed update before the broadcast. For a CAS beacon, it also published the CAS Announcement. A CAS publication is permanent: the controller cannot remove the update from the CAS.
2. With a read-only CAS, a typo of `'always'` such as `'Always'` skipped the publication silently. Then the update spent the beacon UTXO. The caller asked for a guarantee that the update reached the CAS (ADR 073, decision 3), and did not get it.

### Examples

| `publishToCas` | CAS | Before | After |
|---|---|---|---|
| `null`, `'Never'`, `'none'`, `false`, `0` | writable | The api publishes the signed update, then broadcasts. | `UpdateError` of type `INVALID_OPTIONS`, before any I/O |
| `'Always'`, `'always '` | read-only | The api skips the publication, then broadcasts. | `UpdateError` of type `INVALID_OPTIONS`, before any I/O |
| `undefined` | any | No publication (the default `'never'`) | No change |
| `'never'`, `'auto'`, `'always'` | any | The policy of ADR 073 | No change |

### The specification texts for the publication

The specification does not define the api options. These texts apply to a CAS publication:

- Privacy Considerations: "**did:btcr2** was designed such that updates to Decentralized Identifier (DID) documents are NOT REQUIRED to be public."
- Privacy Considerations, CAS Systems Lack Privacy: "These SHOULD be considered public." Also: "Those parties most concerned about privacy SHOULD maintain their [BTCR2 Updates] in a [Sidecar] manner and provide them to necessary parties during resolution."
- Beacons: "If the [BTCR2 Update] committed to by the [BTCR2 Update Announcement] is not publicly discoverable (i.e., is not published to a [CAS] under its hash), the only parties that are aware of it are the DID controller and any parties provided it by the DID controller."

The SHOULD texts apply to the DID controller, not to the implementation. The default `'never'` lets the controller obey them. A value that the api did not check took this choice away from the controller.

### The specification texts for the error type

- Errors, `INVALID_DID_UPDATE`: "An error was found when creating or applying a [BTCR2 Update]." Also: "Refines [`INVALID_DID_DOCUMENT`]."
- Errors: "In the HTTP(S) binding, a resolver SHOULD send the HTTP status code of the error type that the error refines."
- DID Resolution, `INVALID_DID_DOCUMENT`: "The DID document was malformed." The HTTP(S) binding gives it the status code 500.
- DID Resolution, `INVALID_OPTIONS`: "One or more of the options provided for DID Resolution or DID URL dereferencing are invalid." The HTTP(S) binding gives it the status code 400.

Before this change, four other option refusals of the write path had the type `INVALID_DID_UPDATE`:

- both `announce.feeRate` and `announce.feeEstimator`
- an `announce.feeRate` that is not a positive finite number
- no Bitcoin connection: no `announce.bitcoin`, and no `BitcoinApi` on the `DidBtcr2Api` instance
- `'always'` with no writable CAS

The resolver already uses `INVALID_OPTIONS` for a resolution option that is not valid, for example `minConf`, `versionId`, and `versionTime`.

## Decision

### 1. The api refuses each other value

`DidMethodApi.update` refuses a `publishToCas` value other than `'never'`, `'auto'`, and `'always'`. `undefined` still gives the default `'never'`. The api does not normalize a value, for example `'Never'` to `'never'`. Thus the api does not guess a policy for the caller.

### 2. The check runs first in `update()`

The `publishToCas` check is the first check of `update()`. It runs before the `feeRate` checks and before the check of a deactivated source document. Thus the api refuses the value before any read, signature, CAS publication, or broadcast.

The other write paths call `update()`:

- `DidMethodApi.deactivate` refuses an already deactivated source first ([ADR 094](094-deactivation-is-an-ordinary-update.md)). Then it calls `update()`.
- `DidBtcr2Api.updateDid` and `DidBtcr2Api.deactivateDid` with a DID resolve the DID first, because the source state comes from the resolution. A resolution is a read, so it publishes nothing. With a `SourceState`, these methods do no resolution.

### 3. The message does not hold the value

The message is `` `announce.publishToCas` must be 'never', 'auto', or 'always'. ``. `data.publishToCas` holds the value. `String()` throws a `TypeError` for an object without a prototype, so the message does not hold the value. The `feeRate` message still holds `String(feeRate)`. This change does not change that message.

### 4. Each option refusal has the type `INVALID_OPTIONS`

The new refusal and the four other option refusals of the write path are an `UpdateError` of type `INVALID_OPTIONS`. An api option is not a part of a BTCR2 Update or of a DID document. `INVALID_DID_UPDATE` refines `INVALID_DID_DOCUMENT`, which DID Resolution defines for a malformed DID document, with the status code 500. `INVALID_OPTIONS` names options that are not valid, with the status code 400. The caller gave the wrong value, so the code 400 fits.

The other refusals of the write path keep the type `INVALID_DID_UPDATE`. Examples are a deactivated source document (ADR 100), an update after which no method can sign an update (ADR 147), the derivation of the method and the beacon, the funding check, and the network mismatch.

### 5. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| The api refuses the value. It does not normalize the value. | Privacy Considerations: updates are "NOT REQUIRED to be public". | Conforms. A refusal publishes nothing. The specification does not define the api options. |
| An api option refusal has the type `INVALID_OPTIONS`. | DID Resolution: `INVALID_OPTIONS` for options that "are invalid". Errors: `INVALID_DID_UPDATE` refines `INVALID_DID_DOCUMENT`. | Conforms. The specification names no error for an update option. `INVALID_OPTIONS` has the nearest meaning. |
| `updateDid` with a DID resolves before the check. | The specification gives no order for the api checks. | Conforms. A resolution publishes nothing. |

## Alternatives

- **Normalize the value, for example `'Never'` to `'never'`.** Rejected. A normalization guesses the intent of the caller. A wrong guess publishes a permanent record, or it skips a publication that the caller asked for.
- **Treat each unknown value as `'never'`.** Rejected. This prevents only the first failure mode. A typo of `'always'` then still skips the publication silently.
- **Keep the type `INVALID_DID_UPDATE`.** Rejected. The type refines `INVALID_DID_DOCUMENT`, an error in the document, with the status code 500. The update and the document have no error.
- **Add a new error type to the api.** Rejected. DID Resolution already defines `INVALID_OPTIONS`, and the resolver uses it.
- **Throw a `RangeError` or a `TypeError`.** Rejected. Each other refusal of the write path is an `UpdateError` with a type, so a caller can test one error class.
- **Check the value only in `#planCasPublication`.** Rejected. That function runs after the signature and after the funding read. The check must run before any I/O.

## Consequences

- The api package gets a MINOR release. A caller that gives a value other than the three modes now gets an `UpdateError`. A caller that tests the type of the four other option refusals must now test `INVALID_OPTIONS`.
- The cli gets a PATCH release for the dependency uptake. The cli refuses another `--publish-to-cas` value at parse time, so its behavior does not change.
- The method package and the aggregation package get no change.
- The test vectors do not change. No vector holds an api option.

**Unchanged.**

- ADR 073: the three modes and the default `'never'`.
- ADR 094: `deactivate` refuses an already deactivated source first.
- ADR 100: the refusal of a deactivated source document keeps the type `INVALID_DID_UPDATE`.

## Implementation

- `packages/api/src/method.ts`: the check at the start of `update()`, the type `INVALID_OPTIONS` for the four other option refusals, and the JSDoc of `PublishToCasMode` and `update()`.
- `packages/api/tests/did-method-api-cas-policy.spec.ts`: nine values with a writable CAS (no signature, no UTXO read, no CAS publication), three typos of `'always'` with a read-only CAS, the check before the deactivated check, `deactivate()`, and `DidBtcr2Api.updateDid` with a `SourceState`. The type checks of the four other option refusals.
- `packages/api/README.md` and `packages/api/docs/DEMO.md`: the refusal, the message, and the error types.

## References

- [did:btcr2 specification, Privacy Considerations](https://dcdpr.github.io/did-btcr2/appendix/privacy-considerations.html), [Beacons](https://dcdpr.github.io/did-btcr2/beacons.html), and [Errors](https://dcdpr.github.io/did-btcr2/errors.html).
- [DID Resolution v1.0](https://www.w3.org/TR/did-resolution/): the Errors section and the HTTP(S) binding.
- [ADR 071](071-api-cas-publication-policy.md), [ADR 073](073-cas-publication-is-opt-in.md), [ADR 094](094-deactivation-is-an-ordinary-update.md), [ADR 100](100-update-path-refuses-a-deactivated-source.md), and [ADR 147](147-only-the-method-that-signs-an-update-must-be-a-bip340-multikey-and-both-update-paths-check-that-method.md).
