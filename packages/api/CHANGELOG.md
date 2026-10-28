# @did-btcr2/api

## 0.36.0

### Minor Changes

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

- A failed resolution gives the error object of DID Resolution v1. The resolver refuses a resolution option that it does not support (ADR 157).

  - common: `MethodErrorCode.FEATURE_NOT_SUPPORTED` and its named export `FEATURE_NOT_SUPPORTED` are new.
  - method: Breaking: `DidBtcr2.resolve` checks the resolution options in the order of DID Resolution v1, section 4.4, before it returns the `Resolver`. An option name other than `accept`, `expandRelativeUrls`, `noCache`, `versionId`, `versionTime`, `minConf`, `sidecar`, and `maxDiscoveryRounds` gives a `ResolveError` of type `FEATURE_NOT_SUPPORTED`. `expandRelativeUrls: true` also gives `FEATURE_NOT_SUPPORTED`. A wrong value of `accept`, `expandRelativeUrls`, `noCache`, `sidecar`, or `maxDiscoveryRounds` gives `INVALID_OPTIONS`. Options that are not an object, for example `null`, also give `INVALID_OPTIONS`. Before, the resolver ignored each such option, and `null` gave a raw `TypeError`.
  - method: Breaking: `ResolutionOptions` no longer extends `DidResolutionOptions` of `@web5/dids`. It declares `accept`, `expandRelativeUrls`, and `noCache`. A TypeScript caller that gives another option name gets a compile error.
  - method: Breaking: `Identifier.decode` checks the DID syntax of DID Core v1.1 first. A valid DID of another method gives `METHOD_NOT_SUPPORTED`, for example `did:example:a:b` (before: `INVALID_DID`). An identifier that is not a DID gives `INVALID_DID`, for example `did:BTCR2:k1...` (before: `METHOD_NOT_SUPPORTED`). A value that is not a string gives `INVALID_DID`.
  - api: Breaking: `raw.didResolutionMetadata.error` of `tryResolveDid` is the error object `{ type, title, detail }` of DID Resolution v1, section 10. `type` is the URL of the error type: `https://www.w3.org/ns/did#<CODE>` for the 9 types of DID Resolution v1, and the anchor of the type on `https://dcdpr.github.io/did-btcr2/errors.html` for the 4 types of did:btcr2. `raw.didResolutionMetadata.errorMessage` is removed. The top-level `error` and `errorMessage` do not change.
  - api: Breaking: `DidResolutionResult` is a type of the api, with `didDocument: Btcr2DidDocument | null`. The api no longer exports the `DidResolutionResult` of `@web5/dids`. The type `ResolutionError` is new.
  - api: `tryResolveDid` with a DID that is not a string, or with the empty string, gives `INVALID_DID`. Before, a DID that is not a string made `tryResolveDid` throw.
  - cli: `resolve`, `update`, and `deactivate` refuse a field of the `-r` or `-p` resolution options that the resolver does not support. `resolve` of a valid DID of another method prints `Invalid did method: ...`.

- An error message prints only a primitive value of the caller. `BitcoinApi` refuses an unknown option value. The DID document context is frozen, and `Appendix.dereferenceZcapId` is removed (ADR 156).

  - method: an error message holds a value of the caller only if the value is a primitive. For an object or a function, the message holds no value, and the error `data` holds it. Before, an object with no usable `toString`, for example `Object.create(null)`, gave a raw `TypeError`. The sites: `Updater.signingMethod`, `Updater.construct`, `DidBtcr2.update`, the `NeedFunding` check, the resolution option checks, and the id check of the resolver. Each now gives its typed error. The message of another object no longer holds `[object Object]`.
  - method: `Updater.construct` refuses a `sourceDocument` that is not an object, with `Invalid sourceDocument: expected a DID document object.` It refuses a `sourceDocument.id` that is not a string, with a message that starts with `Invalid sourceDocument: expected a string id`. Each refusal is an `UpdateError` of type `INVALID_DID_UPDATE`. Before, an object id gave the message `Patches must not change the DID document id`.
  - method: Breaking: `BTCR2_DID_DOCUMENT_CONTEXT` is frozen, and its type is a `readonly` tuple. A write to the array throws a `TypeError`. A caller that builds a document must copy the array, for example `[...BTCR2_DID_DOCUMENT_CONTEXT]`.
  - method: Breaking: `Appendix.dereferenceZcapId` is removed. The specification no longer defines the algorithm. `Appendix.deriveRootCapability` gives the Root Capability of a DID.
  - method: the JSDoc links to the specification name each section without a section number, and the dead anchors are fixed. The README update example sets a REST host for `BitcoinConnection`.
  - api: Breaking: the `BitcoinApi` constructor refuses a `signalDiscovery` value other than `undefined`, `'indexer'`, and `'fullnode'`, for example `'Fullnode'` or `null`. Before, the api accepted such a value and read the signals as `'indexer'`.
  - api: Breaking: the `BitcoinApi` constructor refuses a network that is not an own key of `DEFAULT_BITCOIN_NETWORK_CONFIG`, for example `'toString'`. It refuses `'fullnode'` with no RPC config. Each of the three refusals is a `MethodError` of type `INVALID_OPTIONS`. Before, the two refusals gave a plain `Error`, and the network `'toString'` gave a raw `TypeError`. The first access of `api.btc` or `api.btcr2` throws the refusal.
  - api: the genesis document builder, the `verifyMessage` check detail, and the `announce.feeRate` check print only a primitive value in an error message.
  - cli: `config set`, the keystore and envelope version checks, and the `--source-document` id check print only a primitive value in an error message. Before, `config set` gave a raw `TypeError` for the value `{"toString":1}`. `resolve` with `fullnode` and no RPC config prints one line, with no stack.

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

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.74.0
  - @did-btcr2/common@11.0.0
  - @did-btcr2/cryptosuite@11.0.0
  - @did-btcr2/keypair@0.13.3
  - @did-btcr2/bitcoin@0.11.6
  - @did-btcr2/key-manager@0.7.2

## 0.35.0

### Minor Changes

- The DID document checks apply the member rules of DID Core v1.1. The write path and the create path also apply the rules of a producer (ADR 149).

  - method: Breaking: `DidDocument.isValid`, the `DidDocument` constructor, and the resolver apply the member rules of DID Core v1.1 and Controlled Identifiers v1.0. A method `controller` must be a DID. A method `id` and a relationship reference with the `did` scheme must be a DID URL, and one with no scheme must be an RFC 3986 relative reference. A verification relationship, `keyAgreement` included, needs one or more items. A service needs a string `id`, a `type`, and a `serviceEndpoint`, and two services cannot have the same `id`. Before, each path accepted a document that broke these rules.
  - method: Breaking: each path checks the key material and the dates of each method. A method cannot have both `publicKeyMultibase` and `publicKeyJwk`. A Multibase value must start with a registry header, and a `z` or `u` value must use only the characters of its alphabet. `publicKeyJwk` must have a string `kty` and no private member, for example `d`. `secretKeyJwk` is refused. `expires` and `revoked` must be XML Schema `dateTimeStamp` strings.
  - method: Breaking: `DidDocument.isValid(document, role)` and `validateGenesis(role)` take a role, `'consumer'` (the default) or `'producer'`. A producer also refuses an item that occurs two times in a set, two methods or services with one `id`, a `secretKeyMultibase`, and a URL with a wrong syntax in `controller`, `alsoKnownAs`, a service `id`, or a `serviceEndpoint`. A consumer accepts these values, as the consumption rules of DID Core require.
  - method: Breaking: `Updater.construct` checks the target document with the rules of a producer. Thus `DidBtcr2.update` and `Updater.sign` refuse a patch whose target breaks such a rule, also if the source document already holds the value. `GenesisDocument.create` and `GenesisDocument.fromPublicKey` also apply the rules of a producer.
  - method: Breaking: the messages name the member, the path of the value, and the rule, for example `Invalid "service": service[1].id is the id of service[0]: each service needs a different id` and `Invalid GenesisDocument verificationMethod: verificationMethod[0].controller must be a DID`. Before, the messages were `Invalid "verificationMethod"`, `Invalid "service"`, `Invalid verification relationships`, `Invalid GenesisDocument verificationMethod`, `Invalid GenesisDocument service`, and `Invalid GenesisDocument assertionMethod`.
  - method: Breaking: the `DidDocument` constructor checks that its input is a JSON object, and then runs the checks of `isValid` or `validateGenesis`. It no longer throws `DID Document must have an id`, `Invalid id: <id>`, `Invalid verificationMethod: <value>`, or `Invalid service: <value>`. Thus one input gives the same first error on each path. A value that is not a JSON object gives `Invalid DID document: the document must be a JSON object`.
  - method: Breaking: `GenesisDocument.fromJSON` and `Identifier.validate` apply the rules of the resolver. They no longer require the placeholder `did:btcr2:_` in each method `id` and service `id`. Only the create path keeps this rule.
  - method: Breaking: `DidDocument.isValidVerificationRelationships` is removed.
  - method: `Updater.construct` refuses a patch that replaces the whole document with a value that is not a JSON object. The message is `Error validating targetDocument: Invalid DID document: the document must be a JSON object`. Before, it threw a plain `TypeError`.
  - api: dependency uptake. The browser bundle holds the change. Breaking: `resolveDid`, `tryResolveDid`, `btcr2.resolve`, and `btcr2.getInitialDocument` refuse a DID document that breaks a member rule of DID Core v1.1. `did.validate(did, { genesisDocument })` applies the same rules, and it no longer requires the placeholder in each method `id` and service `id`.
  - api: Breaking: `btcr2.buildGenesisDocument`, `btcr2.createExternalFromDocument`, `btcr2.constructUpdate`, `btcr2.signUpdate`, `btcr2.update`, `btcr2.deactivate`, `updateDid`, and `deactivateDid` apply the rules of a producer to the document that they make. For example, a `serviceEndpoint` that is not a URL fails with `Invalid GenesisDocument service: service[1].serviceEndpoint must be a URL`. A source document that breaks a rule of a producer needs a patch that corrects the value, so `btcr2.deactivate` and `deactivateDid` fail for such a source.
  - cli: dependency uptake. `resolve`, `identifier decode --initial-document`, `message sign`, and `message verify` fail for a DID document that breaks a member rule of DID Core v1.1. `identifier validate --genesis-document` applies the rules of the resolver, so it reports `valid: true` for a genesis document with a method `id` or a service `id` without the placeholder.
  - cli: `genesis build`, `create -t x --document`, `update`, and `deactivate` apply the rules of a producer. For example, `update` fails with `Error validating targetDocument: Invalid "alsoKnownAs": alsoKnownAs[0] must be a URI`.

