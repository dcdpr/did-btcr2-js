# @did-btcr2/common

## 11.0.0

### Major Changes

- The Data Integrity algorithms of the cryptosuite follow VC Data Integrity 1.0 and the bip340-jcs-2025 suite, and the resolver uses them (ADR 158).

  - common: Breaking: `MethodErrorCode.PROOF_PARSING_ERROR` and its named export are removed. `MethodErrorCode` gets `PARSING_ERROR` and `INVALID_CHALLENGE_ERROR` of VC Data Integrity 1.0, with their named exports. `INVALID_DOMAIN_ERROR` gets a named export.
  - common: Breaking: `DateUtils.isValidXsdDateTime` applies the `dateTime` rules of XML Schema 1.1. The year `0000` is valid. A year with more than 4 digits that starts with `0`, for example `01000`, is not valid. `24:00:00` with a fraction other than zero is not valid. A value that is not a string gives `false`. Before, `0000` was not valid, `01000` and `24:00:00.5` were valid, and a number gave a raw `TypeError`.
  - common: `DateUtils.isValidXsdDateTimeStamp` (a `dateTime` with a timezone), `DateUtils.xsdDateTimeToEpochMs` (for each year, also a year above 9999), and `DateUtils.compareXsdDateTime` (an exact comparison of two instants) are new. The type `ProblemDetails` (RFC 9457) is new.
  - cryptosuite: Breaking: `BIP340Cryptosuite.createProof` returns a new proof and does not change its options. `BIP340DataIntegrityProof.addProof` returns a copy of the document with the proof. Before, `createProof` wrote `@context` and `proofValue` into the options and returned the options object, and `addProof` wrote the proof into the document.
  - cryptosuite: Breaking: `createProof` refuses a document that is not a JSON object, with a `CryptosuiteError` of type `PROOF_GENERATION_ERROR`. It also refuses options with a `proofValue`, and options with an `@context` for a document with no `@context`. It also refuses a proof member that breaks a rule of VC Data Integrity 1.0, and a signature that does not have 64 bytes. Examples are an `id` that is not a valid URL string, a `created` with no timezone, and a repeated `domain` string. Before, `createProof` made a proof for each of these inputs, except a `null` or `undefined` document. Such a document gave a raw `TypeError`.
  - cryptosuite: Breaking: `addProof` refuses a document that has a `proof`, and options with a `previousProof`, with a `DataIntegrityProofError` of type `PROOF_GENERATION_ERROR`. Before, for a document with a `proof`, the new proof signed the old proof and then replaced it, so the result never verified. For options with a `previousProof`, `addProof` made a proof that verified, and no function verified the previous proof.
  - cryptosuite: Breaking: `BIP340Cryptosuite.verifyProof` returns a `CryptosuiteVerificationResult`: `verified`, and `verifiedDocument`, the document without its proof, or `null`. A document `@context` that does not start with the proof `@context` gives `verified: false` (Verify Proof, step 4). Before, `verifiedDocument` was the secured document or `undefined`.
  - cryptosuite: Breaking: `BIP340Cryptosuite.verifyProof` throws a `CryptosuiteError` if the verification cannot complete. The type is `PARSING_ERROR` if the document or its proof is not a JSON object. The type is `PROOF_VERIFICATION_ERROR` for a proof member that breaks a rule. It is also `PROOF_VERIFICATION_ERROR` for a `proofValue` that is not the canonical base58btc text of 64 bytes. A `created` value that is not an XML Schema `dateTime`, for example `''`, gives `PROOF_GENERATION_ERROR`. A `type` or a `cryptosuite` of another suite gives a `CryptosuiteError`, also in `BIP340Cryptosuite.transformDocument`.
  - cryptosuite: Breaking: `BIP340Cryptosuite.verifyProof` refuses some proofs that verified before. Examples are a proof with an `id` of `not a url`, with a `created` of `''`, or with other base58btc text for the same signature bytes. Before, a `proofValue` that did not decode gave a raw `Error`, `created: 5` gave a raw `TypeError`, and another `type` gave a `MethodError`, also in `transformDocument`.
  - cryptosuite: Breaking: `BIP340DataIntegrityProof.verifyProof` is the Verify Proof algorithm of VC Data Integrity 1.0. A failed check before the cryptosuite verification gives `verified: false` and one `ProblemDetails` in `errors`, with the type URL `https://w3id.org/security#<TYPE>`. The error types are `PARSING_ERROR`, `PROOF_VERIFICATION_ERROR`, `INVALID_DOMAIN_ERROR`, and `INVALID_CHALLENGE_ERROR`. If the cryptosuite gives `verified: false`, `errors` is empty. Text that is not JSON gives a `DataIntegrityProofError` of type `PARSING_ERROR`. Before, a failed check threw a `DataIntegrityProofError`, and text that was not JSON gave a `SyntaxError`.
  - cryptosuite: Breaking: in `BIP340DataIntegrityProof.verifyProof`, a proof with a `previousProof` gives `PROOF_VERIFICATION_ERROR`, because this suite does not verify a proof chain. `expectedPurpose` is optional, and `expectedDomain` is a string or an array of strings, compared as a set. Before, the function ignored `previousProof`, and a `domain` list of another length failed.
  - cryptosuite: Breaking: `VerificationResult` has `verifiedDocument: UnsecuredDocument | null`, `mediaType: string | null`, `warnings`, and `errors`. `Cryptosuite.verifyProof` returns the new type `CryptosuiteVerificationResult`. Before, `verifiedDocument` (a `SecuredDocument`) and `mediaType` were optional, and the type had no `warnings` and no `errors`.
  - cryptosuite: Breaking: `SchnorrMultikey.fromVerificationMethod` refuses a `publicKeyMultibase` that is not the canonical base58btc text of its bytes, with a `MultikeyError` of type `VERIFICATION_METHOD_ERROR`. Text that does not decode gives the same error type. Before, the function accepted other text for the same bytes, and text that did not decode gave a raw `Error`.
  - method: Breaking: the resolver refuses an update whose proof has a `previousProof`, with a `ResolveError` of type `INVALID_DID_UPDATE`. The message is `Invalid update: proof.previousProof must not be present: an update has one proof`. Before, the resolver applied such an update.
  - method: Breaking: the resolver verifies an update proof with `BIP340Cryptosuite.verifyProof`, so the proof member rules and the strict `proofValue` decode of the cryptosuite apply. For example, an `id` that is not a valid URL string, or a `nonce` that is not a string, gives `Invalid update: proof verification failed: ...` (`INVALID_DID_UPDATE`). Before, the resolver applied such an update.
  - method: Breaking: the resolver refuses an eligible beacon signal if its block `time` or `mediantime` is not an integer from 0 to 2^32-1. The error is a `ResolveError` of type `INVALID_DID_UPDATE`. Before, a `mediantime` of `1e20` gave a `MethodError` of type `INVALID_DATE`, and a `mediantime` of `1.5` applied the update.
  - method: a proof `created` or `expires` with the year `0000` or a year above 9999 is valid. The resolver compares `created` and `expires` exactly, with each digit of a fraction of a second. `versionTime` also accepts each year. Before, such a year failed with `INVALID_DID_UPDATE`, or with `INVALID_OPTIONS` for `versionTime`, and the resolver compared whole milliseconds. The DID Core check of `expires` and `revoked` of a verification method applies the same XML Schema 1.1 rules.
  - method: if the signer returns a signature that does not have 64 bytes, `Updater.sign` fails with `Invalid update: cannot make the proof with "<id>": ...` and `PROOF_GENERATION_ERROR` in `data.cause`. Before, the message was `Invalid update: the proof does not verify with the public key of "<id>": ...`. For a `publicKeyMultibase` that does not decode, the `data.cause` of the signing method check has the type `VERIFICATION_METHOD_ERROR`. Before, it had the type `Error` of the raw decode error.
  - api: Breaking: `crypto.cryptosuite.verifyProof` and `crypto.verifyDocument` return a `CryptosuiteVerificationResult`: `verified`, and the document without its proof, or `null`. Before, they returned a `VerificationResult` whose `verifiedDocument` was the secured document or `undefined`.
  - api: Breaking: `crypto.proof.verifyProof` gives `verified: false` and one `ProblemDetails` in `errors` for a failed check, for example a purpose, a domain, or a challenge that does not match. A signature that does not verify gives `verified: false` and an empty `errors` array. Text that is not JSON gives a `DataIntegrityProofError` of type `PARSING_ERROR`. `expectedPurpose` is optional, and `expectedDomain` is a string or an array of strings. Before, a failed check threw a `DataIntegrityProofError`, text that was not JSON gave a `SyntaxError`, and `expectedDomain` was a string.
  - api: Breaking: `crypto.signDocument`, `crypto.proof.addProof`, and `crypto.proof.signDocument` return a copy of the document with the proof, and `crypto.cryptosuite.createProof` does not change its options. The three functions refuse a document that has a `proof`, and options with a `previousProof`. Before, they wrote the proof into the document and into the options.
  - api: `crypto.cryptosuite.createFromKms` returns a cryptosuite that signs through `kms.signer(keyId)`. For a watch-only key, `createProof` gives `KEY_NOT_SIGNER`. Before, the cryptosuite held only the public key, so `createProof` gave a `KeyPairError` of type `SECRET_KEY_ERROR`.
  - api: the api exports the types `CryptosuiteVerificationResult` and `ProblemDetails`. `btcr2.verifyMessage` fails the `assertionMethod` check for a `publicKeyMultibase` that is not the canonical base58btc text of the key. The resolve and update functions apply the new rules of the method package.
  - aggregation: the package takes the new versions of common and cryptosuite. It uses only the `SecuredDocument` type of the cryptosuite, so its behavior does not change. Its browser bundle holds the new `MethodErrorCode` of common.
  - cli: `message verify` fails the `assertionMethod` check for a method whose `publicKeyMultibase` is not the canonical base58btc text of its key. The detail ends with `Invalid publicKeyMultibase: not the base58btc encoding of the key`. Before, the check passed, and the message verified. For a `proofValue` that does not decode to 64 bytes, the `signature` check prints `The proof does not verify: Invalid proofValue: not the base58btc Multibase encoding of a 64-byte BIP340 signature.` `message sign` prints the same signed message as before. If the resolution gets an update that the resolver now refuses, `resolve`, `update`, `deactivate`, `message sign`, and `message verify` fail.

