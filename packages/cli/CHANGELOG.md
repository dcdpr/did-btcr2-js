# @did-btcr2/cli

## 0.29.9

### Patch Changes

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

- Updated dependencies []:
  - @did-btcr2/api@0.35.0

## 0.29.8

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.34.0

## 0.29.7

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.33.0

## 0.29.6

### Patch Changes

- Sign a text message with a did:btcr2 identifier, and verify a signed message (ADR 137).

  - api: `api.btcr2.signMessage(document, message, signer, options?)` returns a `SignedMessage`: the text and a `bip340-jcs-2025` proof with the fixed proof purpose `assertionMethod`. `api.btcr2.verifyMessage(document, signedMessage)` returns a `MessageReport` with five checks: `structure`, `signer`, `active`, `assertionMethod`, and `signature`. Neither function does I/O. New types: `SignedMessage`, `SignMessageOptions`, `MessageCheckName`, `MessageCheck`, and `MessageReport`.
  - cli: `btcr2 message sign -i <identifier> <message>` resolves the current DID document and prints the signed message. `btcr2 message verify -i <identifier> <path>` checks a signed message file against the current DID document. A failed check gives exit code 1. Both commands take `--sidecar` and `--min-conf`. `message verify --offline` checks against the initial DID document with no resolution.

- Updated dependencies []:
  - @did-btcr2/api@0.32.1

## 0.29.5

### Patch Changes

- An update is refused if the source resolution misses an update of the sidecar data (spec PR 377, ADR 135).

  - api: for a DID source, `updateDid` and `deactivateDid` refuse the update if the resolved `versionId` is less than the highest `targetVersionId` of the sidecar updates of the DID. The error is an `UpdateError` with `INVALID_DID_UPDATE` and the data `{ did, versionId, announcedVersionId, minConf }`. Without sidecar updates, the api does no check. A `SourceState` source skips the check.
  - cli: `update` and `deactivate` get the check for each update in the identifier record. The `update` and `deactivate` pages give the remedy and the escape.

- Updated dependencies []:
  - @did-btcr2/api@0.32.0

## 0.29.4

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.31.0

## 0.29.3

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.30.0
  - @did-btcr2/key-manager@0.7.1

## 0.29.2

### Patch Changes

- `config validate` and `config doctor` report a config problem instead of a wrong result or a stop.

  - `config validate` stops with `CONFIG_READ_ERROR` and exit code 1 if the config file does not exist. Before, it printed `{ "ok": true, "issues": [] }`.
  - `config doctor` (and the probe of `quickstart`) reports a credential that it cannot read as a failed `btc-rpc` or `cas` check and still runs the other checks. Before, a missing `file:` password file stopped the command.

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
  - @did-btcr2/api@0.29.1

## 0.29.0

### Minor Changes

- Identifier records (ADR 133). The CLI keeps a record of each identifier in `<home>/dids.json`: the name, the keys, the signing key, the txids, and the sidecar data. `create`, `update`, and `deactivate` write the record. New subcommands `identifier list`, `show`, `add`, `remove`, and `sidecar`. `resolve`, `update`, and `deactivate` accept a record name in `-i` and use the stored sidecar data (the flags win). Breaking: `update` and `deactivate` now sign with the signing key of the record before `identity.default` and the active key. `config path` also prints `dids`.

## 0.28.1

### Patch Changes

- The api exports only its facade, and a sub-facade function does each CRUD step (ADR 132).

  - BREAKING: api: the package root does not export the classes of the lower packages as values (`Identifier`, `GenesisDocument`, `Resolver`, `Updater`, `BeaconUtils`, `LocalSigner`, `KeyManagerSigner`, `LocalKeyManager`, `SchnorrKeyPair`, `BitcoinConnection`, `canonicalHash`, `JSONPatch`, `Appendix`, and others), or the internal helpers (`rootCauseMessage`, `resolutionErrorCode`, the free `buildGenesisDocument`). Use the sub-facade functions that ADR 132 names.
  - api: `api.btcr2.constructUpdate` and `api.btcr2.signUpdate` make a signed update with no broadcast. `api.btcr2.hashDocument`, `applyPatch`, and `rootCapability` give JSON Document Hashing, the target document of a patch, and the root capability of a DID.
  - api: the `api.smt` sub-facade builds the Sparse Merkle Tree of an SMT beacon signal and verifies an SMT proof.
  - api: `announce.feeRate` sets a fixed fee rate in sats/vB. `api.crypto.keypair.fromPublicKey` makes a watch-only key pair.
  - api: the package exports `DidMethodError` and the error classes that the facade throws, and each type that a public signature uses.
  - cli: the cli imports only `@did-btcr2/api` and `@did-btcr2/key-manager`. The printed output does not change.