- A DID document holds only the members of its input: `@context` is required, and `verificationMethod` and `service` are optional (ADR 148).

  - method: Breaking: the `DidDocument` constructor sets no default member. Before, it wrote `verificationMethod: []`, `service: []`, and the two btcr2 contexts if the input did not have them. Now an absent member stays absent, so the hash of the document is the hash of its input. `GenesisDocument`, `DidDocument.fromExternalIdentifier`, and `Resolver.external` use this constructor.
  - method: Breaking: a DID document without `@context` fails with a `DidDocumentError` of type `INVALID_DID_DOCUMENT` and the message `Invalid "@context"`. This applies to `new DidDocument`, `DidDocument.fromExternalIdentifier`, `Resolver.external`, and the resolution of an EXTERNAL (`x1`) DID. Before, the constructor wrote the two btcr2 contexts. The resolved document then held a member that the genesis document did not hold. Thus its hash was not the hash of the document that the specification steps give.
  - method: Breaking: the genesis checks of `GenesisDocument` (`validateGenesis`) read `@context`. A document fails with `Invalid GenesisDocument "@context"` if `@context` is absent, is not an array, or does not hold both btcr2 contexts. Before, the genesis checks did not read `@context`, so `GenesisDocument.fromJSON` accepted these documents.
  - method: Breaking: the genesis checks also apply the shape checks of `DidDocument.isValid`, in this order: the id, `@context`, `verificationMethod`, `service`, and the verification relationships. Each verification method must have a string `id`, `type`, and `controller`. Each service must have an `id`, a `type`, and a `serviceEndpoint`, and its `id` must be a string. Before, a genesis method or service without `type` passed, an array service `id` with the placeholder passed, and a `null` member became `[]`. A `verificationMethod` or `service` that was a string, or a service `id` that was not a string or an array, gave a plain `TypeError`. Now each of these documents fails with `Invalid GenesisDocument verificationMethod` or `Invalid GenesisDocument service`.
  - method: `verificationMethod` and `service` are optional in a DID document and in a genesis document. `DidDocument.isValid` and the genesis checks accept an absent member and refuse `null`. Before, `new DidDocument` refused an absent member with `Invalid verificationMethod: undefined` or `Invalid service: undefined`. Thus the resolution of an `x1` genesis document without one of these members failed. Now it succeeds, and the resolved document does not have the member. For a document without `service`, the resolver asks for no beacon signals.
  - method: the genesis checks accept a verification method whose `controller` is another DID, for example `did:example:org`. Only the method that signs an update must have the DID as its controller (ADR 147). Before, `GenesisDocument.fromJSON` refused such a document with `Invalid GenesisDocument verificationMethod`, but `Resolver.external` accepted it.
  - method: Breaking: `Identifier.validate` with `options.genesisDocument` applies the new genesis checks. The `genesisDocument` check fails for a document without `@context` or with only one of the two btcr2 contexts. The detail is `Invalid genesis document: Invalid GenesisDocument "@context"`. The check passes for a method with another controller. Before, the results for these cases were the opposite.
  - method: Breaking: in the `Btcr2DidDocument` type, `@context` is required, and `verificationMethod` and `service` are optional. The `ExternalData` type and the `DidDocument` class have the same change. The `@context` field of the class has no default value. A TypeScript caller must check `verificationMethod` and `service` before use, for example with `document.service ?? []`.
  - method: Breaking: `DidDocumentBuilder` writes the two btcr2 contexts only if the initial document has no `@context`. It no longer writes `verificationMethod: []`. Without `withService`, `build()` now gives a document without `service`. Before, `build()` refused it with `Invalid service: undefined`.
  - method: `DidDocument.fromKeyIdentifier`, `GenesisDocument.create`, and `GenesisDocument.fromPublicKey` write the two btcr2 contexts. Each document holds its own copy of `BTCR2_DID_DOCUMENT_CONTEXT`, so a change to the document does not change the constant. The generated documents and their hashes do not change.
  - method: a DID document without `service` has no beacon. `BeaconUtils.getBeaconServices` returns `[]` if `service` is absent or is not an array. For such a source document, `DidBtcr2.update` raises an `UpdateError` of type `INVALID_DID_UPDATE` with the message `No beacon service found for provided beaconId`. Before, both threw a plain `TypeError`.
  - method: an update can remove `/service`, because the member is optional. `Updater.construct` accepts the patch, and the resolver applies the update. The resolver then ignores a later signal at a removed beacon address. Before, `Updater.construct` refused the patch with `Error validating targetDocument: Invalid "service"`, and the resolver refused the update with `INVALID_DID_UPDATE`. An update can also remove `/verificationMethod` if the verification relationships embed the methods. A patch that removes `/@context` still fails.
  - method: Breaking: `resolveBtcr2SenderPk` uses `Resolver.external`, so its result for an EXTERNAL (`x1`) sender changes. For a genesis document without `@context`, it returns `undefined`. Before, it returned the key. For a genesis document without `service` or without `verificationMethod`, it returns the key of `capabilityInvocation[0]`. Before, it returned `undefined`.
  - api: dependency uptake. The browser bundle holds the change. Breaking: the re-exported `Btcr2DidDocument` type has the change above. It is the type of these results: `btcr2.getInitialDocument`, `btcr2.buildGenesisDocument`, `ExternalCreateResult.didDocument`, and the `document` of a `ResolutionResult` with `ok: true`. A strict TypeScript caller must check `verificationMethod` and `service` before use.
  - api: Breaking: `Btcr2DidDocument` is also the type of these inputs: `SourceState.document` and the document of `btcr2.getBeacons`, `btcr2.signMessage`, `btcr2.verifyMessage`, and `btcr2.getSigningMethod`. A document that the caller builds for one of these inputs must have `@context`.
  - api: Breaking: `btcr2.getInitialDocument`, `btcr2.resolve`, `resolveDid`, and `tryResolveDid` refuse an `x1` genesis document without `@context`. `btcr2.getInitialDocument` raises a `DidDocumentError` of type `INVALID_DID_DOCUMENT` with the message `Invalid "@context"`. `resolveDid` raises `Failed to resolve DID <did>: Invalid "@context"`, and `tryResolveDid` gives the error `INVALID_DID_DOCUMENT`. Before, the api wrote the two btcr2 contexts into the document. The JSDoc of `btcr2.getInitialDocument` names the errors of the genesis document checks.
  - api: `btcr2.createExternalFromDocument`, `btcr2.getInitialDocument`, `resolveDid`, and `tryResolveDid` accept a genesis document without `service`. The initial DID document has no `service`, and `btcr2.getBeacons` returns `[]` for it. They also accept a genesis document without `verificationMethod` if the verification relationships embed the methods. Before, each of them failed, and the message ended with `Invalid service: undefined` or `Invalid verificationMethod: undefined`. Also, `btcr2.getBeacons` threw a plain `TypeError` for a document without `service`.
  - api: `btcr2.createExternalFromDocument` accepts a verification method whose `controller` is another DID, if the method does not sign updates. Before, it refused the document with `Invalid GenesisDocument verificationMethod`. Breaking: if the only `capabilityInvocation` method has another controller, the message is now `Invalid genesis document: the DID document has no capabilityInvocation method that can sign an update. Nobody can update or deactivate the DID.` A genesis document without `@context` still fails with `The genesis document "@context" must include "https://www.w3.org/ns/did/v1.1" and "https://btcr2.dev/context/v1".`
  - api: the api does not refuse a create or an update after which the DID document has no beacon service. The specification lets an update change each property except `id`. `btcr2.constructUpdate`, `btcr2.signUpdate`, and `btcr2.update` accept a patch that removes `/service`. Before, `btcr2.constructUpdate` refused it with `Error validating targetDocument: Invalid "service"`. After such an update, nobody can announce a later update for the DID. The JSDoc of `btcr2.createExternalFromDocument`, `btcr2.signUpdate`, and `btcr2.update` says this.
  - api: Breaking: `did.validate(did, { genesisDocument })` applies the new genesis checks of `Identifier.validate`. The `genesisDocument` check fails for a document without `@context` or with only one of the two btcr2 contexts. It also fails for a `null` member, and for a method or a service without `type`. It passes for a verification method with another controller. Before, the results for these cases were the opposite.
  - api: Breaking: for a genesis document with a `null` member or a member without `type`, `btcr2.createExternalFromDocument` gives `Invalid GenesisDocument verificationMethod` or `Invalid GenesisDocument service`. Before, the message was, for example, `Invalid service: null` or `Invalid verificationMethod: [object Object]`. A service `id` that is not a string now gives `Invalid GenesisDocument service`. Before, an `id` that was not a string or an array gave a plain `TypeError`.
  - api: for a source document without `service`, `btcr2.update`, `btcr2.deactivate`, `updateDid`, and `deactivateDid` raise an `UpdateError` of type `INVALID_DID_UPDATE`. Without `announce.beaconId`, the message is `DID document <did> has no beacon service. The api cannot derive beaconId.` With it, the message is `No beacon service found for provided beaconId`. Before, a `SourceState` without `service` gave a plain `TypeError`.
  - cli: dependency uptake. `identifier validate --genesis-document` reports `valid: true` for a genesis document whose verification method has another controller. It reports `valid: false` with exit code 1 for a genesis document without `@context` or with only one of the two btcr2 contexts. The detail is `Invalid genesis document: Invalid GenesisDocument "@context"`. Before, the results for these documents were the opposite.
  - cli: `identifier decode --initial-document --genesis-document`, `resolve`, `message sign`, and `message verify` fail for an `x` identifier whose genesis document has no `@context`. The message ends with `Invalid "@context"`, and the exit code is 1. Before, `identifier decode` printed an `initialDocument` with the two btcr2 contexts that the file did not hold.
  - cli: `create -t x --document`, `identifier decode --initial-document --genesis-document`, `resolve`, `message sign`, and `message verify` accept a genesis document without `service`. Before, each command failed, and the message ended with `Invalid service: undefined`. `create -t x --document` also accepts a verification method with another controller if the method does not sign updates. `create -t x --document` still refuses a file without `@context` with the api message above.
  - cli: `update` accepts a patch that removes `/service`. Before, it failed with `Error validating targetDocument: Invalid "service"`. After such an update, nobody can announce a later update for the identifier.
  - cli: `identifier validate --genesis-document` reports `valid: false` for a genesis document whose `verificationMethod` or `service` is `null`, or whose method or service has no `type`. Before, it reported `valid: true`. `create -t x --document` refuses these files with `Invalid GenesisDocument verificationMethod` or `Invalid GenesisDocument service`. Before, the message was, for example, `Invalid service: null`. A service `id` that is not a string also gives `Invalid GenesisDocument service`.

