# @did-btcr2/method

## 0.73.0

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

## 0.72.0

### Minor Changes

- `DidDocument` keeps every property, and only the KEY template sets the `#initialKey` relationships (ADR 144).

  - method: `DidDocument` copies each property of its input, and `toJSON` returns every property. Before, the constructor kept only nine properties, so `Resolver.external` dropped the other genesis properties (for example `alsoKnownAs`, `controller`, `keyAgreement`) and hashed the smaller document. A first update with the `sourceHash` of the full document then failed with `INVALID_DID_UPDATE`. Breaking: the constructor adds no `#initialKey` relationship to a `k1` document. `DidDocument.fromKeyIdentifier` sets the four relationships of the KEY template, and `Resolver.deterministic` calls it.
  - api: the browser bundle holds the method fix. `resolve` and `getInitialDocument` keep every genesis property.

## 0.71.3

### Patch Changes

- A beacon signal checks each selected UTXO against its previous transaction (ADR 143).

  - method: `fetchBeaconFunding` checks that the previous transaction of each selected UTXO hashes to the txid, and that its output at the vout pays the listed value to the beacon script. A difference throws `BeaconError` `PREVOUT_MISMATCH` before the signature, and no transaction goes to the network. Before, the builders took the input values from the REST listing only. A legacy (P2PKH) sighash does not commit to the input values, so a low listing value made a P2PKH signal pay the difference as fee.
  - api: the browser bundle holds the method fix. `PREVOUT_MISMATCH` is not a funding error.

## 0.71.2

### Patch Changes

- The deactivation checks use strict equality (`deactivated === true`), and `DidDocument` keeps the `deactivated` property (ADR 142).

  - method: `DidDocument` keeps the `deactivated` property of the input. Before, the constructor lost it, so an `x1` genesis document with `"deactivated": true` resolved as not deactivated. Step 2 of Process Next Update stops only if `current_document.deactivated` is `true`. Before, a value such as `"no"` or `1` stopped resolution and hid the later updates. The metadata `deactivated` is `true` only if the document holds the boolean `true`, else `false`.
  - api: the update chokepoint and `deactivate` refuse a source document only if `deactivated === true`. The browser bundle holds the method fix.

## 0.71.1

### Patch Changes

- The resolver removes only the top-level proof before it hashes an update (ADR 141).

  - method: the Apply step and the Confirm Duplicate step of the resolver both hash the update without its top-level `proof`. Before, the Apply step removed each member named `proof` at each depth, also inside the patch. Thus a second Beacon Signal of an update whose patch holds a member named `proof` raised `LATE_PUBLISHING`. A nested member named `proof` now stays in the hash.
  - api: dependency uptake. The browser bundle holds the fix.

## 0.71.0

### Minor Changes

- The resolver checks the genesis id and compares with the DID under resolution (ADR 140).

  - method: `Resolver.external` refuses a genesis document whose `id` is not `did:btcr2:_` with `INVALID_DID_DOCUMENT`. Before, such a document resolved to a document for another DID. The proof checks (`capability`, `invocationTarget`), the patched-id check, and the CAS and SMT beacons use the DID under resolution, not `current_document.id`. Breaking: the data of the patched-id error is `{ did, id }`. Before, it was `{ sourceId, targetId }`.
  - api: dependency uptake. The browser bundle holds the fix. Breaking: `resolve` and `getInitialDocument` refuse the same genesis document.
  - cli: dependency uptake.

## 0.70.1

### Patch Changes

- `JSONPatch.apply` runs the patch on a JSON copy of the operations (ADR 139).

  - common: the operations stay unchanged. Before, a later operation that wrote inside an added value also changed the operation. The checks run on the copy. The strict mode does not refuse a nested `undefined` any more: the copy drops it, as the signed update does. The error message of a failed path check names the index of the failing operation. Before, it said "at operation 0".
  - method: an update whose patch writes inside an added value now resolves. Before, `Updater.construct` embedded a changed patch, and each resolver refused the update with `INVALID_DID_UPDATE`. The resolver hashes the update as received, so a duplicate of such an update is confirmed.
  - method, api, aggregation: dependency uptake. The browser bundle holds the fix.

- Updated dependencies []:
  - @did-btcr2/common@10.0.1

## 0.70.0

### Minor Changes

