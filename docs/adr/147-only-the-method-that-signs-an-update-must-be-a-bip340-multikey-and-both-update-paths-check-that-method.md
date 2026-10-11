# ADR 147: Only the Method That Signs an Update Must Be a BIP340 Multikey, and Both Update Paths Check That Method

- **Status:** Accepted
- **Date:** 2026-10-11
- **Packages:** `@did-btcr2/method` (MINOR: `Updater.sign` takes the source document and a method id. `UpdaterParams.verificationMethod` becomes `verificationMethodId`. The package no longer exports `isMultikeyVerificationMethod` and `MULTIKEY_PUBLIC_KEY_MULTIBASE_PREFIX`. `DidVerificationMethod` and `DidDocument` accept a method of any type, with an optional `publicKeyMultibase`. The resolver, `Updater.sign`, and the sender key functions refuse a method that cannot sign. `getSigningMethod` reads only `capabilityInvocation` and raises `UpdateError`); `@did-btcr2/api` (MINOR: the browser bundle holds the method package. The new signature is `btcr2.signUpdate(source, unsignedUpdate, verificationMethodId, signer)`. `signUpdate`, `update`, and `createExternalFromDocument` refuse a document with no `capabilityInvocation` method that can sign. `signUpdate` refuses a `targetVersionId` that is not `source.versionId + 1`); `@did-btcr2/cli` (PATCH: dependency uptake. The `--help` text of `-m` names the new default); `@did-btcr2/aggregation` (PATCH: the service takes the DID of a proof id before the first `?`, `/`, or `#`. The participant JSDoc changes)

## Context

### The specification checks the method that signs

Specification pull request 389 ("Check the type, controller and key of the method that signs an update") merged on 2026-10-08. It changes "Construct BTCR2 Signed Update" of "Update" and "Check `update.proof`" of "Resolve". Each step finds the method through `capabilityInvocation`. Then it raises `INVALID_DID_UPDATE` if a condition is true "of the embedded verification method object, or of the verification method that the reference names":

- "`type` does not equal `"Multikey"`."
- "`controller` does not equal `did`." The update step names `sourceDidDocument.id`.
- "`publicKeyMultibase` does not encode a secp256k1 public key as the Multikey section of the BIP340 Cryptosuite specifies."

The specification has no rule for the other verification methods of a DID document. The only rule for the document is conformance to DID Core v1.1. Specification issue 388 ("Which verification methods can a did:btcr2 document hold?") is open. Option 1 of the issue keeps the rule of the old specification: only the method that signs must be a BIP340 Multikey. Option 2 requires a secp256k1 Multikey for each method. A comment on the issue favors option 1.

### The library checked each method, but not the method that signs

[ADR 057](057-did-document-validation-standards.md) made one predicate, `isMultikeyVerificationMethod`, the rule for each verification method: the type `Multikey` and a `publicKeyMultibase` that starts with `zQ3s`. The `DidVerificationMethod` constructor and the `DidDocument` validation applied it. The rule had three gaps against the specification:

1. A document with a method of another type failed, for example an Ed25519 authentication key. The specification does not refuse it.
2. The rule did not apply to a method that `capabilityInvocation` embeds. On the read path, no check compared the controller of the method that signs with the DID, or checked the type of an embedded method. For the key, the read path only decoded it, and the decoder accepts other text for the same key.
3. The prefix `zQ3s` is not the condition of the specification. It does not prove a 35-byte value, a valid point, or the canonical text.

### The write path signed what a resolver refuses

`Updater.sign(did, unsignedUpdate, verificationMethod, signer)` got the method object from the caller. It did not find the method through `capabilityInvocation`: only `DidBtcr2.update` did. It needed a `#` in the method id. It compared the key of the signer with the key of the method only if the method had a `publicKeyMultibase` ([ADR 051](051-update-verifies-signing-key.md)).

`Updater.sign` also signed an unsigned update with any `sourceHash`, `targetHash`, `@context`, or patch. A resolver refuses such an update after the announcement. An announced update is permanent, so the DID then no longer resolves.

### The decoder accepts other text for the same key