- A historical resolution processes the full history and returns the requested state (ADR 145).

  - method: the resolver keeps the state at the version that `versionId` or `versionTime` requests (`requested_state` of the specification). Then it processes the rest of the history and returns the kept state. Before, the resolver stopped at the requested version. Breaking: an error in a later update fails a historical request, for example `LATE_PUBLISHING` or `INVALID_DID_UPDATE`. The resolver also scans each beacon that a later update adds and emits the data needs of its signals. `maxDiscoveryRounds` counts the rounds of the full history.
  - api: dependency uptake. The browser bundle holds the fix. Breaking: `resolveDid` and `tryResolveDid` refuse the same historical requests. If an update after the requested version adds an SMT beacon, each beacon signal at that beacon now needs its proof in `sidecar.smtProofs`. A signal that announces no update for the DID also needs its proof.
  - cli: dependency uptake. `resolve` with a `versionId` or a `versionTime` in the resolution options processes the full history. An error in a later update fails the command with exit code 1. If an update after the requested version adds an SMT beacon, each beacon signal at that beacon needs its proof in `sidecar.smtProofs`.

- The write path refuses an `announce.publishToCas` value other than the three modes. Each api option refusal has the type `INVALID_OPTIONS` (ADR 150).

  - api: Breaking: `btcr2.update`, `btcr2.deactivate`, `updateDid`, and `deactivateDid` refuse an `announce.publishToCas` value other than `'never'`, `'auto'`, and `'always'`, for example `null` or `'Never'`. The error is an `UpdateError` of type `INVALID_OPTIONS` with the message `` `announce.publishToCas` must be 'never', 'auto', or 'always'. `` and `data.publishToCas`. The check runs before any read, signature, CAS publication, or broadcast. `undefined` still gives the default `'never'`. Before, each other value acted as `'auto'`: with a writable CAS, it published the signed update, and a typo of `'always'` with a read-only CAS skipped the publication silently.
  - api: Breaking: four other option refusals of the write path have the type `INVALID_OPTIONS`. Before, the type was `INVALID_DID_UPDATE`. The refusals are both `announce.feeRate` and `announce.feeEstimator`, an `announce.feeRate` that is not a positive finite number, no Bitcoin connection, and `publishToCas: 'always'` with no writable CAS. The messages do not change.

- The write path and the resolver check the method that signs an update with the same three conditions (ADR 147).

  - method: `Updater.signingMethod(sourceDocument, verificationMethodId)` is new. It returns the verification method that can sign an update. An entry of `capabilityInvocation` must identify the method. The method must pass three conditions: it has the type `Multikey`, the DID as its controller, and a BIP340 Multikey key in base58btc text. `DidBtcr2.update` and `Updater.sign` apply these rules.
  - method: Breaking: `Updater.sign(sourceDocument, unsignedUpdate, verificationMethodId, signer)` replaces `Updater.sign(did, unsignedUpdate, verificationMethod, signer)`. The DID is `sourceDocument.id`. The method id is absolute or relative.
  - method: Breaking: `UpdaterParams.verificationMethod` is now `verificationMethodId`, a string.
  - method: Breaking: `NeedSigningKey.verificationMethodId` is the absolute id, for example `<did>#initialKey`. The proof names the method by this id.
  - method: Breaking: the resolver raises `INVALID_DID_UPDATE` if the method that signs an update does not pass all three conditions. Before, the resolver did not compare the controller with the DID, and it did not check the type of an embedded method. It also accepted a key in another text for the same bytes.
  - method: Breaking: `DidDocument` accepts a verification method of any type. Each method must have a string `id`, `type`, and `controller`. Before, `DidDocument` refused a method that was not a `Multikey` with a `zQ3s` key.
  - method: Breaking: the `DidVerificationMethod` constructor keeps every own property of its input that has a value other than `undefined`, for example `publicKeyJwk`. It does not check the type or the key. It does not raise an error.
  - method: Breaking: `publicKeyMultibase` is optional on `Btcr2VerificationMethod` and `DidVerificationMethod`.
  - method: Breaking: the package no longer exports `isMultikeyVerificationMethod` and `MULTIKEY_PUBLIC_KEY_MULTIBASE_PREFIX`. `MULTIKEY_VERIFICATION_METHOD_TYPE` stays.
  - method: Breaking: the method id must be under the DID. A relative id must start with `#`. The write path refuses an id under another DID and a relative id that starts with `?` or `/`. It also refuses an absolute URI that is not a DID URL. It signs with a `<did>?...` or `<did>/...` id. Before, `Updater.sign` refused an id with no `#`.
  - method: Breaking: `DidBtcr2.update` raises `INVALID_DID_UPDATE` if the type or the key of the method is not valid. Before, it raised `INVALID_DID_DOCUMENT` with the full method as data. The data is now `{ verificationMethodId, field, actual, cause? }`.
  - method: Breaking: `Updater.sign` refuses an unsigned update that does not belong to `sourceDocument`. Each error message starts with `Invalid unsignedUpdate:`. The update must have no own `proof` member and a `targetVersionId` that is an integer of 2 or more. Its `@context`, `sourceHash`, `patch`, and `targetHash` must agree with `sourceDocument`.
  - method: Breaking: `Updater.construct` refuses a `sourceVersionId` that is not an integer of 1 or more. The message is `Invalid sourceVersionId: expected an integer of 1 or more.`
  - method: Breaking: `Updater.sign` wraps an error of the signer or the cryptosuite in an `UpdateError` of type `INVALID_DID_UPDATE`. The message starts with `Invalid signer:` or `Invalid update: cannot make the proof with`. `data.cause` holds the type and the message of the inner error, for example `KEY_NOT_SIGNER` for a watch-only key.
  - method: Breaking: `Updater.sign` no longer writes the proof into its input. It returns a new object, so you can sign the same unsigned update again.
  - method: Breaking: `DidBtcr2.getSigningMethod` applies the rules of `Updater.signingMethod`. It finds the method only through an entry of `capabilityInvocation` and has no `assertionMethod` fallback. It raises an `UpdateError` of type `INVALID_DID_UPDATE`. Before, it searched every verification method and raised a `MethodError` or a `DidError`.
  - method: Breaking: `getAggregationCommunicationKey` raises `INVALID_DID_DOCUMENT` if the `capabilityInvocation[0]` method cannot sign an update. For an EXTERNAL (`x1`) sender with such a method, `resolveBtcr2SenderPk` returns `undefined`.
  - api: dependency uptake. The browser bundle holds the change. Breaking: `resolveDid` and `tryResolveDid` fail with `INVALID_DID_UPDATE` if the method that signs an update does not pass all three conditions. They accept a DID document with a verification method of any type.
  - api: Breaking: `btcr2.signUpdate(source, unsignedUpdate, verificationMethodId, signer)` replaces `btcr2.signUpdate(did, unsignedUpdate, verificationMethod, signer)`. `source` holds the source document and its `versionId`.
  - api: Breaking: `btcr2.signUpdate` refuses an unsigned update whose `targetVersionId` is not `source.versionId + 1`. `btcr2.signUpdate` and `btcr2.constructUpdate` refuse a `source.versionId` that is not an integer of 1 or more.
  - api: Breaking: `btcr2.signUpdate`, `btcr2.update`, and `updateDid` refuse an update after which no `capabilityInvocation` method can sign an update. The message starts with `Invalid update: after this update, the DID document has no capabilityInvocation method that can sign an update.` A target document with `deactivated === true` passes. `btcr2.update` refuses before any chain read and any signature.
  - api: Breaking: `btcr2.createExternalFromDocument` refuses a genesis document with `INVALID_DID_DOCUMENT` if no `capabilityInvocation` method of the initial DID document can sign an update. The message is `Invalid genesis document: the DID document has no capabilityInvocation method that can sign an update. Nobody can update or deactivate the DID.` A genesis document with `deactivated === true` passes.
  - api: Breaking: if the caller omits `verificationMethodId`, the api derives it only from the `capabilityInvocation` methods that can sign an update. The error messages for zero matches and for several matches change.
  - api: Breaking: `btcr2.getSigningMethod` applies the rules of `DidBtcr2.getSigningMethod` above, with the same errors.
  - aggregation: the service accepts a submitted update whose proof names a `<did>?...` or `<did>/...` method id. The service takes the text in front of the first `?`, `/`, or `#` as the DID. Before, it took the text in front of the first `#`. The browser bundle holds the fix.
  - aggregation: the JSDoc example of `AggregationParticipantRunner` uses the new parameters of `Updater.sign`.
  - cli: dependency uptake. `update` and `deactivate` apply the new rules for the method that signs an update. `update` refuses an update after which no `capabilityInvocation` method can sign an update. `create --document` and `genesis build` refuse such a genesis document.
  - cli: the `--help` text of `update -m` and `deactivate -m` names the new default: the one `capabilityInvocation` method that can sign an update and publishes the signing key.