- The indexer signal discovery reads the full history of a beacon address (ADR 138).

  - method: `BeaconSignalDiscovery.indexer` reads each page of the confirmed history (`GET /address/:address/txs/chain`) with an overlap cursor. Before, it read only the newest 25 transactions, so 25 payments to a beacon address hid an older signal. If the history changes during discovery, the resolve fails with `INTERNAL_ERROR`: resolve again later. Breaking: the Esplora server must serve the chain listing in a stable order. A mempool instance needs `MEMPOOL_BACKEND=esplora`.
  - bitcoin: the new export `ESPLORA_CHAIN_PAGE_SIZE` (25). `EsploraProtocol.getAddressTxsChain` adds `?max_txs=25`.
  - api: dependency uptake. The browser bundle holds the new discovery. Breaking: the same Esplora server requirements.
  - cli: dependency uptake.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.5

## 0.69.0

### Minor Changes

- The proof of an update has `invocationTarget`, and `updated` is the block `mediantime` (spec PRs 379 and 380).

  - method: `Btcr2DataIntegrityProof` and `Btcr2DataIntegrityConfig` have the required field `invocationTarget`. `Updater.sign` sets it to the DID. The resolver raises `INVALID_DID_UPDATE` if `update.proof.invocationTarget` is not the DID. Breaking: an update with no `invocationTarget` does not resolve.
  - method: `didDocumentMetadata.updated` is the `mediantime` of the block of the last applied update, not the header time.
  - api: a new update has `invocationTarget`. A resolution fails with `INVALID_DID_UPDATE` for an update with no `invocationTarget`. Breaking: an update that an earlier version signed does not resolve.
  - cli: dependency uptake.

## 0.68.0

### Minor Changes

- The late-publishing error code is `LATE_PUBLISHING`, the code of the specification. `JSONPatch.apply` is strict by default (ADR 112). The deprecated options overload of `NotImplementedError` is gone (ADR 085).

  - common: the error code `LATE_PUBLISHING_ERROR` is now `LATE_PUBLISHING`, in name and in value. The `strict` option of `JSONPatch.apply` and `JSONPatch.validateOperations` defaults to `true`. Pass `{ strict: false }` for the lenient mode. `NotImplementedError` takes the type and the data positionally only. Breaking: all three changes.
  - method: the resolver raises `LATE_PUBLISHING` for a skipped version and for a duplicate that does not match the applied update. Breaking: the error type changes.
  - api: a resolution that finds late publishing fails with the error type `LATE_PUBLISHING`. Breaking: the error type changes.
  - keypair, cryptosuite, bitcoin, key-manager, aggregation, cli: dependency uptake.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@10.0.0
  - @did-btcr2/bitcoin@0.11.4
  - @did-btcr2/cryptosuite@10.0.1
  - @did-btcr2/keypair@0.13.2

## 0.67.0

### Minor Changes

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

## 0.66.3

### Patch Changes

- The default config works in a browser with no proxy and no custom executor (ADR 124).

  - bitcoin: a GET request carries no `Content-Type`, so a browser sends no CORS preflight. `POST /tx` sends `text/plain` and the `RestConfig` headers, and the protocol ignores a `Content-Type` entry in `RestConfig.headers`. `HttpRequest` gets the optional field `fresh`, which `EsploraProtocol` sets on each endpoint whose response can change. The new export `createFetchExecutor({ timeoutMs? })` sends a fresh request with `cache: 'no-store'` and a random `_` query parameter. `defaultHttpExecutor` is `createFetchExecutor()`.
  - api: `BitcoinApi` uses `createFetchExecutor` for the default executor and for the `timeoutMs` executor. `DEFAULT_CAS_GATEWAY` is `https://trustless-gateway.link`, because `ipfs.io` redirects a raw-block read there with no CORS header.
  - cli: the docs and the config file example name the new default CAS gateway.
  - method, aggregation: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.3

## 0.66.2

### Patch Changes

- The REST client returns the block height as a number.

  - bitcoin: `BitcoinBlock.count()` converts the `text/plain` body of the Esplora tip height to a number. Before, it returned the body as a string, for example `'601'`. A body that is not a non-negative integer raises `BitcoinRestError`.
  - method, aggregation, api, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.2

## 0.66.1

### Patch Changes