The base58btc decoder of `multiformats` ignores a run of UTF-16 code units above U+00FF directly after the `z` header. Thus `z`, then U+0100, then the rest of a canonical key text decodes to the same 35 bytes and the same key. A probe found 63232 such code points at that position: each code point from U+0100 to U+FFFF, except the surrogates. An astral character, which is two surrogates, gives the same result. The rule of ADR 057 refused the reference form of this text only by chance, because the text does not start with `zQ3s`. The rule did not apply to an embedded method.

### Examples

| Input | Before | After |
|---|---|---|
| A DID document with a member of `verificationMethod` of another type, for example an Ed25519 key for `authentication` only | `DidDocumentError` `INVALID_DID_DOCUMENT`. The resolver refuses an update that adds the method. | Valid |
| An update signed by an embedded `capabilityInvocation` method of type `JsonWebKey2020` with a valid secp256k1 key | The resolver applies the update | `INVALID_DID_UPDATE`: `Invalid update: verificationMethod.type must equal "Multikey"` |
| An update signed by an embedded method whose key text is `z`, U+0100, and the rest of the canonical text | The resolver applies the update | `INVALID_DID_UPDATE`, with the cause `Invalid publicKeyMultibase: not the base58btc encoding of the key` |
| `Updater.sign` with the method id `<did>?key=1`, which `capabilityInvocation` lists | Refused: the id must contain a fragment | Signs |
| `Updater.sign` with the method id `did:btcr2:<other>#key`, whose controller is the DID | An error of the cryptosuite | `INVALID_DID_UPDATE`: the id is not under the DID |
| `Updater.sign` with an unsigned update whose `sourceHash` is not the hash of the source document | Signs. A resolver refuses the announced update. | `INVALID_DID_UPDATE`: `Invalid unsignedUpdate: sourceHash is not the hash of sourceDocument.` |
| `DidBtcr2.update` with a method of type `JsonWebKey2020` | `INVALID_DID_DOCUMENT` | `INVALID_DID_UPDATE` |
| `api.btcr2.update` with a patch that removes `capabilityInvocation` | Signs and announces. Nobody can update the DID again. | `INVALID_DID_UPDATE` before any chain read |

## Decision

### 1. Only the method that signs must be a BIP340 Multikey

The library follows option 1 of issue 388. This change removes the rule of ADR 057 for each method:

- The `DidDocument` validation needs only a string `id`, `type`, and `controller` for each member of `verificationMethod` (`Appendix.isDidVerificationMethod`). A method can have any type.
- The `DidVerificationMethod` constructor does not throw. It keeps each own property of its input, also a property that the class does not name, for example `publicKeyJwk`. It removes each property whose value is `undefined`.
- `publicKeyMultibase` is optional on `Btcr2VerificationMethod` and `DidVerificationMethod`.
- The method package no longer exports `isMultikeyVerificationMethod` and `MULTIKEY_PUBLIC_KEY_MULTIBASE_PREFIX`. `MULTIKEY_VERIFICATION_METHOD_TYPE` stays. It is the type of the method that signs.

Reason: the merged specification gives the three conditions only for the method that signs. For the document, the text requires only DID Core v1.1. If issue 388 selects option 2, a later change adds the rule again.

### 2. One internal function checks the method that signs

`signingMethodProblem(method, did)` returns the first condition that the method fails, or `undefined`. The function is in `packages/method/src/utils/signing-method.ts`. `index.ts` does not export the module. The precedent is `utils/base64url-hash.ts` ([ADR 146](146-the-resolver-ignores-a-sidecar-smt-proof-whose-id-does-not-decode-and-a-cas-announcement-entry-must-decode-to-a-hash.md)). The conditions, in this order:

1. `type` equals `Multikey`. The rule text is `type must equal "Multikey"`.
2. `controller` equals the DID. The rule text is `controller must equal "<did>"`.
3. `publicKeyMultibase` is a string that `SchnorrMultikey.fromVerificationMethod` decodes, and the base58btc text of the decoded key equals the value. The rule text is `publicKeyMultibase must encode a secp256k1 public key as a BIP340 Multikey`.

If `publicKeyMultibase` is a string, a key failure also gives a `cause` with a type and a message. For a decode error, the cause gives the type and the message of that error. For text that is not the canonical encoding of the key, the type is `VERIFICATION_METHOD_ERROR`. The message is then `Invalid publicKeyMultibase: not the base58btc encoding of the key`. A missing `publicKeyMultibase`, or a value that is not a string, gives no `cause`.