- The resolver reads SMT proof ids and CAS Announcement values as decoded bytes (ADR 146).

  - method: `Resolver.sidecarData` ignores a sidecar SMT proof whose `id` does not decode to 32 bytes, for example an `id` with non-zero pad bits. Before, an item that is not an object or a proof with no string `id` stopped each resolution with a plain `Error` or `TypeError`. A proof whose `id` the strict decoder refuses (for example non-zero pad bits or `=` padding) also stopped it with a plain `Error`. This was also true if no beacon signal needed the proof. For a beacon signal that needs an ignored proof, the resolver emits `NeedSMTProof`.
  - method: Breaking: `provide(NeedSMTProof)` raises `MISSING_UPDATE_DATA` for a proof whose `id` has non-zero pad bits. `SMTBeacon.processSignals` emits `NeedSMTProof` for such a proof in a caller-built map. Before, both raised `INVALID_SIGNAL_DATA`.
  - method: Breaking: `CASBeacon.processSignals` raises a `CASBeaconError` of type `MISSING_UPDATE_DATA` if the CAS Announcement has an entry for the DID whose value is not a base64url SHA-256 hash. Before, an entry with an empty string, `null`, `0`, `NaN`, or `false` counted as no entry, and the resolution succeeded. In a `SidecarData` that the caller builds, an own entry whose value is `undefined` also counted as no entry. A value that did not decode threw a plain `Error`. A value that decoded to another length emitted `NeedSignedUpdate` with a hash of that length.
  - method: the CAS Announcement rule applies to `sidecar.casUpdates` and to a string value from `provide(NeedCASAnnouncement)`. From `provide(NeedCASAnnouncement)`, a value that is not a string still fails with `INVALID_DID_UPDATE`.
  - api: dependency uptake. The browser bundle holds the fix. Breaking: `resolveDid` and `tryResolveDid` fail with `MISSING_UPDATE_DATA` if the CAS Announcement value for the DID is not a base64url SHA-256 hash. Before, they accepted the values `''`, `null`, `0`, `NaN`, and `false` in `sidecar.casUpdates`. From the CAS, an announcement with a value that is not a string still fails with `INVALID_DID_UPDATE`.
  - api: an unused item of `sidecar.smtProofs` that is not an object, or an unused proof whose `id` the strict decoder refuses, no longer fails the resolution. Before, `tryResolveDid` gave `INTERNAL_ERROR` for it. If a beacon signal needs the proof, the resolution now fails with `MISSING_UPDATE_DATA`. The `MISSING_UPDATE_DATA` error for a needed SMT proof says that the resolver ignores a proof whose `id` does not decode to 32 bytes.
  - cli: dependency uptake. `resolve`, `update`, `deactivate`, `message sign`, and `message verify` fail with exit code 1 if the CAS Announcement value for the DID is not a base64url SHA-256 hash. Before, these commands accepted the values `''`, `null`, `0`, `NaN`, and `false` in `sidecar.casUpdates`. An unused item of `sidecar.smtProofs` whose `id` does not decode to 32 bytes no longer fails these commands.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.73.0

## 0.34.4

### Patch Changes

- `DidDocument` keeps every property, and only the KEY template sets the `#initialKey` relationships (ADR 144).

  - method: `DidDocument` copies each property of its input, and `toJSON` returns every property. Before, the constructor kept only nine properties, so `Resolver.external` dropped the other genesis properties (for example `alsoKnownAs`, `controller`, `keyAgreement`) and hashed the smaller document. A first update with the `sourceHash` of the full document then failed with `INVALID_DID_UPDATE`. Breaking: the constructor adds no `#initialKey` relationship to a `k1` document. `DidDocument.fromKeyIdentifier` sets the four relationships of the KEY template, and `Resolver.deterministic` calls it.
  - api: the browser bundle holds the method fix. `resolve` and `getInitialDocument` keep every genesis property.

- Updated dependencies []:
  - @did-btcr2/method@0.72.0

## 0.34.3

### Patch Changes

- A beacon signal checks each selected UTXO against its previous transaction (ADR 143).

  - method: `fetchBeaconFunding` checks that the previous transaction of each selected UTXO hashes to the txid, and that its output at the vout pays the listed value to the beacon script. A difference throws `BeaconError` `PREVOUT_MISMATCH` before the signature, and no transaction goes to the network. Before, the builders took the input values from the REST listing only. A legacy (P2PKH) sighash does not commit to the input values, so a low listing value made a P2PKH signal pay the difference as fee.
  - api: the browser bundle holds the method fix. `PREVOUT_MISMATCH` is not a funding error.

- Updated dependencies []:
  - @did-btcr2/method@0.71.3

## 0.34.2

### Patch Changes

- The deactivation checks use strict equality (`deactivated === true`), and `DidDocument` keeps the `deactivated` property (ADR 142).

  - method: `DidDocument` keeps the `deactivated` property of the input. Before, the constructor lost it, so an `x1` genesis document with `"deactivated": true` resolved as not deactivated. Step 2 of Process Next Update stops only if `current_document.deactivated` is `true`. Before, a value such as `"no"` or `1` stopped resolution and hid the later updates. The metadata `deactivated` is `true` only if the document holds the boolean `true`, else `false`.
  - api: the update chokepoint and `deactivate` refuse a source document only if `deactivated === true`. The browser bundle holds the method fix.

- Updated dependencies []:
  - @did-btcr2/method@0.71.2

## 0.34.1

### Patch Changes

- The resolver removes only the top-level proof before it hashes an update (ADR 141).

  - method: the Apply step and the Confirm Duplicate step of the resolver both hash the update without its top-level `proof`. Before, the Apply step removed each member named `proof` at each depth, also inside the patch. Thus a second Beacon Signal of an update whose patch holds a member named `proof` raised `LATE_PUBLISHING`. A nested member named `proof` now stays in the hash.
  - api: dependency uptake. The browser bundle holds the fix.

- Updated dependencies []:
  - @did-btcr2/method@0.71.1

## 0.34.0

### Minor Changes