- Updated dependencies []:
  - @did-btcr2/api@0.29.0

## 0.28.0

### Minor Changes

- The cli publishes to an IPFS node behind HTTP Basic auth, takes one CAS endpoint for all networks, and prints only the identifier from `create` (ADRs 128, 129, 130).

  - api: `IpfsRpcCasExecutor` takes `{ auth: { username, password } }` and sends `Authorization: Basic ...` with `block/get`, `block/put`, and the probe. `CasConfig.rpcAuth` gives the credentials to the executor that `CasApi` makes from `rpcUrl` (ADR 128).
  - cli: `--cas-rpc-user`, `BTCR2_CAS_RPC_USER`, `BTCR2_CAS_RPC_PASS`, `BTCR2_CAS_RPC_PASS_FILE`, and the profile keys `cas.rpcUser` and `cas.rpcPass` give the credentials. There is no password flag (ADR 128).
  - cli: `defaults.cas` in the config file holds the CAS values for all networks, below the profile `cas` block (ADR 129).
  - BREAKING: the CAS endpoint comes from one layer. The highest layer that sets a gateway or an RPC URL gives the gateway, the URL, and the credentials. So a flag or environment gateway now wins over a profile `cas.rpcUrl` (ADR 129).
  - BREAKING: in text mode, `create` prints only the identifier. `--verbose` adds the key note and the funding hint on stderr (ADR 130).
  - cli: `-q` is the short form of `--quiet`. With it, `config validate` and `identifier validate` print only `OK` or one line for each failure (ADR 130).

- The network of the active profile wins over `defaults.network`, and a network mismatch prints a warning (ADR 131).

  - BREAKING: a command with no identifier takes its network from `-n`, then the active profile, then `defaults.network`, then `regtest`. A config file with `defaults.profile` and a different `defaults.network` now makes identifiers on the network of the profile. `keystore unlock` uses the same order for its mainnet gate.
  - `resolve`, `update`, and `deactivate` print a warning on stderr if the identifier network is not the network of the active profile. `create` and `genesis build` print the same text. `-q` suppresses it.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.28.3

## 0.27.0

### Minor Changes

- Each key command shows its key flag, and one default key applies to `create`, `update`, and `deactivate` (ADR 127).

  - BREAKING: `--signing-key <ref>` is a flag of `update` and `deactivate`, not a global flag. Put it after the command word: `btcr2 update --signing-key demo ...`.
  - BREAKING: `create` takes a stored key with `-k, --key <ref>`. Without `--key`, `create` uses the `identity.default` of the active profile, else the active key. It generates a key only if neither exists.
  - `update` and `deactivate` use the same default key, so the default key can update a new identifier.
  - The new page `docs/config-file.md` explains each key of the config file.

## 0.26.0

### Minor Changes

- The cli requires Node.js 24.7 or later, and the key commands are faster (ADR 126).

  - BREAKING: `engines.node` is `>=24.7.0`. On an older Node.js, `btcr2` writes `btcr2 needs Node.js 24.7 or later.` to stderr and exits with code 1.
  - The keystore derives each key with `crypto.argon2Sync` of Node.js. The output is the same as the output of `argon2id` from `@noble/hashes`, so an existing keystore opens with no migration. `key generate` takes 0.42 s, not 5.2 s.
  - `FileKeyStore.set()` checks the passphrase once against the verifier for each seal, not twice.

## 0.25.2

### Patch Changes