Reason for the text comparison: the decoder accepts other text for the same bytes, but the specification allows one encoding. A strict decoder in the cryptosuite is a later change. The comparison covers only `publicKeyMultibase`. The decoder also accepts other text for a `proofValue`, and the resolver does not refuse it. The strict decoder covers both values.

### 3. The resolver checks the method that signs

`Resolver.applyUpdate` calls `signingMethodProblem` for the method that the proof names, in the embedded form and in the reference form. The check runs after the method lookup and before the proof time window, in the order of the specification. It also runs before the signature verification, so a failure names the field of the method.

A failure raises a `ResolveError` of type `INVALID_DID_UPDATE`. The message is `Invalid update: verificationMethod.` and the rule text. If the failure has a `cause`, `: ` and the message of the cause follow. The data is `{ verificationMethodId, field, actual, cause }`, and `cause` is present only if the failure has a cause.

### 4. The aggregation communication key comes from a method that can sign

[ADR 066](066-x1-transport-authentication.md) binds the communication key to `capabilityInvocation[0]`. Its invariant is "transport-authenticated as D implies control of a `capabilityInvocation` key of D implies authorized to update D". After the change of decision 1, `capabilityInvocation[0]` can be a method that cannot sign an update. The resolver refuses an update that such a method signs, so the invariant does not hold.

`getAggregationCommunicationKey` now calls `signingMethodProblem` before it decodes the key. A failure raises a `DidDocumentError` of type `INVALID_DID_DOCUMENT`. The message is `Cannot derive aggregation communication key: verificationMethod.` and the rule text, with the cause message if the failure has a cause. `resolveBtcr2SenderPk` catches the error and returns `undefined` for such an `x1` genesis document. The Nostr transport and the HTTP transport then drop the opt-in, as for a document with no usable key.

### 5. `Updater.signingMethod` finds and checks the method on the write path

The new public function `Updater.signingMethod(sourceDocument, verificationMethodId)` does these steps, in this order:

1. It checks the shape of `sourceDocument`: an object, a did:btcr2 `id`, and arrays for `capabilityInvocation` and `verificationMethod` if they are present.
2. It resolves the id to an absolute DID URL under the DID (decision 6).
3. It finds the entry of `capabilityInvocation` that identifies the id, in the reference form or the embedded form. A reference entry must name a member of `verificationMethod`.
4. It applies `signingMethodProblem` to the method.

Each failure raises an `UpdateError` of type `INVALID_DID_UPDATE`. The method-check error has the message and the data of the read path. Each error after step 2 names the absolute id in `data.verificationMethodId`.

`Updater.sign(sourceDocument, unsignedUpdate, verificationMethodId, signer)` replaces `Updater.sign(did, unsignedUpdate, verificationMethod, signer)`. The DID is `sourceDocument.id`. `Updater.sign` calls `Updater.signingMethod` first, so the caller cannot give a method that the document does not authorize. Related changes:

- `UpdaterParams.verificationMethod` becomes `verificationMethodId`.
- `NeedSigningKey.verificationMethodId` is the absolute id. The proof names the method by the same id.
- `DidBtcr2.update` calls `Updater.signingMethod` before Construct. A type or key failure now raises `INVALID_DID_UPDATE`. Before, it raised `INVALID_DID_DOCUMENT` with the full method as data.
- The key comparison of ADR 051 always runs. `Updater.signingMethod` proves that the method has the canonical text of a key.
- An error of the signer key becomes `Invalid signer: ` and the inner message. An error of the signer or the cryptosuite while `addProof` makes the proof becomes `Invalid update: cannot make the proof with "<id>": ` and the inner message. Both errors have the type `INVALID_DID_UPDATE` and the inner error in `data.cause`. Example: a key manager signer for a watch-only key gives the second error, with `KEY_NOT_SIGNER` in `data.cause.type`.

Each error of the signer, of the key comparison, and of the proof also names the absolute id in `data.verificationMethodId`.

Reason: one function makes the lookup and the checks of the specification for each write path. The read path uses the same lookup and the same checks. Thus an update that the write path signs is one that a resolver accepts.

### 6. The method id is a DID URL under the DID