- The resolver checks the genesis id and compares with the DID under resolution (ADR 140).

  - method: `Resolver.external` refuses a genesis document whose `id` is not `did:btcr2:_` with `INVALID_DID_DOCUMENT`. Before, such a document resolved to a document for another DID. The proof checks (`capability`, `invocationTarget`), the patched-id check, and the CAS and SMT beacons use the DID under resolution, not `current_document.id`. Breaking: the data of the patched-id error is `{ did, id }`. Before, it was `{ sourceId, targetId }`.
  - api: dependency uptake. The browser bundle holds the fix. Breaking: `resolve` and `getInitialDocument` refuse the same genesis document.
  - cli: dependency uptake.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.71.0

## 0.33.1

### Patch Changes

- `JSONPatch.apply` runs the patch on a JSON copy of the operations (ADR 139).

  - common: the operations stay unchanged. Before, a later operation that wrote inside an added value also changed the operation. The checks run on the copy. The strict mode does not refuse a nested `undefined` any more: the copy drops it, as the signed update does. The error message of a failed path check names the index of the failing operation. Before, it said "at operation 0".
  - method: an update whose patch writes inside an added value now resolves. Before, `Updater.construct` embedded a changed patch, and each resolver refused the update with `INVALID_DID_UPDATE`. The resolver hashes the update as received, so a duplicate of such an update is confirmed.
  - method, api, aggregation: dependency uptake. The browser bundle holds the fix.

- Updated dependencies []:
  - @did-btcr2/common@10.0.1
  - @did-btcr2/method@0.70.1

## 0.33.0

### Minor Changes

- The indexer signal discovery reads the full history of a beacon address (ADR 138).

  - method: `BeaconSignalDiscovery.indexer` reads each page of the confirmed history (`GET /address/:address/txs/chain`) with an overlap cursor. Before, it read only the newest 25 transactions, so 25 payments to a beacon address hid an older signal. If the history changes during discovery, the resolve fails with `INTERNAL_ERROR`: resolve again later. Breaking: the Esplora server must serve the chain listing in a stable order. A mempool instance needs `MEMPOOL_BACKEND=esplora`.
  - bitcoin: the new export `ESPLORA_CHAIN_PAGE_SIZE` (25). `EsploraProtocol.getAddressTxsChain` adds `?max_txs=25`.
  - api: dependency uptake. The browser bundle holds the new discovery. Breaking: the same Esplora server requirements.
  - cli: dependency uptake.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.5
  - @did-btcr2/method@0.70.0

## 0.32.1

### Patch Changes

- Sign a text message with a did:btcr2 identifier, and verify a signed message (ADR 137).

  - api: `api.btcr2.signMessage(document, message, signer, options?)` returns a `SignedMessage`: the text and a `bip340-jcs-2025` proof with the fixed proof purpose `assertionMethod`. `api.btcr2.verifyMessage(document, signedMessage)` returns a `MessageReport` with five checks: `structure`, `signer`, `active`, `assertionMethod`, and `signature`. Neither function does I/O. New types: `SignedMessage`, `SignMessageOptions`, `MessageCheckName`, `MessageCheck`, and `MessageReport`.
  - cli: `btcr2 message sign -i <identifier> <message>` resolves the current DID document and prints the signed message. `btcr2 message verify -i <identifier> <path>` checks a signed message file against the current DID document. A failed check gives exit code 1. Both commands take `--sidecar` and `--min-conf`. `message verify --offline` checks against the initial DID document with no resolution.

## 0.32.0

### Minor Changes

- An update is refused if the source resolution misses an update of the sidecar data (spec PR 377, ADR 135).

  - api: for a DID source, `updateDid` and `deactivateDid` refuse the update if the resolved `versionId` is less than the highest `targetVersionId` of the sidecar updates of the DID. The error is an `UpdateError` with `INVALID_DID_UPDATE` and the data `{ did, versionId, announcedVersionId, minConf }`. Without sidecar updates, the api does no check. A `SourceState` source skips the check.
  - cli: `update` and `deactivate` get the check for each update in the identifier record. The `update` and `deactivate` pages give the remedy and the escape.

## 0.31.0

### Minor Changes

- The proof of an update has `invocationTarget`, and `updated` is the block `mediantime` (spec PRs 379 and 380).

  - method: `Btcr2DataIntegrityProof` and `Btcr2DataIntegrityConfig` have the required field `invocationTarget`. `Updater.sign` sets it to the DID. The resolver raises `INVALID_DID_UPDATE` if `update.proof.invocationTarget` is not the DID. Breaking: an update with no `invocationTarget` does not resolve.
  - method: `didDocumentMetadata.updated` is the `mediantime` of the block of the last applied update, not the header time.
  - api: a new update has `invocationTarget`. A resolution fails with `INVALID_DID_UPDATE` for an update with no `invocationTarget`. Breaking: an update that an earlier version signed does not resolve.
  - cli: dependency uptake.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.69.0

## 0.30.0

### Minor Changes

- The late-publishing error code is `LATE_PUBLISHING`, the code of the specification. `JSONPatch.apply` is strict by default (ADR 112). The deprecated options overload of `NotImplementedError` is gone (ADR 085).

  - common: the error code `LATE_PUBLISHING_ERROR` is now `LATE_PUBLISHING`, in name and in value. The `strict` option of `JSONPatch.apply` and `JSONPatch.validateOperations` defaults to `true`. Pass `{ strict: false }` for the lenient mode. `NotImplementedError` takes the type and the data positionally only. Breaking: all three changes.
  - method: the resolver raises `LATE_PUBLISHING` for a skipped version and for a duplicate that does not match the applied update. Breaking: the error type changes.
  - api: a resolution that finds late publishing fails with the error type `LATE_PUBLISHING`. Breaking: the error type changes.
  - keypair, cryptosuite, bitcoin, key-manager, aggregation, cli: dependency uptake.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@10.0.0
  - @did-btcr2/method@0.68.0
  - @did-btcr2/bitcoin@0.11.4
  - @did-btcr2/cryptosuite@10.0.1
  - @did-btcr2/key-manager@0.7.1
  - @did-btcr2/keypair@0.13.2

## 0.29.1

### Patch Changes

- A beacon signal spends all eligible UTXOs of the beacon address, the funding error gives the reason for each beacon, and a change output stays spendable (ADR 134).

  - method: `selectBeaconFunding(utxos, { beaconAddress, network, feeEstimator?, changeAddress?, maxInputs? })` selects the UTXOs of a signal and sizes the fee and the change. A UTXO is eligible if it is confirmed and its value is more than the fee of its own input. A single-party signal spends all eligible UTXOs, up to `MAX_BEACON_TX_INPUTS` (20). Over the limit, it spends the 20 of the largest value. The total value must be more than the fee.
  - method: a change output exists only if a later signal at the same fee rate can spend it. Else the remainder goes to the fee.
  - method: new exports `BeaconFunding`, `BeaconFundingOptions`, `BEACON_INPUT_VBYTES`, and `MAX_BEACON_TX_INPUTS`. `beaconTxVsize` takes the number of inputs as a third parameter.
  - BREAKING: method: `selectSpendableUtxo` and `SPENDABLE_DUST_LIMIT_SATS` are removed. Use `selectBeaconFunding`. `BeaconTxPlan.utxo` is now `utxos`. The protected `SinglePartyBeacon.buildSinglePartyTx` is synchronous and takes `{ signalBytes, beaconAddress, funding, prevTxs, signer, network }`.
  - method: `buildAggregationBeaconTx` keeps one input, and spends the eligible UTXO of the largest value, not the deepest one.
  - api: the funding guard and the beacon derivation of `update` call `selectBeaconFunding` with the fee rate and the change address of `announce`. A fee shortfall now fails before any CAS publication. The derivation error names each beacon, its address, and its reason, and its data holds `beacons: [{ id, type, address, reason }]`. The guard error data holds `reason`.
  - api: an invalid `announce.changeAddress` now fails at the guard or the derivation, before any CAS publication.
  - cli: the docs and the `-b` help text describe the new rule and errors.
  - aggregation, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/method@0.67.0

## 0.29.0

### Minor Changes

- The api exports only its facade, and a sub-facade function does each CRUD step (ADR 132).

  - BREAKING: api: the package root does not export the classes of the lower packages as values (`Identifier`, `GenesisDocument`, `Resolver`, `Updater`, `BeaconUtils`, `LocalSigner`, `KeyManagerSigner`, `LocalKeyManager`, `SchnorrKeyPair`, `BitcoinConnection`, `canonicalHash`, `JSONPatch`, `Appendix`, and others), or the internal helpers (`rootCauseMessage`, `resolutionErrorCode`, the free `buildGenesisDocument`). Use the sub-facade functions that ADR 132 names.
  - api: `api.btcr2.constructUpdate` and `api.btcr2.signUpdate` make a signed update with no broadcast. `api.btcr2.hashDocument`, `applyPatch`, and `rootCapability` give JSON Document Hashing, the target document of a patch, and the root capability of a DID.
  - api: the `api.smt` sub-facade builds the Sparse Merkle Tree of an SMT beacon signal and verifies an SMT proof.
  - api: `announce.feeRate` sets a fixed fee rate in sats/vB. `api.crypto.keypair.fromPublicKey` makes a watch-only key pair.
  - api: the package exports `DidMethodError` and the error classes that the facade throws, and each type that a public signature uses.
  - cli: the cli imports only `@did-btcr2/api` and `@did-btcr2/key-manager`. The printed output does not change.