- The api exports the steps of a vector tool, and the SMT verifier rejects an empty sibling in `hashes` (ADR 122).

  - smt: the result of `verifyZeroHash`, `verifyProof`, and `verifySerializedProof` is `false` if a `0` bit of `collapsed` selects an entry of `hashes` that is equal to the cached zero of its level. This follows specification pull request 370. `serializeProof` writes the properties in the order of the SMT Proof data structure: `id`, `nonce`, `updateId`, `collapsed`, `hashes`. No root or hash changes.
  - method: `DidDocument.fromKeyIdentifier` sets the document `id` to the DID and the verification method id to `<did>#initialKey`. Before, the constructor threw `INVALID_DID_DOCUMENT` for each input.
  - api: the package root exports `canonicalHash`, `JSONPatch`, and `Appendix`.
  - aggregation, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/smt@0.4.1

## 0.66.0

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
  - @did-btcr2/smt@0.4.0
  - @did-btcr2/common@9.7.0

## 0.65.1

### Patch Changes

- The resolver keys the processed beacon signals by beacon address (ADR 118).

  - method: the processed set of BeaconProcess is keyed by beacon address, not by service id. A rotated beacon whose old address carried a signal now resolves past the rotation. `Identifier.encode` rejects a numeric-string network such as `'5'`, which the numeric enum read as a network name and minted as a mainnet identifier.
  - bitcoin: the REST client reads the status before it parses the body. A non-OK status raises `FAILED_HTTP_REQUEST` with the status, the URL, and the body. An OK status with a body that is not JSON raises `INVALID_HTTP_RESPONSE`.
  - aggregation, api, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.1

## 0.65.0

### Minor Changes

- The resolver ignores the signals of a beacon address that an applied update removed from the DID document (ADR 114, specification pull request 367).

  - method: each update tuple carries the beacon address of its signal. Step 4 of "Process Next Update" ignores a tuple whose address the current document does not carry: the tuple stamps no metadata, enters no history, and does not reach the duplicate check. An update announced at the address that it removes still applies. Breaking: a history that announces a later version at a removed beacon address resolves to the last version that a kept address announced, and a `versionId` that only an ignored update reaches fails with `NOT_FOUND`. A conflicting re-announcement at a removed address is ignored; before, it raised `LATE_PUBLISHING`.
  - api: dependency uptake.
  - cli: dependency uptake.

## 0.64.0

### Minor Changes

- The update paths check the proof fields and the proof time window, accept an embedded verification method, apply the JSON Patch strictly, and raise `INVALID_DID_UPDATE` (ADR 112).

  - common: `JSONPatch.apply` takes a `strict` option. With `strict: true`, an unknown `op`, a missing `value`, a `remove` or `replace` of a missing path, a `move` or `copy` from a missing path, and a failed `test` fail the patch at the first failing operation. The default does not change.
  - method: the resolver checks `type`, `cryptosuite`, `proofPurpose`, `capabilityAction`, and `capability` by string equality before it verifies the signature. Both paths locate the verification method through the `capabilityInvocation` entry, in the reference form or the embedded form. The resolver checks `created` and `expires` against the block of the Beacon Signal. Both paths apply the patch strictly and check the `id` and the DID Core conformance of the patched document. Every failure that the specification names is an `UpdateError` or a `ResolveError` of type `INVALID_DID_UPDATE`, with the inner error in `data.cause`. `Updater.sign` verifies the proof before the state machine asks for funding. `DidBtcr2.deactivate` and `DEACTIVATION_PATCH` are new. `capability` and `capabilityAction` are required in the proof types. `DidBtcr2.update` refuses a `sourceVersionId` that is not an integer of at least 1. Breaking: the write path raises `INVALID_DID_UPDATE` where it raised `INVALID_DID_DOCUMENT` for a method that is not authorized or not found.
  - api: `DidMethodApi.DEACTIVATION_PATCH` is the constant of the method package. The error type of an unauthorized or unknown verification method is `INVALID_DID_UPDATE`.
  - cli: documentation only.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@9.6.0

## 0.63.0

### Minor Changes

- The resolver processes one update per pass, as the specification loop describes, and re-scans the beacon addresses that an applied update adds before the next update (ADR 111). The constructor validates the resolution options: `versionId` and `versionTime` together, a `versionId` that is not an ASCII string of an integer, or a `versionTime` that is not an XML Datetime in UTC without a fraction raise a `ResolveError` of type `INVALID_OPTIONS`. The `versionId` test runs before Apply, so `"1"` returns the genesis document; a version that the history does not reach raises `NOT_FOUND`. The `versionTime` test compares the block `mediantime` with an inclusive boundary. `confirmations` and `updated` report the last applied update only.

  Breaking: `BlockMetadata.mediantime` is required; both discovery paths fill it (the indexer path reads the Esplora block record once per distinct block). `Resolver.updates()` is removed. A request with both options or with a value that does not parse fails with `INVALID_OPTIONS`; before, it was silent. A `versionId` past the history fails with `NOT_FOUND`; before, it returned the latest document.

