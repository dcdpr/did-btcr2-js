---
'@did-btcr2/method': minor
'@did-btcr2/api': minor
'@did-btcr2/cli': patch
---

A relative DID URL resolves against the DID by RFC 3986, section 5, and the resolver expands relative DID URLs on request (ADR 162).

- method: Breaking: `Appendix.absoluteDidUrl` resolves each form of a relative DID URL: `#key-1`, `?v=1#key-1`, `/keys#key-1`, `keys#key-1`, and a path with dot segments. `""` gives the DID. A value with a scheme and a value that starts with `//` stay unchanged. A `did` that is not a string gives `undefined`. `relationshipMethodId`, `capabilityInvocationEntry`, and `verificationMethodOfEntry` use the new result.
- method: Breaking: `DidBtcr2.update`, `DidBtcr2.getSigningMethod`, `Updater.signingMethod`, and `Updater.sign` accept a relative id in each form, for example `?key=1` and `/keys/1`. The message for an id that does not resolve to a DID URL is now `Invalid verificationMethodId: expected a DID URL, or a relative DID URL that resolves to a DID URL; got "<id>".` The error type does not change.
- method: Breaking: the resolver applies an update whose `capabilityInvocation` entry is a relative query or path form. The DID document check refuses two services whose ids give one absolute DID URL, for example `?s` and `<did>?s`. On the write path and the create path, it also refuses two method ids that give one absolute DID URL, for example `k` and `/k`. It refuses two references of one relationship in the same way.
- method: Breaking: `expandRelativeUrls: true` no longer gives `FEATURE_NOT_SUPPORTED`. The result `didDocument` is a copy with absolute DID URLs. A value with a scheme and a value that starts with `//` stay unchanged. A value of `expandRelativeUrls` that is not a boolean gives `INVALID_OPTIONS`.
- api: Breaking: `resolveDid` and `tryResolveDid` accept `expandRelativeUrls: true`. `updateDid` and `deactivateDid` refuse `expandRelativeUrls: true` in `options.resolutionOptions` with an `UpdateError` of type `INVALID_OPTIONS`, before any I/O. The message check does not resolve the `controller` of a method before it compares it with the DID. The browser bundle holds the method package.
- cli: the `resolve`, `update`, `deactivate`, and `message` docs; dependency uptake.