- `btcr2 config doctor` checks the request path of the commands (ADR 125).

  - api: `CasExecutor` gets the optional method `probe(signal?)`. The gateway and the RPC executors read the identity CID `bafkqaclenfsduytumnzde` (the bytes `did:btcr2`) through the request of `retrieve` and compare the bytes. The check needs no content in the IPFS network, and it writes nothing. The new method `CasApi.probe()` aborts at the CAS timeout.
  - cli: the `btc-rest` and `btc-rpc` checks read the hash of a block that only the chain of the network has (the genesis block, or block 1 on signet and mutinynet). The `cas` check calls `CasApi.probe`. Each check uses the api client of the commands with a 5-second abort. A web page, an endpoint of another chain, or a gateway base URL no longer passes.

- Updated dependencies []:
  - @did-btcr2/api@0.28.2

## 0.25.1

### Patch Changes

- The default config works in a browser with no proxy and no custom executor (ADR 124).

  - bitcoin: a GET request carries no `Content-Type`, so a browser sends no CORS preflight. `POST /tx` sends `text/plain` and the `RestConfig` headers, and the protocol ignores a `Content-Type` entry in `RestConfig.headers`. `HttpRequest` gets the optional field `fresh`, which `EsploraProtocol` sets on each endpoint whose response can change. The new export `createFetchExecutor({ timeoutMs? })` sends a fresh request with `cache: 'no-store'` and a random `_` query parameter. `defaultHttpExecutor` is `createFetchExecutor()`.
  - api: `BitcoinApi` uses `createFetchExecutor` for the default executor and for the `timeoutMs` executor. `DEFAULT_CAS_GATEWAY` is `https://trustless-gateway.link`, because `ipfs.io` redirects a raw-block read there with no CORS header.
  - cli: the docs and the config file example name the new default CAS gateway.
  - method, aggregation: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/api@0.28.1
  - @did-btcr2/method@0.66.3

## 0.25.0

### Minor Changes

- `updateDid` and `deactivateDid` follow the signatures of the specification (ADR 123).

  - api: `updateDid(source, patch, signer, options?)` and `deactivateDid(source, signer, options?)` replace the single objects with eleven and ten fields. `source` is a DID, which the api resolves, or a resolved `SourceState` `{ document, versionId }`. `options` holds `verificationMethodId`, `resolutionOptions`, and `announce`. `announce` holds `beaconId`, `signer` (the beacon input signer, the old `beaconSigner`), `feeEstimator`, `changeAddress`, `publishToCas`, and `bitcoin`. `DidMethodApi.update(source, patch, signer, options?)` and `DidMethodApi.deactivate(source, signer, options?)` take the same shape with a `SourceState`. New exported types: `SourceState`, `UpdateSource`, `UpdateOptions`, `DidUpdateOptions`, `AnnounceOptions`. Breaking: `UpdateBuilder` and `DidMethodApi.buildUpdate` are removed, and the half-supplied source pair refusal is replaced by the `SourceState` type.
  - cli: `UpdateCommandOptions` is `{ source, signer, options }`. `update` and `deactivate` refuse a `--source-document` whose `id` is not the identifier. No flag changes.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.28.0

## 0.24.8

### Patch Changes

- The REST client returns the block height as a number.

  - bitcoin: `BitcoinBlock.count()` converts the `text/plain` body of the Esplora tip height to a number. Before, it returned the body as a string, for example `'601'`. A body that is not a non-negative integer raises `BitcoinRestError`.
  - method, aggregation, api, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/method@0.66.2
  - @did-btcr2/api@0.27.2

## 0.24.7

### Patch Changes

- The api exports the steps of a vector tool, and the SMT verifier rejects an empty sibling in `hashes` (ADR 122).

  - smt: the result of `verifyZeroHash`, `verifyProof`, and `verifySerializedProof` is `false` if a `0` bit of `collapsed` selects an entry of `hashes` that is equal to the cached zero of its level. This follows specification pull request 370. `serializeProof` writes the properties in the order of the SMT Proof data structure: `id`, `nonce`, `updateId`, `collapsed`, `hashes`. No root or hash changes.
  - method: `DidDocument.fromKeyIdentifier` sets the document `id` to the DID and the verification method id to `<did>#initialKey`. Before, the constructor threw `INVALID_DID_DOCUMENT` for each input.
  - api: the package root exports `canonicalHash`, `JSONPatch`, and `Appendix`.
  - aggregation, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/method@0.66.1
  - @did-btcr2/api@0.27.1