The internal function `absoluteMethodId` applies two rules:

1. A relative id resolves only in the `#` form (`Appendix.absoluteDidUrl`). A relative `?key=1` or `/keys/1` fails. An absolute URI that is not a DID URL also fails. The message is `Invalid verificationMethodId: expected a DID URL or a relative DID URL that starts with "#"; got "<id>".`
2. The absolute id must be the DID, then `#`, `?`, or `/`, then more text. An id under another DID fails. The message is `Invalid verificationMethodId: expected "<did>" followed by a fragment, a query, or a path; got "<id>".`

Thus `Updater.sign` accepts `<did>#key-1`, `<did>?key=1`, and `<did>/keys/1`. The old rule "the method id must contain a fragment" had no ADR.

Reason: the section "Relative DID URLs" of DID Core v1.1 lets a relative DID URL hold a path, a query, or a fragment. The resolved URL references a resource in the same DID document. The section "Data Structures" of the specification requires an implementation to resolve a relative DID URL against the document `id` before a comparison.

An id under another DID fails the Retrieve Verification Method algorithm of Controlled Identifiers v1.0 (section 3.3). The controller of the method is not that other DID. The proof is separate from the DID document, so it names the method by an absolute DID URL. On each path, the library resolves only the `#` form of a relative DID URL (`Appendix.absoluteDidUrl`, ADR 091 and ADR 092).

The specification does not name this rule yet. A draft specification issue proposes the rule. Until the specification names the rule, the read path does not check it. The specification lets a resolver treat each URL of a DID document as an opaque string, except the beacon `serviceEndpoint`.

### 7. `Updater.sign` checks the unsigned update

After `Updater.signingMethod` and before the signer, the internal function `checkUnsignedUpdate` makes six checks, in this order:

1. `unsignedUpdate` is an object with no own `proof` member.
2. `targetVersionId` is an integer of 2 or more.
3. `@context` is the BTCR2 update context.
4. `sourceHash` is the hash of `sourceDocument`.
5. `Updater.construct(sourceDocument, patch, targetVersionId - 1)` gives a valid DID document. A failure has the error of `Updater.construct` in `data.cause`.
6. `targetHash` is the hash of that document.

Each message starts with `Invalid unsignedUpdate: `, and the type is `INVALID_DID_UPDATE`. `Updater.sign` still signs an update with an extra property, because the read path accepts it.

Reason: a resolver refuses such an update after the announcement, and the DID then no longer resolves. The failure is permanent, and the library holds the data to find it: the source document and the unsigned update.

`Updater.sign` gets no version of the source document. The caller must make sure that `targetVersionId` is that version plus 1. The api makes this check (decision 9).

Two related changes:

- `Updater.construct` refuses a `sourceVersionId` that is not an integer of 1 or more, with the message `Invalid sourceVersionId: expected an integer of 1 or more.` Before, the string `'1'` gave the `targetVersionId` `'11'`.
- `Updater.sign` gives `addProof` a copy of the unsigned update. Before, `addProof` wrote `proof` into the object of the caller, also if the proof verification after it failed. A second call with the same object then failed, for example after a signer returned a wrong signature. The root fix is in the cryptosuite: `addProof` must copy its input, as step 5 of the "Add Proof" algorithm of VC Data Integrity specifies. That fix needs a cryptosuite release, so a later change makes it.

### 8. `getSigningMethod` uses the rules of the write path

`DidBtcr2.getSigningMethod(document, methodId)` and the api `btcr2.getSigningMethod` return `Updater.signingMethod(document, methodId ?? '#initialKey')`. They read only `capabilityInvocation`, with no `assertionMethod` fallback. A failure raises an `UpdateError` of type `INVALID_DID_UPDATE`. Before, the error was a `MethodError` of type `METHOD_NOT_SUPPORTED` or a `DidError` of code `InternalError`.

Before, the functions returned the method that the id names if it had a `publicKeyMultibase`. They searched `verificationMethod` and each verification relationship, so the result could be an authentication-only method that `Updater.sign` refuses.

The api does not export `Updater` ([ADR 132](132-the-api-exports-only-its-facade-and-a-sub-facade-function-does-each-crud-step.md)). `getSigningMethod` is the api path to `Updater.signingMethod`.