- The JCS serializer sorts every object and refuses NaN, Infinity, and a lone surrogate (ADR 154).

  - common: Breaking: `canonicalize`, `canonicalHash`, and `canonicalHashBytes` throw a `CanonicalizationError` for a value with no JCS form (RFC 8785). The type is `NON_FINITE_NUMBER` for NaN, Infinity, or -Infinity, also for a Number object and for the number of the JSON text `1e400`. The type is `LONE_SURROGATE` for a string or a member name with a lone surrogate. The type is `NOT_JSON_DATA` for a BigInt, a cycle, or a top-level value with no JSON form. `data.path` gives the location of the value as a JSON Pointer. Before, NaN and Infinity became `null`, a lone surrogate became its escape text, and a BigInt or a cycle gave a `TypeError`.
  - common: Breaking: `canonicalize` sorts an object that has a data member named `toJSON`, at each depth. Before, such an object and each object in it kept the order of their members, so the hash depended on that order. A `toJSON` method has the same effect as before: `JSON.stringify` calls it first.
  - common: the package no longer depends on `json-canonicalize`. An own serializer writes the JSON form with the rules of RFC 8785 section 3.2.
  - common: `MethodErrorCode` gets the member `PROOF_TRANSFORMATION_ERROR` and its named export.
  - method: Breaking: `Resolver.external` refuses a genesis document with no JCS form with a `ResolveError` of type `INVALID_DID_DOCUMENT`. `Resolver.provide` refuses a signed update with no JCS form with `INVALID_SIGNAL_DATA`, and a CAS Announcement with no JCS form with `MISSING_UPDATE_DATA`. `data.cause` gives the type and the message of the `CanonicalizationError`.
  - method: `Resolver.sidecarData` leaves an update or a CAS Announcement with no JCS form out of its maps. If a beacon signal needs the item, the resolver asks for it with a data need. Before, the map keyed such an item by the hash of its escape text or of its `null` form.
  - method: Breaking: `Updater.construct` and `Updater.sign` refuse a source document or a patch with no JCS form with an `UpdateError` of type `INVALID_DID_UPDATE`. Before, `construct` returned an update whose `targetHash` used the `null` form of a NaN patch value. `GenesisDocument.toGenesisBytes` throws a `DidDocumentError` of type `INVALID_DID_DOCUMENT` for a document with no JCS form.
  - method: `Identifier.validate` reports a failed `genesisDocument` check for a genesis document with no JCS form and does not throw. The set check of the DID Core rules compares no map item with no JCS form, because the hash step refuses the document.
  - cryptosuite: `transformDocument` throws a `CryptosuiteError` of type `PROOF_TRANSFORMATION_ERROR` for a document with no JCS form. `proofConfiguration` throws `PROOF_GENERATION_ERROR` for proof options with no JCS form. Thus `createProof` and `verifyProof` throw for such data, and `verifyProof` gives no `verified: false` result. Before, the suite signed and verified the `null` form or the escape text.
  - aggregation: `AggregationParticipant.submitUpdate` refuses an update with no JCS form with an `AggregationParticipantError` of type `UPDATE_MALFORMED`. `verifyEnvelope` refuses an envelope with no JCS form with an `HttpTransportError` of type `ENVELOPE_MALFORMED`. The CAS strategy derives no signal from a CAS Announcement with no JCS form, so the member does not approve it.
  - api: the api exports `CanonicalizationError` and `CryptosuiteError`. `hashDocument`, `CasApi.publish`, `getInitialDocument`, `createExternalFromDocument`, `constructUpdate`, the resolve functions, and the crypto sub-facade refuse a value with no JCS form through the lower packages.
  - cli: the merge of sidecar data keeps one copy of each entry with no JCS form, by its JSON text, and does not throw. `create -t x --document`, `identifier decode`, `identifier validate`, and `resolve` refuse a genesis document with no JCS form.