## 0.24.6

### Patch Changes

- The SMT path follows the leaf values, the proof bit sequence, and the signal results of specification pull request 365 (ADR 120).

  - smt: `bitAt(i)` counts from the left, and `collapsed` follows the same sequence. `leafValue(nonce?, updateId?)` returns one of the four leaf values. `TreeEntry` is `{ did, nonce?, updateId? }`, with `updateId` the JSON Document Hash of the update. `verifyProof(proof, did)` verifies a serialized proof for a DID and returns `false` on a malformed proof. It never throws. `BTCR2MerkleTree.proof` returns an empty-index proof for a DID that is not in the tree. A nonce has any length. Breaking: every root and every proof changes. `TreeEntry.signedUpdate`, `inclusionLeafHash`, and `nonInclusionLeafHash` are gone.
  - common: the `INVALID_SIGNAL_DATA` error code.
  - method: the SMT beacon checks that the id of the proof is the signal root, verifies the proof with `verifyProof`, raises `INVALID_SIGNAL_DATA` on a failure, and produces no tuple for a proof without `updateId`. The resolver keeps `current_block_height` and drops a signal below it. `provide()` raises `INVALID_SIGNAL_DATA` for a signed update hash mismatch and for a malformed or mismatched SMT proof. It raises `MISSING_UPDATE_DATA` for a CAS announcement hash mismatch. Breaking: the error types of these failures change.
  - aggregation: the cohort builds its SMT entries with `updateId` and verifies the participant view with `verifyProof`.
  - api: a resolution that needs an SMT proof that the sidecar does not hold fails with a typed `ResolveError` of type `MISSING_UPDATE_DATA`. The vector build script adds SMT entries with `updateId`.
  - cli: documentation and dependency uptake.

- Updated dependencies []:
  - @did-btcr2/common@9.7.0
  - @did-btcr2/method@0.66.0
  - @did-btcr2/api@0.27.0

## 0.24.5

### Patch Changes

- The api takes a separate signer for the beacon transaction input (ADR 119).

  - api: `beaconSigner?: Signer` on `update`, `deactivate`, `updateDid`, `deactivateDid`, and `UpdateBuilder.beaconSigner()`. It signs the beacon transaction input and defaults to `signer`. A beacon at a key other than the DID key is now usable through the api.
  - cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/api@0.26.0

## 0.24.4

### Patch Changes

- The resolver keys the processed beacon signals by beacon address (ADR 118).

  - method: the processed set of BeaconProcess is keyed by beacon address, not by service id. A rotated beacon whose old address carried a signal now resolves past the rotation. `Identifier.encode` rejects a numeric-string network such as `'5'`, which the numeric enum read as a network name and minted as a mainnet identifier.
  - bitcoin: the REST client reads the status before it parses the body. A non-OK status raises `FAILED_HTTP_REQUEST` with the status, the URL, and the body. An OK status with a body that is not JSON raises `INVALID_HTTP_RESPONSE`.
  - aggregation, api, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/method@0.65.1
  - @did-btcr2/api@0.25.2

## 0.24.3

### Patch Changes

- The resolver ignores the signals of a beacon address that an applied update removed from the DID document (ADR 114, specification pull request 367).

  - method: each update tuple carries the beacon address of its signal. Step 4 of "Process Next Update" ignores a tuple whose address the current document does not carry: the tuple stamps no metadata, enters no history, and does not reach the duplicate check. An update announced at the address that it removes still applies. Breaking: a history that announces a later version at a removed beacon address resolves to the last version that a kept address announced, and a `versionId` that only an ignored update reaches fails with `NOT_FOUND`. A conflicting re-announcement at a removed address is ignored; before, it raised `LATE_PUBLISHING`.
  - api: dependency uptake.
  - cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/method@0.65.0
  - @did-btcr2/api@0.25.1