## 0.62.0

### Minor Changes

- Resolution reports the required DID document metadata (`confirmations`, `deactivated`; `contentType: application/did`) and the DID Resolution error codes (`INVALID_DID`, `NOT_FOUND`, `MISSING_UPDATE_DATA`, `INTERNAL_ERROR`); `CasApi.retrieve` checks the content hash (ADR 110).

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@9.5.0

## 0.61.0

### Minor Changes

- `Updater.construct` writes the `@context` array that the specification pins for a BTCR2 Update: `https://w3id.org/json-ld-patch/v1`, `https://w3id.org/zcap/v1`, `https://w3id.org/security/data-integrity/v2`, `https://btcr2.dev/context/v1`, in this order (ADR 109). The proof of a signed update carries the same array. New exports: `BTCR2_UPDATE_CONTEXT` (the frozen array) and `isBtcr2UpdateContext(value, expected?)` (the equality rule of the specification: the same URLs, in the same order, with no other member). The resolver rejects an update whose `@context` is a different array, or whose proof `@context` differs from the update `@context`, with a `ResolveError` of type `INVALID_DID_UPDATE`, before signature verification.

  Breaking: every update signed with method 0.60.0 or earlier carries `https://w3id.org/security/v2` in a different order and fails on this version with `INVALID_DID_UPDATE`. The array is inside the signed bytes, so no party can re-label an announced update.

## 0.60.0

### Minor Changes

- `Identifier.decode` refuses a method-specific id that is not lowercase, as the specification requires, and refuses a reserved (6 to 11) or custom (12 to 15) network value, because this implementation supports no custom network (ADR 107). New `Identifier.validate(did, options?)` returns a report `{ did, valid, idType?, network?, checks }` and does not throw on an invalid identifier. The checks run in order (`prefix`, `lowercase`, `bech32m`, `version`, `network`, `genesisBytes`, `roundTrip`, `genesisBytesMatch`, `genesisDocument`) and stop at the first failure. The `genesisBytesMatch` check runs only with supplied genesis bytes and confirms that the identifier encodes them. The `genesisDocument` check runs only with a supplied document and confirms the placeholder id, the Genesis Document rules, and the canonical hash against the genesis bytes. New types: `IdentifierCheckName`, `IdentifierCheck`, `IdentifierValidateOptions`, `IdentifierReport`.

  Breaking: an uppercase or mixed-case identifier, and an identifier with a network value from 12 to 15, decoded before and now fail with `INVALID_DID`. `DidComponents.network` is always a network name.

## 0.59.0

### Minor Changes

- Resolution processes a beacon signal only if its transaction has at least `minConf` confirmations, as the specification mandates (ADR 105).

  - `ResolutionOptions.minConf`: a positive integer, default `6` (`DEFAULT_MIN_CONF`, a new named export). A signal below the threshold is excluded at signal intake; the rest are processed. An invalid value fails with a `ResolveError` of type `INVALID_OPTIONS` before any data need.
  - `BeaconSignalDiscovery.indexer` skips a mempool transaction (`status.confirmed !== true`) before the OP_RETURN parse. An absent flag counts as unconfirmed.
  - An eligible signal with no valid block height or block time fails fast with a `ResolveError` of type `INVALID_DID_UPDATE`. The `Invalid date` failure on a mempool signal is gone.

  Breaking: a default resolve no longer applies a signal with fewer than six confirmations. Pass `{ minConf: 1 }` to keep the previous behaviour for a fresh update.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.0
  - @did-btcr2/common@9.4.0

## 0.58.0

### Minor Changes