- JSONPatch applies the rules of RFC 6901 and RFC 6902 with its own engine and accepts each member name (ADR 155).

  - common: Breaking: `JSONPatch.apply` refuses a patch that breaks RFC 6901 or RFC 6902 with a `MethodError` of type `JSON_PATCH_APPLY_ERROR`. Examples: a pointer with `~2`, an array index with a leading zero (`/a/00`), and an empty array token (`/a/`). Other examples: an index past the end for the `add` of a `move` or a `copy`, and a `move` into a child of its `from`. A path to an inherited JavaScript member such as `/o/toString` and a `remove` at `''` also fail. Before, the apply accepted each of these patches, and a `remove` at `''` gave `null`.
  - common: Breaking: `JSONPatch.apply` accepts each member name, also `constructor`, `prototype`, and `__proto__`. It writes such a member as an own data member and changes no prototype. A `test` with a value that has a member `hasOwnProperty` compares by RFC 6902 section 4.6. An `add` with a `from` member applies, because RFC 6902 ignores that member. Before, the apply refused each of these patches.
  - common: Breaking: `JSONPatchApplyOptions` and the options parameter of `JSONPatch.apply` are removed. The rules always apply, and the patch always runs on a JSON copy. The `strict` parameter of `JSONPatch.validateOperations` is removed, and its `operations` parameter has the type `unknown`. `JSONPatch.diff`, `JSONPatch.joinPointer`, and `JSONPatch.escapeSegmentPath` are removed.
  - common: operations or a source document with no JSON form, for example with a cycle or a BigInt, give `JSON_PATCH_APPLY_ERROR`. Before, they gave a `TypeError`. The error data holds `index`, `op`, `path`, and `from` for a `move` or a `copy`.
  - common: the package no longer depends on `fast-json-patch`.
  - method: Breaking: `Updater.construct`, `DidBtcr2.update`, and the resolver apply the patch of an update with the new rules. A patch that the new rules refuse gives `INVALID_DID_UPDATE` on both paths. A patch that names a member `constructor`, `prototype`, or `__proto__` now applies.
  - api: Breaking: `applyPatch`, `constructUpdate`, `signUpdate`, the update functions, and the resolve functions apply the new rules through method. `applyPatch` refuses a `remove` at `''`.
  - aggregation: the browser bundle no longer holds `fast-json-patch`.
  - cli: `update` and `deactivate` apply the new rules through the api. The docs of `update` name the new refusals.