## 0.24.2

### Patch Changes

- The update paths check the proof fields and the proof time window, accept an embedded verification method, apply the JSON Patch strictly, and raise `INVALID_DID_UPDATE` (ADR 112).

  - common: `JSONPatch.apply` takes a `strict` option. With `strict: true`, an unknown `op`, a missing `value`, a `remove` or `replace` of a missing path, a `move` or `copy` from a missing path, and a failed `test` fail the patch at the first failing operation. The default does not change.
  - method: the resolver checks `type`, `cryptosuite`, `proofPurpose`, `capabilityAction`, and `capability` by string equality before it verifies the signature. Both paths locate the verification method through the `capabilityInvocation` entry, in the reference form or the embedded form. The resolver checks `created` and `expires` against the block of the Beacon Signal. Both paths apply the patch strictly and check the `id` and the DID Core conformance of the patched document. Every failure that the specification names is an `UpdateError` or a `ResolveError` of type `INVALID_DID_UPDATE`, with the inner error in `data.cause`. `Updater.sign` verifies the proof before the state machine asks for funding. `DidBtcr2.deactivate` and `DEACTIVATION_PATCH` are new. `capability` and `capabilityAction` are required in the proof types. `DidBtcr2.update` refuses a `sourceVersionId` that is not an integer of at least 1. Breaking: the write path raises `INVALID_DID_UPDATE` where it raised `INVALID_DID_DOCUMENT` for a method that is not authorized or not found.
  - api: `DidMethodApi.DEACTIVATION_PATCH` is the constant of the method package. The error type of an unauthorized or unknown verification method is `INVALID_DID_UPDATE`.
  - cli: documentation only.

- Updated dependencies []:
  - @did-btcr2/common@9.6.0
  - @did-btcr2/method@0.64.0
  - @did-btcr2/api@0.25.0

## 0.24.1

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.63.0
  - @did-btcr2/api@0.24.1

## 0.24.0

### Minor Changes

- Resolution reports the required DID document metadata (`confirmations`, `deactivated`; `contentType: application/did`) and the DID Resolution error codes (`INVALID_DID`, `NOT_FOUND`, `MISSING_UPDATE_DATA`, `INTERNAL_ERROR`); `CasApi.retrieve` checks the content hash (ADR 110).

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@9.5.0
  - @did-btcr2/method@0.62.0
  - @did-btcr2/api@0.24.0

## 0.23.2

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.61.0
  - @did-btcr2/api@0.23.1

## 0.23.1

### Patch Changes

- `btcr2 completion` builds the word list from the registered commands at run time, not from a constant. The list gains `init`, `quickstart`, `keystore`, and the built-in `help`, which the constant omitted.

## 0.23.0

### Minor Changes

- New `genesis` command group (ADR 108). `btcr2 genesis build` builds the genesis document of an external identifier, writes it to `--out` (default `genesis.json`; `--force` overwrites), and prints `{ did, network, genesisBytes, path, beacons }`. On a terminal the command asks for the keys, the relationships, the beacons, and the services; `--spec <path>` reads a JSON spec and asks nothing. `create -t x --document <path>` hashes a genesis document file and adds `genesisBytes` to the result. `resolve`, `update`, and `deactivate` gain `--genesis-document <path>`, which fills `sidecar.genesisDocument` and is refused for a `k` identifier. Breaking: the `create -t x` error message with no input names both `--document` and `--bytes`. The shell completion list gains `genesis`.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.23.0

## 0.22.0

### Minor Changes

- New `identifier` command group (ADR 107). `btcr2 identifier decode <did>` prints the identifier type, the hrp, the version, the network, and the genesis bytes as hex. `--initial-document` adds the initial DID document with no I/O; an external identifier needs `--genesis-document <path>` for it. `btcr2 identifier validate <did> [-b <hex>] [--genesis-document <path>]` prints the validation report and sets exit code 1 if the identifier is not valid; `-b` takes the genesis bytes of a `k` or an `x` identifier, the same value as `create -b`. Both subcommands are offline and keystore-free. The shell completion list gains `identifier`.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.22.0
  - @did-btcr2/method@0.60.0