- Apply the relative DID URL rule to the write path and to proof references (ADR 092).

  [ADR 091](https://github.com/dcdpr/did-btcr2-js/blob/main/docs/adr/091-inject-did-into-beacons-and-relative-did-urls.md)
  decided that both spellings of a DID URL resolve to the absolute form before being compared, and
  applied it to the read path. Four sites were left comparing raw strings, so a document written in
  the relative spelling resolved but could not be updated.

  - `DidBtcr2.update` compared `capabilityInvocation` membership and the `beaconId` service lookup
    as raw strings, one line before delegating to `getSigningMethod`, which resolves both sides.
    A caller holding a relative-spelling document could not name its own key or its own beacon in
    any spelling the factory accepted. Both comparisons now resolve each side against the document.
  - `Updater.sign` put the document's spelling of the method id into the proof's
    `verificationMethod`. For a relative document that is a bare `#initialKey`, which resolves
    against nothing once the proof leaves the document, and the cryptosuite refused to serialize
    it, so such a document could not be signed for at all. The proof now names the method by
    absolute DID URL. A document that already spells its ids absolutely produces a byte-identical
    proof, so no existing test vector changes.
  - `getAggregationCommunicationKey` dereferenced `capabilityInvocation[0]` against
    `verificationMethod[].id` by raw comparison, so an EXTERNAL sender whose genesis document mixes
    spellings derived no communication key and could not be authenticated on either transport.
  - `getSigningMethod` compared its resolved target without first rejecting an unusable one, so a
    lookup with an empty method id returned the document's first malformed verification method.
    Every comparison now rejects an unusable target before comparing.

  Adds `Appendix.relationshipMethodId(entry, did)`, which resolves a verification relationship
  entry (a reference, or a method embedded inline that names itself with its own `id`) to an
  absolute DID URL. The read path's membership check, the write path's membership check, and the
  `assertionMethod` fallback in the method lookup now share it, so all three admit exactly the same
  spellings.

  Comparison remains on the resolved absolute URL rather than the bare fragment, so a reference
  naming a different DID still cannot match. A verification method whose `controller` is some DID
  other than the document subject still fails, and still fails at signing time rather than at
  resolution.

## 0.57.0

### Minor Changes

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

## 0.56.0

### Minor Changes

- Require `capabilityInvocation` authorization on the read path, and recognize beacon signals from the spending transaction's script (ADRs 086, 088).

  - **BREAKING:** resolution rejects an update whose `proof.verificationMethod` is not listed in the contemporary document's `capabilityInvocation`, with a typed `INVALID_DID_UPDATE`, per the spec's "Check update.proof" step. Locating the method in `verificationMethod[]` and verifying its signature was not sufficient on its own: a key published only for authentication, or under no relationship at all, could authorize an update on the read path, where the write path has always refused. Bare-fragment entries and embedded verification methods are normalized against the document id before comparison, so a reference naming another DID cannot collapse onto this one. **A DID whose history was signed by a key outside `capabilityInvocation` no longer resolves**, including an EXTERNAL genesis document that omits the relationship entirely.
  - **BREAKING:** `extractOpReturnSignal(asm)` is now `extractOpReturnSignalHash(scriptPubKey)` and takes the serialized script rather than a rendered `asm` string. `asm` is a per-backend rendering (Bitcoin Core prints `OP_RETURN <hash>`, Esplora prints `OP_RETURN OP_PUSHBYTES_32 <hash>`), so an asm-shaped check written against one backend silently discards every signal from the other. The serialized script is identical on both and is what is committed to the chain. The accepted set of signals is unchanged.
  - **BREAKING:** `BeaconUtils.getBeaconServicesMap` is removed. Its only caller needs the caller's own service objects, which the map replaced with re-parsed copies, breaking the identity-keyed result map it feeds. Build the map inline with `BeaconUtils.parseBitcoinAddress`.
  - Indexer discovery requires a candidate transaction to spend an output of the beacon address before its OP_RETURN is read as a signal. An address transaction listing returns inbound payments too, so anyone able to pay dust to a beacon address could attach a 32-byte OP_RETURN and have it resolved as that beacon's signal, which permanently fails resolution for a hash no one can fulfil. The spent output is read from the embedded `vin[].prevout`, and from the funding transaction when a backend omits it, so a missing field cannot drop a real signal.
  - Full-node discovery reads the signal from the last output of the spending transaction rather than from the output being spent, which carries a plain locking script and never a signal: the path previously discovered nothing at all, and every resolver driven by it returned a stale document with no error. One transaction now yields one signal per beacon however many of that beacon's UTXOs it spends.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.10.0
  - @did-btcr2/common@9.3.0
  - @did-btcr2/cryptosuite@10.0.0

## 0.55.0

### Minor Changes

- `Appendix.getVerificationMethods` throws a typed `DidDocumentError` from `@did-btcr2/common` instead of a bare `TypeError` when called without a `didDocument` (ADR 085). Message unchanged.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@9.2.0

## 0.54.1

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.9.0

## 0.54.0

### Minor Changes

- Beacon broadcasts return structured artifacts, and CAS publication precedes the on-chain spend (ADR 070).

  - `broadcastSignal` on all three beacons (Singleton, CAS, SMT) now returns a `BroadcastResult` (`{ signedUpdate, txid, announcement?, proof? }`) instead of echoing the `SignedBTCR2Update`. Callers that used the return value directly should read `result.signedUpdate`.
  - SMT beacon broadcasts return the Merkle inclusion proof (leaf nonce embedded). Previously the proof and nonce were discarded, which made every single-party SMT signal permanently unresolvable; capture `result.proof` for sidecar distribution.
  - CAS beacon broadcasts return the CAS Announcement, so sidecar-only controllers can capture the object a resolver needs.
  - **Semantic change:** the CAS beacon now invokes `casPublish` **before** broadcasting the signal transaction. A publish failure aborts the operation while the beacon UTXO is still unspent; retries are idempotent (content-addressed re-publish).
  - `Updater.announce` accepts an options parameter (fee estimator, change address, `casPublish`) and returns the `BroadcastResult`.

## 0.53.0

### Minor Changes

- Fix versionTime queries against duplicate-containing histories and guard duplicate confirmation (ADR 068)

  Updates sort by targetVersionId before block height, so a duplicate re-announcement of an
  early version mined after the queried versionTime used to trip the versionTime early-return
  before genuine in-window updates were processed, silently resolving to an earlier version
  than the one valid at the query point. Duplicates are now confirmed before the versionTime
  check, so a re-announcement (or third-party replay) mined after versionTime can no longer
  truncate the in-window history, and a false duplicate of an in-window version now fails
  resolution with `LATE_PUBLISHING_ERROR` instead of being masked by the early return. Separately, the duplicate-confirmation history read is now guarded: a crafted
  `targetVersionId` that is not an integer of at least 2 raises a typed `INVALID_DID_UPDATE`
  (and is rejected at the `provide()` boundary), and an unconfirmable duplicate whose history
  slot does not exist raises `LATE_PUBLISHING_ERROR`, where both previously crashed with a raw
  `TypeError`. The versionTime reorder is a deliberate, traced deviation from the current spec
  step order, pursued upstream as an erratum alongside ADR 067's; see ADR 068.

## 0.52.0

### Minor Changes

- Fix resolver duplicate-update confirmation so a re-announced update no longer bricks resolution (ADR 067)

  A confirmed duplicate update (the same version announced more than once on chain, for
  example on two of a k1 DID's own beacons or replayed by a third party at another derivable
  beacon address) no longer advances the version counter. `Resolver.updates()` now increments
  `current_version_id`, and the `versionId` it reports, only on the apply path, and confirms a
  duplicate against the update-hash history without appending to it. This removes a `versionId`
  inflation that mis-classified the next genuine update and raised a false `LATE_PUBLISHING_ERROR`,
  bricking an otherwise-valid linear history in a single discovery round and across rounds. The
  duplicate-confirmation guard still rejects an update that claims an already-used version but
  carries different content. This is a deliberate, traced deviation from the current spec prose on
  when the counter increments, pursued upstream as a spec erratum; see ADR 067.

## 0.51.0

### Minor Changes

- Authenticate EXTERNAL (x1) did:btcr2 identifiers on the aggregation HTTP transport (ADR 066)

  EXTERNAL (x1) DIDs can now join aggregation cohorts as first-class members over the HTTP
  transport, the way KEY (k1) DIDs already do. An x1 DID commits to the hash of its genesis
  document, so the controller carries that self-verifying genesis in-band on the cohort opt-in;
  the service recomputes the hash, derives the communication key from `capabilityInvocation[0]`
  (no `verificationMethod[0]` fallback), cross-checks it against the advertised
  `communicationPk`, verifies the envelope signature, and only then registers the peer. There
  is no trust-on-first-use.

  - `@did-btcr2/method`: `resolveBtcr2SenderPk(did, { genesisDocument })` is now genesis-aware
    (the one-argument form is unchanged: k1 to key, x1 to undefined), and a new exported
    `getAggregationCommunicationKey(document)` derives the aggregation communication key from
    `capabilityInvocation[0]`.
  - `@did-btcr2/aggregation`: the cohort opt-in body carries an optional `genesisDocument`; the
    HTTP server bootstraps an unregistered x1 sender from it, binds the inner `message.from` to
    the authenticated `envelope.from`, registers a bootstrapped peer only after the request
    clears every gate, and accepts a new `maxBodyBytes` transport option (413 on oversize). The
    package remains method-agnostic.

  Backward compatible: existing k1 opt-ins, one-argument resolver callers, and older
  participants are unaffected.