## 0.28.3

### Patch Changes

- The cli publishes to an IPFS node behind HTTP Basic auth, takes one CAS endpoint for all networks, and prints only the identifier from `create` (ADRs 128, 129, 130).

  - api: `IpfsRpcCasExecutor` takes `{ auth: { username, password } }` and sends `Authorization: Basic ...` with `block/get`, `block/put`, and the probe. `CasConfig.rpcAuth` gives the credentials to the executor that `CasApi` makes from `rpcUrl` (ADR 128).
  - cli: `--cas-rpc-user`, `BTCR2_CAS_RPC_USER`, `BTCR2_CAS_RPC_PASS`, `BTCR2_CAS_RPC_PASS_FILE`, and the profile keys `cas.rpcUser` and `cas.rpcPass` give the credentials. There is no password flag (ADR 128).
  - cli: `defaults.cas` in the config file holds the CAS values for all networks, below the profile `cas` block (ADR 129).
  - BREAKING: the CAS endpoint comes from one layer. The highest layer that sets a gateway or an RPC URL gives the gateway, the URL, and the credentials. So a flag or environment gateway now wins over a profile `cas.rpcUrl` (ADR 129).
  - BREAKING: in text mode, `create` prints only the identifier. `--verbose` adds the key note and the funding hint on stderr (ADR 130).
  - cli: `-q` is the short form of `--quiet`. With it, `config validate` and `identifier validate` print only `OK` or one line for each failure (ADR 130).

## 0.28.2

### Patch Changes

- `btcr2 config doctor` checks the request path of the commands (ADR 125).

  - api: `CasExecutor` gets the optional method `probe(signal?)`. The gateway and the RPC executors read the identity CID `bafkqaclenfsduytumnzde` (the bytes `did:btcr2`) through the request of `retrieve` and compare the bytes. The check needs no content in the IPFS network, and it writes nothing. The new method `CasApi.probe()` aborts at the CAS timeout.
  - cli: the `btc-rest` and `btc-rpc` checks read the hash of a block that only the chain of the network has (the genesis block, or block 1 on signet and mutinynet). The `cas` check calls `CasApi.probe`. Each check uses the api client of the commands with a 5-second abort. A web page, an endpoint of another chain, or a gateway base URL no longer passes.

## 0.28.1

### Patch Changes

- The default config works in a browser with no proxy and no custom executor (ADR 124).

  - bitcoin: a GET request carries no `Content-Type`, so a browser sends no CORS preflight. `POST /tx` sends `text/plain` and the `RestConfig` headers, and the protocol ignores a `Content-Type` entry in `RestConfig.headers`. `HttpRequest` gets the optional field `fresh`, which `EsploraProtocol` sets on each endpoint whose response can change. The new export `createFetchExecutor({ timeoutMs? })` sends a fresh request with `cache: 'no-store'` and a random `_` query parameter. `defaultHttpExecutor` is `createFetchExecutor()`.
  - api: `BitcoinApi` uses `createFetchExecutor` for the default executor and for the `timeoutMs` executor. `DEFAULT_CAS_GATEWAY` is `https://trustless-gateway.link`, because `ipfs.io` redirects a raw-block read there with no CORS header.
  - cli: the docs and the config file example name the new default CAS gateway.
  - method, aggregation: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.3
  - @did-btcr2/method@0.66.3

## 0.28.0

### Minor Changes

- `updateDid` and `deactivateDid` follow the signatures of the specification (ADR 123).

  - api: `updateDid(source, patch, signer, options?)` and `deactivateDid(source, signer, options?)` replace the single objects with eleven and ten fields. `source` is a DID, which the api resolves, or a resolved `SourceState` `{ document, versionId }`. `options` holds `verificationMethodId`, `resolutionOptions`, and `announce`. `announce` holds `beaconId`, `signer` (the beacon input signer, the old `beaconSigner`), `feeEstimator`, `changeAddress`, `publishToCas`, and `bitcoin`. `DidMethodApi.update(source, patch, signer, options?)` and `DidMethodApi.deactivate(source, signer, options?)` take the same shape with a `SourceState`. New exported types: `SourceState`, `UpdateSource`, `UpdateOptions`, `DidUpdateOptions`, `AnnounceOptions`. Breaking: `UpdateBuilder` and `DidMethodApi.buildUpdate` are removed, and the half-supplied source pair refusal is replaced by the `SourceState` type.
  - cli: `UpdateCommandOptions` is `{ source, signer, options }`. `update` and `deactivate` refuse a `--source-document` whose `id` is not the identifier. No flag changes.

## 0.27.2

### Patch Changes

- The REST client returns the block height as a number.

  - bitcoin: `BitcoinBlock.count()` converts the `text/plain` body of the Esplora tip height to a number. Before, it returned the body as a string, for example `'601'`. A body that is not a non-negative integer raises `BitcoinRestError`.
  - method, aggregation, api, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.2
  - @did-btcr2/method@0.66.2

## 0.27.1

### Patch Changes

- The api exports the steps of a vector tool, and the SMT verifier rejects an empty sibling in `hashes` (ADR 122).

  - smt: the result of `verifyZeroHash`, `verifyProof`, and `verifySerializedProof` is `false` if a `0` bit of `collapsed` selects an entry of `hashes` that is equal to the cached zero of its level. This follows specification pull request 370. `serializeProof` writes the properties in the order of the SMT Proof data structure: `id`, `nonce`, `updateId`, `collapsed`, `hashes`. No root or hash changes.
  - method: `DidDocument.fromKeyIdentifier` sets the document `id` to the DID and the verification method id to `<did>#initialKey`. Before, the constructor threw `INVALID_DID_DOCUMENT` for each input.
  - api: the package root exports `canonicalHash`, `JSONPatch`, and `Appendix`.
  - aggregation, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/method@0.66.1

## 0.27.0

### Minor Changes

- The SMT path follows the leaf values, the proof bit sequence, and the signal results of specification pull request 365 (ADR 120).

  - smt: `bitAt(i)` counts from the left, and `collapsed` follows the same sequence. `leafValue(nonce?, updateId?)` returns one of the four leaf values. `TreeEntry` is `{ did, nonce?, updateId? }`, with `updateId` the JSON Document Hash of the update. `verifyProof(proof, did)` verifies a serialized proof for a DID and returns `false` on a malformed proof. It never throws. `BTCR2MerkleTree.proof` returns an empty-index proof for a DID that is not in the tree. A nonce has any length. Breaking: every root and every proof changes. `TreeEntry.signedUpdate`, `inclusionLeafHash`, and `nonInclusionLeafHash` are gone.
  - common: the `INVALID_SIGNAL_DATA` error code.
  - method: the SMT beacon checks that the id of the proof is the signal root, verifies the proof with `verifyProof`, raises `INVALID_SIGNAL_DATA` on a failure, and produces no tuple for a proof without `updateId`. The resolver keeps `current_block_height` and drops a signal below it. `provide()` raises `INVALID_SIGNAL_DATA` for a signed update hash mismatch and for a malformed or mismatched SMT proof. It raises `MISSING_UPDATE_DATA` for a CAS announcement hash mismatch. Breaking: the error types of these failures change.
  - aggregation: the cohort builds its SMT entries with `updateId` and verifies the participant view with `verifyProof`.
  - api: a resolution that needs an SMT proof that the sidecar does not hold fails with a typed `ResolveError` of type `MISSING_UPDATE_DATA`. The vector build script adds SMT entries with `updateId`.
  - cli: documentation and dependency uptake.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@9.7.0
  - @did-btcr2/method@0.66.0

## 0.26.0

### Minor Changes

- The api takes a separate signer for the beacon transaction input (ADR 119).

  - api: `beaconSigner?: Signer` on `update`, `deactivate`, `updateDid`, `deactivateDid`, and `UpdateBuilder.beaconSigner()`. It signs the beacon transaction input and defaults to `signer`. A beacon at a key other than the DID key is now usable through the api.
  - cli: dependency uptake.

## 0.25.2

### Patch Changes

- The resolver keys the processed beacon signals by beacon address (ADR 118).

  - method: the processed set of BeaconProcess is keyed by beacon address, not by service id. A rotated beacon whose old address carried a signal now resolves past the rotation. `Identifier.encode` rejects a numeric-string network such as `'5'`, which the numeric enum read as a network name and minted as a mainnet identifier.
  - bitcoin: the REST client reads the status before it parses the body. A non-OK status raises `FAILED_HTTP_REQUEST` with the status, the URL, and the body. An OK status with a body that is not JSON raises `INVALID_HTTP_RESPONSE`.
  - aggregation, api, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/method@0.65.1
  - @did-btcr2/bitcoin@0.11.1

## 0.25.1

### Patch Changes

- The resolver ignores the signals of a beacon address that an applied update removed from the DID document (ADR 114, specification pull request 367).

  - method: each update tuple carries the beacon address of its signal. Step 4 of "Process Next Update" ignores a tuple whose address the current document does not carry: the tuple stamps no metadata, enters no history, and does not reach the duplicate check. An update announced at the address that it removes still applies. Breaking: a history that announces a later version at a removed beacon address resolves to the last version that a kept address announced, and a `versionId` that only an ignored update reaches fails with `NOT_FOUND`. A conflicting re-announcement at a removed address is ignored; before, it raised `LATE_PUBLISHING`.
  - api: dependency uptake.
  - cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/method@0.65.0