- The common package removes `JSONUtils.deleteKeys` and 11 error types that no code uses (ADR 151).

  - common: Breaking: `JSONUtils.deleteKeys` is removed. No package calls it. To remove a top-level key, use an object rest destructure, for example `const { proof: _, ...unsignedUpdate } = update;`.
  - common: Breaking: `MethodErrorCode` no longer has the members `INVALID_DID_DOCUMENT_LENGTH`, `INVALID_PREVIOUS_DID_PROOF`, `INVALID_PUBLIC_KEY`, `INVALID_PUBLIC_KEY_MULTIBASE`, `INVALID_PUBLIC_KEY_LENGTH`, `INVALID_PUBLIC_KEY_TYPE`, `INVALID_SIGNATURE`, `UNSUPPORTED_PUBLIC_KEY_TYPE`, `INVALID_SIDECAR_DATA`, `INVALID_UPDATE`, and `MISSING_RESOLUTION_OPTIONS`. The named exports of 8 of them are also removed: all except `INVALID_DID_DOCUMENT_LENGTH`, `UNSUPPORTED_PUBLIC_KEY_TYPE`, and `INVALID_UPDATE`, which had no named export. No code raises these error types, and no cited specification defines them.

### Minor Changes

- A failed resolution gives the error object of DID Resolution v1. The resolver refuses a resolution option that it does not support (ADR 157).

  - common: `MethodErrorCode.FEATURE_NOT_SUPPORTED` and its named export `FEATURE_NOT_SUPPORTED` are new.
  - method: Breaking: `DidBtcr2.resolve` checks the resolution options in the order of DID Resolution v1, section 4.4, before it returns the `Resolver`. An option name other than `accept`, `expandRelativeUrls`, `noCache`, `versionId`, `versionTime`, `minConf`, `sidecar`, and `maxDiscoveryRounds` gives a `ResolveError` of type `FEATURE_NOT_SUPPORTED`. `expandRelativeUrls: true` also gives `FEATURE_NOT_SUPPORTED`. A wrong value of `accept`, `expandRelativeUrls`, `noCache`, `sidecar`, or `maxDiscoveryRounds` gives `INVALID_OPTIONS`. Options that are not an object, for example `null`, also give `INVALID_OPTIONS`. Before, the resolver ignored each such option, and `null` gave a raw `TypeError`.
  - method: Breaking: `ResolutionOptions` no longer extends `DidResolutionOptions` of `@web5/dids`. It declares `accept`, `expandRelativeUrls`, and `noCache`. A TypeScript caller that gives another option name gets a compile error.
  - method: Breaking: `Identifier.decode` checks the DID syntax of DID Core v1.1 first. A valid DID of another method gives `METHOD_NOT_SUPPORTED`, for example `did:example:a:b` (before: `INVALID_DID`). An identifier that is not a DID gives `INVALID_DID`, for example `did:BTCR2:k1...` (before: `METHOD_NOT_SUPPORTED`). A value that is not a string gives `INVALID_DID`.
  - api: Breaking: `raw.didResolutionMetadata.error` of `tryResolveDid` is the error object `{ type, title, detail }` of DID Resolution v1, section 10. `type` is the URL of the error type: `https://www.w3.org/ns/did#<CODE>` for the 9 types of DID Resolution v1, and the anchor of the type on `https://dcdpr.github.io/did-btcr2/errors.html` for the 4 types of did:btcr2. `raw.didResolutionMetadata.errorMessage` is removed. The top-level `error` and `errorMessage` do not change.
  - api: Breaking: `DidResolutionResult` is a type of the api, with `didDocument: Btcr2DidDocument | null`. The api no longer exports the `DidResolutionResult` of `@web5/dids`. The type `ResolutionError` is new.
  - api: `tryResolveDid` with a DID that is not a string, or with the empty string, gives `INVALID_DID`. Before, a DID that is not a string made `tryResolveDid` throw.
  - cli: `resolve`, `update`, and `deactivate` refuse a field of the `-r` or `-p` resolution options that the resolver does not support. `resolve` of a valid DID of another method prints `Invalid did method: ...`.