### 9. The api checks the version and refuses a lock-out

`btcr2.signUpdate(source: SourceState, unsignedUpdate, verificationMethodId, signer)` replaces `signUpdate(did, unsignedUpdate, verificationMethod, signer)`. `source` is the pair `{ document, versionId }`, as for `constructUpdate`. The api calls `Updater.sign(source.document, unsignedUpdate, verificationMethodId, signer)`. The api no longer checks for a `publicKeyMultibase`, because `Updater.signingMethod` checks the key. `signUpdate` also makes two version checks:

- A `source.versionId` that is not an integer of 1 or more fails with the message of `Updater.construct`.
- An integer `targetVersionId` that is not `source.versionId + 1` fails: `Invalid update: targetVersionId is <n>, but the source has versionId <v>. Construct the update from this source.`

The two version checks run before `Updater.sign`. Thus an integer `targetVersionId` that is not `source.versionId + 1` gets this message, also if the Updater refuses the update for another reason. If `source` is not an object, `signUpdate` throws an `Error` with the message `source must be an object.`

The api also refuses a lock-out. A target document locks out the DID if no entry of `capabilityInvocation` passes `Updater.signingMethod` and `deactivated` is not `true`. Nobody can then update or deactivate the DID. Three functions refuse it:

- `signUpdate` and `update` raise an `UpdateError` of type `INVALID_DID_UPDATE`: `Invalid update: after this update, the DID document has no capabilityInvocation method that can sign an update. Nobody can update or deactivate <did> again.`
- `createExternalFromDocument` raises a `DidDocumentError` of type `INVALID_DID_DOCUMENT`: `Invalid genesis document: the DID document has no capabilityInvocation method that can sign an update. Nobody can update or deactivate the DID.`

The data is `{ did, methods }`. Each item of `methods` is `{ verificationMethodId, reason }`. `verificationMethodId` is the absolute id of an entry of `capabilityInvocation`, or `undefined` if the entry has no usable id. `reason` is the message of the `Updater.signingMethod` error for that entry.

`signUpdate` runs the guard after `Updater.sign`. Thus each other refusal of the Updater keeps its own message, for example the message for a wrong `@context`. A signature has no effect before the announcement, so the api can discard it. `update` runs the guard before the derive step, before any chain read, and before any signature. The guard skips a source document with no method that can sign, and a patch that `Updater.construct` refuses. The Updater then names the cause.

The derive step of `update` uses only the `capabilityInvocation` methods that pass `Updater.signingMethod`, in the reference form and the embedded form. The messages are `No capabilityInvocation method that can sign an update of DID <did> publishes the signer's key.` and `<n> capabilityInvocation methods that can sign an update of DID <did> publish the signer's key: <ids>.` More text follows each message.

Reason: the api guard criterion ([ADR 135](135-an-update-is-refused-if-the-source-resolution-misses-an-update-of-the-sidecar-data.md)). The api refuses a write only if the failure is permanent for the DID and the api already holds the data to find it. A lock-out is permanent, and the api holds the target document. A resolver refuses an update with another `targetVersionId`, and the api holds `source.versionId`.

### 10. The aggregation service reads the DID before the first `?`, `/`, or `#`

`AggregationService` took the DID of an absolute proof id with `split('#')[0]`. Thus it refused a `<did>?key=1` proof id that `Updater.sign` signs. It now uses `split(/[?/#]/)[0]`. A DID contains no `?`, `/`, or `#`. A relative id (`#initialKey`) still passes this check, and the proof verification after it refuses the id, as the resolver does.

The JSDoc of `genesisDocument` in the participant and the participant runner gives the conditions of decision 4.

### 11. The test vectors do not change

This change does not regenerate the vectors. The pinned signed updates have no `proof.invocationTarget`. The resolver refuses such an update at the `proof.invocationTarget` check, before the new method check. Thus `packages/api/lib/verify-scenarios.ts` gives the same pass or fail result as before. The pinned n24 vector keeps the old patch until the next regeneration.

The generator changes:

- A `FAILURE_RULES` entry can set `signRefuses: true`. For a set with that rule, the generator signs each update with `signWithConfig`. `signWithConfig` uses the proof options of `Updater.sign` and makes no checks.
- Each other update uses `Updater.sign(source.document, unsigned, vmId, signer)`. An update with changed proof options also uses `signWithConfig`.
- `signWithConfig` takes the method id as a string. The proof names the absolute DID URL of the id.
- The four n24 recipes change the patch value from `JsonWebKey2020` to the number `42`. The rule id stays `document-not-conformant`. After the change of decision 1, the `JsonWebKey2020` value gives a conformant document.

The rules with `signRefuses` are `update-context-mismatch`, `proof-method-unauthorized`, `proof-method-not-found`, `source-hash-mismatch`, `target-hash-mismatch`, `patch-apply-failure`, `document-id-mismatch`, and `document-not-conformant`.

## Alternatives

- **Keep the rule for each method (option 2 of issue 388).** Rejected. The merged text does not require it. The rule refuses an X25519 key for key agreement, an Ed25519 key, and a P-256 key.
- **Sign only `<did>#<fragment>`.** Rejected. DID Core v1.1 lets a DID URL under the DID hold a path or a query. The write path then refuses an id that the read path accepts.
- **Check the id rule on the read path now.** Rejected. The specification does not name the rule, and it lets a resolver treat such URLs as opaque strings.
- **Run the api lock-out guard before `Updater.sign`.** Rejected. An unsigned update with a wrong `@context` then gets the lock-out message, not its own cause.
- **Put the spelling of the caller in `data.verificationMethodId`.** Rejected. The later errors of `Updater.sign` and the read path use the absolute id. One spelling lets a consumer compare the data of each error.
- **Keep the write of `proof` into the input.** Rejected. The input of the caller then changes, and a second call with the same object fails.
- **Fix `addProof` in the cryptosuite now.** Rejected for this change. The fix needs a cryptosuite release. A later change makes it.
- **Export `signingMethodProblem`.** Rejected. ADR 132 keeps the public surface small, and `Updater.signingMethod` gives the same rule with a typed error.

## Consequences

- The method and api packages get a MINOR release. The Packages line names the main breaking changes. Decisions 1, 5, 6, 7, 8, and 9 give the full list.
- A DID document with a method of any type now passes validation and resolves. The Rust implementation refuses a method whose `publicKeyMultibase` is not a secp256k1 key, and this library accepts it.
- Issue 388 is open. `Updater.sign` signs an update that changes the type of `#initialKey` to `JsonWebKey2020`, and the resolver applies it. The next update that `#initialKey` signs then fails on both paths. The api lock-out guard refuses the first update if no other `capabilityInvocation` method can sign.
- For an embedded `capabilityInvocation` object with no `controller`, the two paths give different text. The write path gives `Invalid verificationMethodId: not found in source document`. The read path gives `Invalid update: verificationMethod is not found in the verificationMethod of the current document`. This difference existed before this change.
- The create path, the write path, and the read path still accept a private JWK member `d`, `secretKeyJwk`, `secretKeyMultibase`, and a method with both `publicKeyJwk` and `publicKeyMultibase`. A later change adds the checks for these properties.
- The read path does not check the id rule of decision 6. The draft specification issue proposes the rule for both paths.
- An `x1` participant whose `capabilityInvocation[0]` method cannot sign can no longer join a cohort over the Nostr transport or the HTTP transport.
- The example generator of the specification repository (`bin/gen-examples.ts`) needs the new `signUpdate` call if it uses this api version.

**Superseded.**