## 0.25.0

### Minor Changes

- The update paths check the proof fields and the proof time window, accept an embedded verification method, apply the JSON Patch strictly, and raise `INVALID_DID_UPDATE` (ADR 112).

  - common: `JSONPatch.apply` takes a `strict` option. With `strict: true`, an unknown `op`, a missing `value`, a `remove` or `replace` of a missing path, a `move` or `copy` from a missing path, and a failed `test` fail the patch at the first failing operation. The default does not change.
  - method: the resolver checks `type`, `cryptosuite`, `proofPurpose`, `capabilityAction`, and `capability` by string equality before it verifies the signature. Both paths locate the verification method through the `capabilityInvocation` entry, in the reference form or the embedded form. The resolver checks `created` and `expires` against the block of the Beacon Signal. Both paths apply the patch strictly and check the `id` and the DID Core conformance of the patched document. Every failure that the specification names is an `UpdateError` or a `ResolveError` of type `INVALID_DID_UPDATE`, with the inner error in `data.cause`. `Updater.sign` verifies the proof before the state machine asks for funding. `DidBtcr2.deactivate` and `DEACTIVATION_PATCH` are new. `capability` and `capabilityAction` are required in the proof types. `DidBtcr2.update` refuses a `sourceVersionId` that is not an integer of at least 1. Breaking: the write path raises `INVALID_DID_UPDATE` where it raised `INVALID_DID_DOCUMENT` for a method that is not authorized or not found.
  - api: `DidMethodApi.DEACTIVATION_PATCH` is the constant of the method package. The error type of an unauthorized or unknown verification method is `INVALID_DID_UPDATE`.
  - cli: documentation only.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@9.6.0
  - @did-btcr2/method@0.64.0

## 0.24.1

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.63.0

## 0.24.0

### Minor Changes

- Resolution reports the required DID document metadata (`confirmations`, `deactivated`; `contentType: application/did`) and the DID Resolution error codes (`INVALID_DID`, `NOT_FOUND`, `MISSING_UPDATE_DATA`, `INTERNAL_ERROR`); `CasApi.retrieve` checks the content hash (ADR 110).

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@9.5.0
  - @did-btcr2/method@0.62.0

## 0.23.1

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.61.0

## 0.23.0

### Minor Changes

- Add `api.btcr2.buildGenesisDocument(spec)` and `api.btcr2.createExternalFromDocument(document, options)` (ADR 108). The builder takes public keys with their relationships, beacons (a key with an address type, or a Bitcoin address), and other services, and returns the Genesis Document with the placeholder id `did:btcr2:_`. The default beacon is one Singleton beacon with the P2WPKH address of the first key. The builder refuses a spec with no `capabilityInvocation` method or no beacon. `createExternalFromDocument` checks the document, hashes it as given, encodes the EXTERNAL identifier, and returns `{ did, genesisBytes, didDocument }`. Neither method does I/O. The package exports the spec types and the constants `VERIFICATION_RELATIONSHIPS`, `BEACON_TYPES`, `BEACON_ADDRESS_TYPES`, and `DEFAULT_BEACON_ADDRESS_TYPE`.

## 0.22.0

### Minor Changes

- `DidApi.decode` declares `DidComponents`, with the Bech32m `hrp`, the value it always returned. New `DidApi.validate(did, options?)` returns the identifier validation report of `Identifier.validate` and does not throw on an invalid identifier (ADR 107). `options.genesisBytes` adds the check that the identifier encodes these bytes. The package exports `DidComponents`, `IdentifierReport`, `IdentifierCheck`, `IdentifierCheckName`, and `IdentifierValidateOptions`.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.60.0

## 0.21.0

### Minor Changes

- `resolveDid`, `tryResolveDid`, `updateDid`, and `deactivateDid` accept `minConf` on `ResolutionOptions`: the confirmations a beacon signal needs before resolution applies it. Default `6`, the specification value. `DEFAULT_MIN_CONF` is re-exported. Breaking: a default resolve no longer applies a signal with fewer than six confirmations; pass `{ minConf: 1 }` to see a fresh update after one block.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.0
  - @did-btcr2/common@9.4.0
  - @did-btcr2/method@0.59.0

## 0.20.0

### Minor Changes

- Complete the CRUD cycle on the api facade alone (ADRs 093 to 104).

  A caller now creates a DID, funds its beacon, updates the DID, deactivates it, and resolves it with this package only. Before this release, a caller needed the method and keypair packages for a `Signer` and for the beacon address, and `deactivateDid` threw `NotImplementedError`.

  Create:

  - `createDid`, `generateDid`, `DidMethodApi.createDeterministic`, and `DidMethodApi.createExternal` mint the DID for the network of the configured Bitcoin connection if the caller names no network. Without a connection, they mint for regtest (`DidMethodApi.FALLBACK_NETWORK`). They never mint for mainnet by omission. `BitcoinApi.network` and `DidMethodApi.defaultNetwork` expose the network in use.
  - `DidMethodApi.getInitialDocument(did, genesisDocument?)` derives the initial DID document offline. `DidMethodApi.getBeacons(document)` lists each beacon service with its Bitcoin address (new type `BeaconInfo`). A caller can fund a beacon before the first update with no connection.

  Read:

  - `resolveDid`, `tryResolveDid`, and `DidMethodApi.resolve` report the root cause of a failure. `resolveDid` and `DidMethodApi.resolve` throw `Failed to resolve DID <did>: <root cause>`. `tryResolveDid` sets `errorMessage` to the root cause, and the `ok: false` variant of `ResolutionResult` gains `cause`, the original thrown value. The new helper `rootCauseMessage(err)` follows a cause chain and reads the first sub-error of an `AggregateError`.
  - `resolveDid` and `DidMethodApi.resolve` refuse a DID whose network differs from the network of the Bitcoin connection (`ResolveError`). `tryResolveDid` returns `ok: false`, and the `ResolveError` is reachable through `cause`.

  Update and deactivate:

  - `deactivateDid` and `DidMethodApi.deactivate` are real operations. A deactivation is an update that carries `DidMethodApi.DEACTIVATION_PATCH`. The facade refuses a document that is already deactivated.
  - `updateDid` and `deactivateDid` accept `resolutionOptions`. The facade uses them if it resolves the source state itself. Supply sidecar data there if no CAS holds the prior updates.
  - `verificationMethodId` and `beaconId` are optional on `updateDid`, `deactivateDid`, `DidMethodApi.update`, and `DidMethodApi.deactivate`. The facade derives the verification method that publishes the signer's key. The facade derives the only beacon, else the one beacon that holds a spendable UTXO. If none or several candidates match, the facade throws an `UpdateError` of type `INVALID_DID_UPDATE` that names them.
  - Four new refusals, each an `UpdateError` of type `INVALID_DID_UPDATE`, each before any CAS publication and before the broadcast:
    - a source pair with only `sourceDocument` or only `sourceVersionId`, or a `sourceDocument.id` that is not the DID;
    - a deactivated source document;
    - a DID whose network differs from the network of the Bitcoin connection;
    - a beacon whose UTXOs are all unconfirmed, or all at or below the 546-sat dust limit. The funding guard applies `selectSpendableUtxo`, the rule of the beacon itself.

  Signers and exports:

  - `KeyManagerApi.signer(id?)` returns a `Signer` bound to the given key, else to the active key. `KeyManagerApi.activeKeyId` exposes the active key.
  - The package re-exports the write path and the signer types, so a CRUD cycle needs no second package: `LocalSigner`, `SchnorrKeyPair`, `KeyManagerSigner`, `LocalKeyManager`, `BitcoinConnection`, `DidBtcr2`, `Resolver`, `Updater`, `BeaconFactory`, `BeaconUtils`, and the types `Signer`, `SigningScheme`, `SignOptions`, `KmsSignOptions`, `KeyManager`, `KeyIdentifier`, `GenerateKeyOptions`, `ImportKeyOptions`, `VerifyOptions`, `BeaconService`, `BroadcastOptions`, `BroadcastResult`, `Btcr2DidDocument`, `CASAnnouncement`, `DidCreateOptions`, `IdentifierComponents`, `ResolutionOptions`, `Sidecar`, `SignedBTCR2Update`, `SMTProof`.

  Breaking:

  - The facade no longer mints a DID for mainnet if the caller names no network. `generateDid` with a Bitcoin connection mints for the network of the connection, not for regtest. Name the network to keep the old result.
  - In the four cases above, `updateDid` and `deactivateDid` throw where 0.19.x continued. `updateDid` no longer resolves the DID to complete a half-supplied source pair.
  - `DidMethodApi.deactivate` takes the update parameters and returns a `DidUpdateResult`. It threw `NotImplementedError` before.
  - The text of a resolution failure changed. The cli prints the new text on a `resolve` failure without `--verbose`.

## 0.19.2

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.58.0