## 10.0.1

### Patch Changes

- `JSONPatch.apply` runs the patch on a JSON copy of the operations (ADR 139).

  - common: the operations stay unchanged. Before, a later operation that wrote inside an added value also changed the operation. The checks run on the copy. The strict mode does not refuse a nested `undefined` any more: the copy drops it, as the signed update does. The error message of a failed path check names the index of the failing operation. Before, it said "at operation 0".
  - method: an update whose patch writes inside an added value now resolves. Before, `Updater.construct` embedded a changed patch, and each resolver refused the update with `INVALID_DID_UPDATE`. The resolver hashes the update as received, so a duplicate of such an update is confirmed.
  - method, api, aggregation: dependency uptake. The browser bundle holds the fix.

## 10.0.0

### Major Changes

- The late-publishing error code is `LATE_PUBLISHING`, the code of the specification. `JSONPatch.apply` is strict by default (ADR 112). The deprecated options overload of `NotImplementedError` is gone (ADR 085).

  - common: the error code `LATE_PUBLISHING_ERROR` is now `LATE_PUBLISHING`, in name and in value. The `strict` option of `JSONPatch.apply` and `JSONPatch.validateOperations` defaults to `true`. Pass `{ strict: false }` for the lenient mode. `NotImplementedError` takes the type and the data positionally only. Breaking: all three changes.
  - method: the resolver raises `LATE_PUBLISHING` for a skipped version and for a duplicate that does not match the applied update. Breaking: the error type changes.
  - api: a resolution that finds late publishing fails with the error type `LATE_PUBLISHING`. Breaking: the error type changes.
  - keypair, cryptosuite, bitcoin, key-manager, aggregation, cli: dependency uptake.