## 0.21.0

### Minor Changes

- `update` and `deactivate` take `-i/--identifier <did>` and call the api's `updateDid` and `deactivateDid`. The api resolves the source document when `-s/--source-document` and `--source-version-id` are omitted; the pair stays available for offline use and must come whole. Both commands gain `-r/--resolution-options`, `--resolution-options-path`, and `--min-conf <n>` for that resolution; the three flags are refused together with the source pair. `-m/--verification-method-id` and `-b/--beacon-id` become optional overrides of the api's derivation, and `-b` takes a plain DID URL instead of a JSON string. `deactivate` no longer builds the deactivation patch; the api supplies it. Breaking: `-i` is required, `-b` no longer accepts JSON, and the `UpdateCommandOptions` type changes shape.

## 0.20.0

### Minor Changes

- `resolve` gains `--min-conf <n>`: the confirmations a beacon signal needs before resolution applies it. A positive integer; default `6`, the specification value. The flag overrides a `minConf` inside `-r`/`-p`. Breaking: a default `resolve` no longer shows an update with fewer than six confirmations; pass `--min-conf 1` to see a fresh update after one block.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.21.0
  - @did-btcr2/common@9.4.0
  - @did-btcr2/method@0.59.0

## 0.19.3

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.20.0

## 0.19.2

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.58.0
  - @did-btcr2/api@0.19.2

## 0.19.1

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.57.0
  - @did-btcr2/api@0.19.1

## 0.19.0

### Minor Changes

- Keep the Bitcoin RPC password off argv, and expose the beacon signal-discovery mode (ADR 087).

  - **BREAKING:** the `--btc-rpc-pass` flag and `GlobalOptions.btcRpcPass` are removed; passing the flag now fails parsing with `commander.unknownOption` and the command never runs. A password on argv is readable by any local user through `ps` and `/proc/<pid>/cmdline` while the process runs, and outlives it in shell history and CI logs. Supply it through `BTCR2_BTC_RPC_PASS`, a file named by `BTCR2_BTC_RPC_PASS_FILE`, or a profile `btc.rpcPass` holding a literal value or an `env:<VAR>` or `file:<path>` secret reference, matching the keystore passphrase, which is likewise never taken from a flag (ADR 077). Because the atomic credential unit binds url, user, and pass to one layer (ADR 074), a command-line `--btc-rpc-url` now takes its password from `BTCR2_BTC_RPC_PASS_FILE` and not from `BTCR2_BTC_RPC_PASS`.
  - **BREAKING:** `resolve` fails for a DID whose update proofs name a key outside the document's `capabilityInvocation`, following the read-path authorization check in `@did-btcr2/method` (ADR 088).
  - Added `--btc-signal-discovery <indexer|fullnode>`, `BTCR2_BTC_SIGNAL_DISCOVERY`, and `profiles.<name>.btc.signalDiscovery`: where beacon signals are read from. `fullnode` scans blocks over Bitcoin Core RPC and requires an RPC-capable connection. A bad value is rejected at the CLI with the same named-flag message from any precedence layer, rather than passed to the SDK.
  - `btcr2 config effective` reports the resolved `signalDiscovery` value, so a setting that changes resolution behaviour is visible to config introspection (ADRs 075, 078).
  - The command reference no longer suggests passing an `Authorization` header value on the command line: `--btc-rpc-header` and `--btc-rest-header` place whatever they carry on argv, with the same exposure as the removed password flag.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.19.0
  - @did-btcr2/common@9.3.0
  - @did-btcr2/method@0.56.0

## 0.18.1

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.18.0
  - @did-btcr2/common@9.2.0
  - @did-btcr2/method@0.55.0

## 0.18.0

### Minor Changes