## 0.19.1

### Patch Changes

- Accept relative DID URLs everywhere in a DID document, and take the DID a beacon serves by injection (ADR 091).

  DID Core permits a verification method or service `id`, and the entries of a verification
  relationship, to be a relative DID URL (`#initialKey`). This implementation only ever produced
  the absolute spelling and in three places required it, so a conformant document using the
  relative form did not resolve.

  - `SMTBeacon` and `CASBeacon` recovered the DID by slicing their own `service.id` on `#`, which
    yields the empty string for a relative id. The SMT beacon then indexed the tree at
    `didToIndex('')` and failed proof verification; the CAS beacon looked up `announcement['']`
    and **silently skipped the update**, completing resolution against a stale document.
    `SMTBeacon.broadcastSignal` had the same slice on the write path.
  - `DidBtcr2.getSigningMethod` compared verification method ids as raw strings, so an absolute
    `proof.verificationMethod` never matched a relative `verificationMethod[].id`.

  Beacons now take the DID they serve as a required constructor argument.
  `BeaconFactory.establish(service, did)` threads it, the `Resolver` supplies
  `currentDocument.id`, `Updater.announce(beaconService, did, ...)` takes it as a parameter, and
  `NeedBroadcast` carries a `did` field. Verification method lookup resolves both sides to
  absolute DID URLs first, via the new `Appendix.absoluteDidUrl`, which the read path's
  `capabilityInvocation` check now shares. Comparison is on the resolved URL rather than the
  fragment, so a reference naming a different DID still cannot match. The unused and misnamed
  `Appendix.extractDidFragment`, which returned its input unchanged, is removed.

  Breaking: the beacon constructors, `BeaconFactory.establish`, and `Updater.announce` each take
  one more required argument.

  `AggregationService` also rejected a relative `proof.verificationMethod` on the opt-in path
  when checking that a submission is signed by its sender's own key. That failed closed, so it
  was never a trust gap, but it turned away a legal spelling; the signing key is pinned by the
  opt-in record regardless, so the relative form now resolves to the sender.

  Together these let the danubetech `uni-resolver-driver-did-btcr2` examples 11a-b and 12a-b, two
  aggregate SMT cohorts on mutinynet, resolve to version 2.

- Updated dependencies []:
  - @did-btcr2/method@0.57.0

## 0.19.0

### Minor Changes

- Choose where beacon signals are read from on the Bitcoin connection.

  - Added `BitcoinApiConfig.signalDiscovery` (`'indexer' | 'fullnode'`, default `'indexer'`) and the `SignalDiscoveryMode` type, surfaced as the readonly `BitcoinApi.signalDiscovery`. `fullnode` scans every block from genesis over Bitcoin Core RPC instead of reading an Esplora index; it requires an `rpc` config (rejected at construction without one), a node with `-txindex=1`, and Bitcoin Core 25 or later for `getblock` verbosity 3, and the linear scan makes it practical only on regtest. Resolution reads the mode off the connection, not off the DID: which path reads the chain is a property of how this SDK talks to Bitcoin.
  - **BREAKING:** resolution inherits the `capabilityInvocation` authorization check from `@did-btcr2/method`, so a DID whose updates were signed by a key outside that relationship now resolves as an error rather than a document (ADR 088).
  - **BREAKING:** the re-exported `MultikeyObject` narrows with `@did-btcr2/cryptosuite`: its `keyPair` field carries public key material only.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.10.0
  - @did-btcr2/common@9.3.0
  - @did-btcr2/cryptosuite@10.0.0
  - @did-btcr2/method@0.56.0

## 0.18.0

### Minor Changes

- `DidMethodApi.deactivate()` now rejects with a `NotImplementedError` whose `name` and `type` are both `DID_API_METHOD_NOT_IMPLEMENTED` (ADR 085); previously `name` was `NOT_IMPLEMENTED_ERROR` while `type` was `DID_API_METHOD_NOT_IMPLEMENTED`. The error is also now `instanceof DidMethodError` via the reparented `NotImplementedError` in `@did-btcr2/common`.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@9.2.0
  - @did-btcr2/method@0.55.0

## 0.17.0

### Minor Changes

- Add per-network presets: human-facing faucet and explorer metadata beside the endpoint config (ADR 082).

  - New `NETWORK_PRESETS` map (keyed by `NetworkName`) and the `NetworkPreset` type, carrying an optional `faucetUrl`, `explorerBaseUrl`, and `blockTimeHint` per network. mutinynet, signet, and the testnets get a faucet and explorer; regtest has neither; mainnet has an explorer but no faucet.
  - New pure helpers `explorerTxUrl(network, txid)`, `explorerAddressUrl(network, address)`, and `faucetUrl(network)`, each returning `undefined` for a network without the corresponding datum.
  - These are the single source of truth for the faucet/explorer/block-time data previously duplicated privately in the `lib/` e2e scripts, and are consumed by the CLI to print funding and watch links.

  Purely additive: no existing export changes.

## 0.16.1

### Patch Changes

- Remove the dead `allowDefaultWallet: true` from the exported `DEFAULT_BITCOIN_NETWORK_CONFIG.regtest.rpc` default, following ADR 078's removal of `RpcConfig.allowDefaultWallet` in `@did-btcr2/bitcoin`. The field was never consumed at the transport, so this is a behavior-neutral tidy of the exported config surface.

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.9.0
  - @did-btcr2/method@0.54.1

## 0.16.0

### Minor Changes

- Make CAS publication opt-in: `publishToCas` now defaults to `'never'`, and `'auto'` no longer blocks an update.

  CAS publication is optional and never required: every update, for every beacon type, completes and is distributable via sidecar. The previous default of `'auto'` (from the prior release) was opt-out - it auto-published to any configured CAS and, for CAS beacons with no writable CAS, threw up-front - which effectively required CAS publication for that beacon type. This corrects that:

  - **Default is now `'never'`** on `DidMethodApi.update`, `DidBtcr2Api.updateDid`, and `UpdateBuilder`. Out of the box, nothing is published; a configured CAS never triggers publication on its own.
  - **`'auto'` is best-effort and never blocks:** it publishes when a writable CAS is configured, otherwise skips silently for every beacon type (CAS beacons included) and returns the artifacts for sidecar distribution. The CAS-beacon up-front throw is removed.
  - **`'always'` is unchanged:** it requires a writable CAS and throws up-front for every beacon type when none is available.

  Breaking for callers that relied on the implicit `'auto'` default: pass `publishToCas: 'auto'` explicitly to keep auto-publishing. See ADR 073 (supersedes ADR 071 §2).

## 0.15.0

### Minor Changes

- CAS publication policy on the update path, writable-CAS capability detection, and enriched update results (ADR 071).

  - `DidMethodApi.update`, `UpdateBuilder`, and `DidBtcr2Api.updateDid` gain `publishToCas: 'auto' | 'always' | 'never'` (default `'auto'`). Under `'auto'`/`'always'` with a writable CAS, the canonical signed update (all beacon types) and the CAS Announcement (CAS beacons) are published to the CAS **before** the on-chain broadcast, so any OP_RETURN update hash is fetchable from CAS at resolution time.
  - Policy guards fail fast, before signing: `'always'` throws when the CAS is read-only or absent; `'auto'` throws for CAS beacons in that case (a CAS-beacon signal whose announcement lands nowhere is unresolvable); set `'never'` for sidecar-only distribution. Singleton/SMT updates skip publication silently under `'auto'`.
  - **Privacy note:** `'auto'` publishes canonical signed updates to the configured (possibly public) CAS before anchoring. Privacy-conscious controllers should use `'never'` and distribute via sidecar.
  - `update()`/`updateDid()`/`UpdateBuilder.execute()` now return a `DidUpdateResult` (`{ signedUpdate, txid, announcement?, proof?, publishedToCas }`) instead of the bare `SignedBTCR2Update`; read `result.signedUpdate` for the old value.
  - `CasExecutor` gains optional `canPublish` (undefined means writable; `HttpGatewayCasExecutor` declares `false`); `CasApi` gains the `writable` getter.
  - `broadcastOptions` (fee estimator, change address) now pass through the api update path to the beacon transaction.
  - Fixed: `resolve()` no longer loops forever on an SMT beacon signal without a sidecar proof; it fails fast directing the caller to `options.sidecar.smtProofs` (SMT proofs are nonce-blinded and cannot be fetched from a CAS).

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.54.0

## 0.14.0

### Minor Changes

- Drop the `helia` production dependency in favor of fetch-based CAS executors (ADR 069). `BlockstoreCasExecutor` (structurally typed, accepts any in-process blockstore or blockstore provider, e.g. a Helia node) replaces `IpfsCasExecutor`; the new `IpfsRpcCasExecutor` publishes and retrieves raw blocks via the IPFS HTTP RPC API with local CID verification. `CasConfig` replaces `helia` with `blockstore` and adds `rpcUrl`; backend priority is `executor` > `blockstore` > `rpcUrl` > `gateway`. Consumers no longer install the libp2p subtree (436 lockfile packages removed).

## 0.13.12

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.53.0

## 0.13.11

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.52.0

## 0.13.10

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.51.0