## 9.7.0

### Minor Changes

- The SMT path follows the leaf values, the proof bit sequence, and the signal results of specification pull request 365 (ADR 120).

  - smt: `bitAt(i)` counts from the left, and `collapsed` follows the same sequence. `leafValue(nonce?, updateId?)` returns one of the four leaf values. `TreeEntry` is `{ did, nonce?, updateId? }`, with `updateId` the JSON Document Hash of the update. `verifyProof(proof, did)` verifies a serialized proof for a DID and returns `false` on a malformed proof. It never throws. `BTCR2MerkleTree.proof` returns an empty-index proof for a DID that is not in the tree. A nonce has any length. Breaking: every root and every proof changes. `TreeEntry.signedUpdate`, `inclusionLeafHash`, and `nonInclusionLeafHash` are gone.
  - common: the `INVALID_SIGNAL_DATA` error code.
  - method: the SMT beacon checks that the id of the proof is the signal root, verifies the proof with `verifyProof`, raises `INVALID_SIGNAL_DATA` on a failure, and produces no tuple for a proof without `updateId`. The resolver keeps `current_block_height` and drops a signal below it. `provide()` raises `INVALID_SIGNAL_DATA` for a signed update hash mismatch and for a malformed or mismatched SMT proof. It raises `MISSING_UPDATE_DATA` for a CAS announcement hash mismatch. Breaking: the error types of these failures change.
  - aggregation: the cohort builds its SMT entries with `updateId` and verifies the participant view with `verifyProof`.
  - api: a resolution that needs an SMT proof that the sidecar does not hold fails with a typed `ResolveError` of type `MISSING_UPDATE_DATA`. The vector build script adds SMT entries with `updateId`.
  - cli: documentation and dependency uptake.

## 9.6.0

### Minor Changes