- ADR 057, "Context": the sentence "The did:btcr2 specification requires every verification method to be a `Multikey` whose public key is a Schnorr secp256k1 key, multibase-encoded with the `zQ3s` prefix." The merged specification gives the three conditions only for the method that signs (decision 1).
- ADR 057, decision 2 "Enforce the Multikey invariant uniformly through one validator": the sentence from "A single predicate, `isMultikeyVerificationMethod`, is now the source of truth" to "with a `publicKeyMultibase` that starts with `zQ3s`", the sentence "The type string and the multibase prefix are named constants (`MULTIKEY_VERIFICATION_METHOD_TYPE`, `MULTIKEY_PUBLIC_KEY_MULTIBASE_PREFIX`).", and the sentence "That predicate (and the shared constants) are applied at every boundary:" with its three list items. Only the method that signs must be a BIP340 Multikey (decision 1).
- ADR 057, "Consequences": the bullet "The Multikey + `zQ3s` invariant holds wherever a verification method enters the system, not just for the one method signed with at update time." with the rest of its text, and the bullet "There is one definition of "valid btcr2 verification method" and one definition of the type and prefix constants".
- ADR 051, decision 3 "Skip the check only when the method publishes no key". The key comparison now always runs, because `Updater.signingMethod` refuses a method with no key.
- ADR 090, the residual "`participantPk` is self-declared and not tied to the sender's DID": the clause "`#verifySubmittedUpdate` pins `proof.verificationMethod.split('#')[0] === sender`". The service now takes the text before the first `?`, `/`, or `#` (decision 10).
- ADR 092, "Consequences": the clause "because both pass `verificationMethodId` and `beaconId` straight through to `DidBtcr2.update`, which is the single chokepoint for both checks". `Updater.signingMethod` is now the one point of the method lookup. The api `signUpdate` passes the id to `Updater.sign`, and the api derive step lists the methods through `Updater.signingMethod`.
- ADR 092, "Consequences": the sentence "The proof resolves the method id against the document, the cryptosuite resolves the key's id against its controller, and the two disagree, so the cryptosuite's existing id check throws." `Updater.signingMethod` now refuses such a method with `controller must equal "<did>"`, before the signer runs.
- ADR 112, the decision "Both paths locate the verification method through the entry of `capabilityInvocation`": the sentence "`DidBtcr2.getSigningMethod` also searches the embedded methods of the verification relationships, after `verificationMethod`; its error type does not change." `getSigningMethod` now reads only `capabilityInvocation` and raises `UpdateError` (decision 8).
- ADR 112, "Scope boundary": the bullet "The error type of `DidBtcr2.getSigningMethod` (a `DidError`) is a residual of the typed-error audit (ADR 085) and does not change here."
- ADR 132, decision 3: the text `api.btcr2.signUpdate(did, unsignedUpdate, verificationMethod, signer)` in the row "An update with no broadcast". The new signature is `api.btcr2.signUpdate(source, unsignedUpdate, verificationMethodId, signer)`.
- ADR 132, decision 3: the bullet "`signUpdate` refuses a verification method with no `publicKeyMultibase`. Thus the key check of `Updater.sign` always runs." `Updater.signingMethod` now refuses such a method, and the key check always runs in `Updater.sign`.
- ADR 104, the decision "The verification method is the one method that publishes the signer's key": the sentence "It then finds the methods on the source document whose `publicKeyMultibase` equals that key." and the clause "No method that the document lists can sign with that key". The derive step now uses only the `capabilityInvocation` methods that pass `Updater.signingMethod` (decision 9).

**Unchanged.**

- ADR 057, decision 1: the `@context` check.
- ADR 066, decision B: the communication key is the key of `capabilityInvocation[0]`, with no fallback. Decision 4 adds the condition that the method can sign an update. A document whose method cannot sign gives no key, as a document with no usable key did before.
- ADR 091 and ADR 092: a relative id in the `#` form resolves against the document `id`, and both spellings compare equal.
- ADR 104: the beacon derivation, and the refusal of zero matches and of several matches.
- ADR 112: the lookup through `capabilityInvocation` on both paths, the messages of the read path, and `INVALID_DID_UPDATE` for each failure of an update path.
- ADR 135: the api guard criterion.
- ADR 137: the proof of a signed message names `<did>#<fragment>`. The message path keeps its own rule.

## Implementation