- Add a `quickstart` command, fold the network into `init`, and print faucet/explorer links (ADRs 082, 083).

  - **`btcr2 quickstart`** collapses onboarding into one step: it composes `init` (home + config + keystore), records the network (default **mutinynet**), and optionally caches the session and probes endpoints. Flags: `-n/--network`, `--dev`, `--unlock` (opt-in session caching), `--ttl`, `--no-doctor`, `--allow-mainnet`, `--force`. Session caching stays opt-in so ADR 081's establish-vs-cache separation holds; on a fresh encrypted keystore `--unlock` reuses the establish-time passphrase with no second prompt. The endpoint probe runs by default but is advisory (a failed probe warns and still exits 0). Mainnet is guarded before any writes: `-n bitcoin` requires `--allow-mainnet`, and `-n bitcoin --dev` is refused.
  - **`btcr2 init` gains `-n/--network`**, recording `defaults.network` so later commands can drop `-n`; its output envelope gains a `network` field. The network write is idempotent and never clobbers a network the operator set earlier.
  - **Funding and watch links.** `create` on a testnet now prints the initial beacon address next to its faucet and explorer links; `update`/`deactivate` print a `Watch:` explorer link for the broadcast txid. These are text-mode stderr hints only, suppressed under `--quiet` and `--output json`, so machine output is unchanged.

  Breaking output surface: adds a `quickstart` result shape, a `network` field on `init` output, and new stderr hint lines. Machine (JSON) output shape is otherwise unchanged.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.17.0

## 0.17.0

### Minor Changes

- Add a session unlock agent so an encrypted keystore is authenticated once per session instead of on every command (ADR 081).

  - **`keystore unlock`** caches the verified passphrase in `<home>/session.json` (`0600`, TTL, bound to the keystore) so later commands do not re-prompt. `--ttl <duration>` sets the lifetime (bare seconds or an `s`/`m`/`h` suffix; default 1h, hard cap 24h; also `$BTCR2_KEYSTORE_TTL`).
  - **`keystore lock`** revokes the session; **`keystore status`** now reports whether a session is live and its remaining lifetime (a new `session` field on its output).
  - A cached session sits below `$BTCR2_KEYSTORE_PASSPHRASE` / `--passphrase-file` and above the interactive prompt, so unattended and CI paths still win and are never weakened by it. Establishment (the confirmed first passphrase, ADR 080) never consults the session, and the keystore verifier still checks every use, so a stale or forged cache can never seal a key under a divergent passphrase.
  - Mainnet keeps per-use authentication: `keystore unlock` refuses a `bitcoin` _default_ network unless `--allow-mainnet` is passed, and the session records that allowance so that at consumption a `bitcoin` operation (whose network is derived from the DID, not the config default) is withheld from a session lacking it and falls through to a per-use prompt, while other networks are still served. `change-passphrase`, `keystore init --force`, and `btcr2 init` (when it establishes a keystore) invalidate any cached session.
  - The cached passphrase is base64url-encoded, not encrypted: its only protection at rest is the `0600` file mode. This is a deliberate on-disk v1 for portability and a minimal diff; a future in-memory agent removes the on-disk persistence.

## 0.16.0

### Minor Changes

- Consolidate CLI state under one home directory and add a keystore lifecycle with a confirmed, verified passphrase and opt-in dev keystores (ADRs 079, 080).

  - **Single home directory (ADR 079, breaking default).** `config.json` and `keystore.json` now live side by side under one home: `~/.btcr2` on Linux/macOS, `%LOCALAPPDATA%\btcr2` on Windows, overridable with `--home` / `$BTCR2_HOME`. The old XDG config/data split is dropped outright (no migration path: re-run `btcr2 init` against the new home); `--config` / `--keystore` still override each file, so the split is reproducible explicitly. `btcr2 config path` now reports the home root.
  - **Confirmed, verified keystore passphrase (ADR 080).** The first passphrase is now established with a confirm prompt, and a keystore verifier makes every later use fail loudly (`Incorrect passphrase`) instead of sealing a key under an unknown or divergent passphrase, closing a key-loss bug where a first-key typo permanently sealed the keystore.
  - **`keystore` command group.** `keystore init` (encrypted by default, `--dev` for unencrypted), `keystore status`, and `keystore change-passphrase`.
  - **Opt-in dev keystores.** `--dev` establishes an unencrypted keystore (plaintext keys, no passphrase) for disposable testnet material; the CLI hard-refuses to sign or generate a mainnet (`bitcoin`) key with one.
  - **`btcr2 init`.** One-command setup that creates the home, a default config, and establishes the keystore (encrypted by default, `--dev` for testnet).