- The update paths check the proof fields and the proof time window, accept an embedded verification method, apply the JSON Patch strictly, and raise `INVALID_DID_UPDATE` (ADR 112).

  - common: `JSONPatch.apply` takes a `strict` option. With `strict: true`, an unknown `op`, a missing `value`, a `remove` or `replace` of a missing path, a `move` or `copy` from a missing path, and a failed `test` fail the patch at the first failing operation. The default does not change.
  - method: the resolver checks `type`, `cryptosuite`, `proofPurpose`, `capabilityAction`, and `capability` by string equality before it verifies the signature. Both paths locate the verification method through the `capabilityInvocation` entry, in the reference form or the embedded form. The resolver checks `created` and `expires` against the block of the Beacon Signal. Both paths apply the patch strictly and check the `id` and the DID Core conformance of the patched document. Every failure that the specification names is an `UpdateError` or a `ResolveError` of type `INVALID_DID_UPDATE`, with the inner error in `data.cause`. `Updater.sign` verifies the proof before the state machine asks for funding. `DidBtcr2.deactivate` and `DEACTIVATION_PATCH` are new. `capability` and `capabilityAction` are required in the proof types. `DidBtcr2.update` refuses a `sourceVersionId` that is not an integer of at least 1. Breaking: the write path raises `INVALID_DID_UPDATE` where it raised `INVALID_DID_DOCUMENT` for a method that is not authorized or not found.
  - api: `DidMethodApi.DEACTIVATION_PATCH` is the constant of the method package. The error type of an unauthorized or unknown verification method is `INVALID_DID_UPDATE`.
  - cli: documentation only.

## 9.5.0

### Minor Changes

- Resolution reports the required DID document metadata (`confirmations`, `deactivated`; `contentType: application/did`) and the DID Resolution error codes (`INVALID_DID`, `NOT_FOUND`, `MISSING_UPDATE_DATA`, `INTERNAL_ERROR`); `CasApi.retrieve` checks the content hash (ADR 110).

## 9.4.0

### Minor Changes

- Add `INVALID_OPTIONS` to `MethodErrorCode` and to the named exports. It is the DID Resolution v1.0 error code for an invalid resolution option, which the did:btcr2 specification reuses.

## 9.3.0

### Minor Changes

- Keep prototype machinery out of JSON Patch pointers and out of JSON walks.

  - `JSONPatch.validateOperations` rejects any `path` or `from` whose RFC 6901 segments, unescaped, include `__proto__`, `constructor`, or `prototype`, at any position. `fast-json-patch` bans `__proto__` and a trailing `constructor/prototype` pair, but it still traverses an intermediate `constructor` segment, at which point the cursor is the global `Object` or `Array` function and the operation writes a static member process-wide. Patches carried by untrusted DID updates reach this validator, so the segments are refused before any application.
  - **Semantic change:** a document key literally named `constructor`, `prototype`, or `__proto__` is no longer addressable by patch. No DID Core or btcr2 vocabulary defines such a property, and patching every other key of such a document still works.
  - `JSONUtils.clone`, `deleteKeys`, and `sanitize` define copied keys as own enumerable data properties instead of assigning them. A plain `result[key] = value` routes the key `__proto__` through the inherited `Object.prototype` setter, which discards the key and swaps the copy's prototype for the supplied value. `JSON.parse` produces `__proto__` as an own enumerable key, so a document carrying one previously lost it on every walk while the copy inherited attacker-supplied properties. Canonicalization and `canonicalHash` are byte-identical to before for every input without such a key.

## 9.2.0

### Minor Changes

- Typed errors for the utility surface (ADR 085): every error constructed in `src/` is now a `DidMethodError` subclass.

  - `DateUtils.toISOStringNonFractional` and `toUnixSeconds` throw `MethodError` with type `INVALID_DATE` (was bare `Error`).
  - The `JSONUtils.deepEqual`/`clone` guards throw `MethodError` with types `MAX_DEPTH_EXCEEDED` and `CIRCULAR_STRUCTURE` (was bare `Error`).
  - `JSONPatch.validateOperations` returns `MethodError` with type `JSON_PATCH_VALIDATION_ERROR` (was bare `Error`); its declared return type narrows from `Error | null` to `MethodError | null`.
  - `NotImplementedError` now extends `DidMethodError` and gains the standard `(message, type?, data?)` constructor. The legacy options-object second argument remains as a deprecated overload, slated for removal at the next major.

  Error messages are unchanged at every touched site; only the class, `name`, and `type` surfaces changed.