- `packages/method/src/utils/signing-method.ts`: `signingMethodProblem` and `SigningMethodProblem`.
- `packages/method/src/utils/did-document.ts`: the structural check of `isValidVerificationMethods`, the `DidVerificationMethod` constructor, the optional `publicKeyMultibase`, and the removed exports.
- `packages/method/src/core/resolver.ts`: the method check in `applyUpdate`.
- `packages/method/src/core/did-sender-resolver.ts`: the method check in `getAggregationCommunicationKey`.
- `packages/method/src/core/updater.ts`: `absoluteMethodId`, `checkUnsignedUpdate`, `Updater.signingMethod`, the new `Updater.sign`, the `sourceVersionId` check of `Updater.construct`, `UpdaterParams`, and `NeedSigningKey`.
- `packages/method/src/did-btcr2.ts`: `DidBtcr2.update` and `DidBtcr2.getSigningMethod`.
- `packages/api/src/method.ts` and `api.ts`: `signUpdate`, the lock-out guard in `signUpdate`, `update`, and `createExternalFromDocument`, the derive step, `getSigningMethod`, and the JSDoc.
- `packages/cli/src/commands/write.ts`: the `--help` text of `-m`.
- `packages/aggregation/src/service/service.ts`: the DID of the proof id. `participant.ts` and `participant-runner.ts`: the JSDoc.
- `packages/api/lib/_scenario-helpers.ts` and `generate-scenario.ts`: `signRefuses`, `signWithConfig`, and the sign call. The four n24 recipes. The api and aggregation lib scripts: the new `Updater.sign` call.
- `packages/method/README.md`, `packages/method/docs/aggregation.md`, `packages/api/README.md`, `packages/api/docs/DEMO.md`, `packages/api/docs/test-vectors.md`, and `packages/cli/docs/DEMO.md`, `create.md`, `deactivate.md`, `genesis.md`, and `update.md`: the conditions of the method that signs, the new `Updater.sign` and `signUpdate` calls, the lock-out guard, and the generator rules.
- Tests: `packages/method/tests/signing-method.spec.ts`, `did-document.spec.ts`, `did-sender-resolver.spec.ts`, `relative-did-url.spec.ts`, `resolver.spec.ts`, and `updater.spec.ts`. `packages/api/tests/did-method-api-offline-steps.spec.ts`, `did-method-api.spec.ts`, `genesis.spec.ts`, `did-method-api-cas-policy.spec.ts`, and `did-method-api-message.spec.ts`. `packages/aggregation/tests/aggregation-submit-proof-id.spec.ts` and `aggregation-solo.spec.ts`. `packages/cli/tests/genesis-commands.spec.ts`.

## References

- [did:btcr2 specification, Update](https://dcdpr.github.io/did-btcr2/operations/update.html): [Construct BTCR2 Signed Update](https://dcdpr.github.io/did-btcr2/operations/update.html#construct-btcr2-signed-update).
- [did:btcr2 specification, Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html): [Check `update.proof`](https://dcdpr.github.io/did-btcr2/operations/resolve.html#check-update-proof).
- [did:btcr2 specification, Data Structures](https://dcdpr.github.io/did-btcr2/data-structures.html): relative DID URLs and opaque URLs.
- [Specification pull request 389](https://github.com/dcdpr/did-btcr2/pull/389) and [specification issue 388](https://github.com/dcdpr/did-btcr2/issues/388).
- [DID Core v1.1, Relative DID URLs](https://www.w3.org/TR/did-1.1/#relative-did-urls).
- [Controlled Identifiers v1.0, section 3.3 Retrieve Verification Method](https://www.w3.org/TR/cid-1.0/#retrieve-verification-method).
- [VC Data Integrity, Add Proof](https://www.w3.org/TR/vc-data-integrity/#add-proof).
- [ADR 051](051-update-verifies-signing-key.md): the key comparison in `Updater.sign`.
- [ADR 057](057-did-document-validation-standards.md): the rule for each verification method.
- [ADR 066](066-x1-transport-authentication.md): the communication key of an `x1` participant.
- [ADR 090](090-aggregation-transport-sender-authentication.md): the sender of a submitted update.
- [ADR 091](091-inject-did-into-beacons-and-relative-did-urls.md) and [ADR 092](092-relative-did-urls-on-the-write-path.md): relative DID URLs.
- [ADR 104](104-update-path-derives-omitted-verification-method-and-beacon.md): the derive step of `update`.
- [ADR 112](112-update-paths-check-the-proof-fields-and-apply-the-patch-strictly.md): the lookup through `capabilityInvocation`.
- [ADR 132](132-the-api-exports-only-its-facade-and-a-sub-facade-function-does-each-crud-step.md): the exports of the api and `signUpdate`.
- [ADR 135](135-an-update-is-refused-if-the-source-resolution-misses-an-update-of-the-sidecar-data.md): the api guard criterion.
- [ADR 137](137-a-signed-message-is-an-assertion-proof-that-verify-checks-against-the-current-did-document.md): the proof of a signed message.