## 0.15.0

### Minor Changes

- User-configurable Bitcoin/CAS I/O with config correctness, validation, introspection, and secret handling (ADRs 074-078).

  - Config resolution correctness and safety: a malformed config now fails loudly instead of silently falling back to public endpoints or clobbering the file; a blank value at any precedence layer defers to the next layer; an empty `$XDG_CONFIG_HOME`/`$XDG_DATA_HOME` is treated as unset; the RPC url, user, and pass resolve as one atomic credential unit (a URL from a higher layer never inherits a lower layer's credentials); `config set` stores known scalar paths as strings; profiles gain an explicit `network` field and the two network resolvers are unified with a coherence warning; `defaults.output` is honored; `schemaVersion` is validated on read.
  - New Bitcoin/CAS I/O knobs, each with a `BTCR2_*` env var and a profile field: `--fee-rate`, `--change-address`, `--btc-timeout`, `--cas-timeout`, `--btc-rest-header`, `--btc-rpc-wallet`, `--btc-rpc-header`.
  - New introspection and validation: `config validate`, `config effective` (resolved values with per-value provenance), `config path`, and `config doctor` (endpoint reachability). `config set` rejects an invalid enum for a known key and warns on an unknown path.
  - Secret handling: `config get`/`list`/`effective` redact secret-looking values by default (`--show-secrets` reveals them); `rpcPass` accepts `env:<VAR>` and `file:<path>` secret references plus a `BTCR2_BTC_RPC_PASS_FILE` fallback.
  - Per-profile `identity.keystore` and `identity.default` are wired, below the `--keystore` / `--signing-key` flags.

  Printed output for `config get` and `config list` changes (secret values are now redacted by default), so this rides a minor bump.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.16.1
  - @did-btcr2/method@0.54.1

## 0.14.0

### Minor Changes

- Add writable-CAS configuration and an opt-in `--publish-to-cas` flag to `update`/`deactivate`.

  - New global `--cas-rpc-url <url>` flag, `BTCR2_CAS_RPC_URL` environment variable, and `profiles.<n>.cas.rpcUrl` config key configure a writable IPFS HTTP RPC endpoint (reads + writes). `resolveConnectionConfig` now carries `cas.rpcUrl` through the flag/env/config precedence chain; a previously silently-dropped `config set profiles.x.cas.rpcUrl` is now honored. When both a gateway and an RPC URL are set, the writable RPC endpoint takes precedence.
  - `update` and `deactivate` gain `--publish-to-cas <auto|always|never>`, validated at parse time and forwarded to the api's `publishToCas`. It **defaults to `never`**: CAS publication is optional and never required, so updates complete sidecar-only unless the user opts in. This replaces the hardcoded `'never'` from the previous release with no change to default behavior.

  See ADR 072.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.16.0

## 0.13.0

### Minor Changes

- **Breaking output change:** `update` and `deactivate` now print the api's enriched `DidUpdateResult` instead of the bare signed update. The old payload moves under `data.signedUpdate`; new fields are `data.txid`, `data.announcement` (CAS beacons), `data.proof` (SMT beacons), and `data.publishedToCas`. Note that `data.proof` changes meaning: it was the signed update's Data Integrity proof (now at `data.signedUpdate.proof`) and is now the optional SMT inclusion proof. Scripts parsing this output must be updated.

  The enriched output surfaces the artifacts required for manual sidecar distribution (txid, announcement, SMT proof). The cli passes `publishToCas: 'never'` explicitly (its CAS configuration is read-only gateway-only for now); a follow-up exposes writable-CAS configuration and a `--publish-to-cas` flag.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.15.0
  - @did-btcr2/method@0.54.0

## 0.12.18

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.14.0

## 0.12.17

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.53.0
  - @did-btcr2/api@0.13.12

## 0.12.16

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.52.0
  - @did-btcr2/api@0.13.11

## 0.12.15

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.51.0
  - @did-btcr2/api@0.13.10
