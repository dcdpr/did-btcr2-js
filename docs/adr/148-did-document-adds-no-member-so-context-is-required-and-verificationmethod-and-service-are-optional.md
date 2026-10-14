# ADR 148: DidDocument Adds No Member, so `@context` Is Required and `verificationMethod` and `service` Are Optional

- **Status:** Accepted
- **Date:** 2026-10-13
- **Packages:** `@did-btcr2/method` (MINOR: the `DidDocument` constructor sets no default member, so a DID document or a genesis document without `@context` fails. In `Btcr2DidDocument`, `ExternalData`, and the `DidDocument` class, `@context` is required, and `verificationMethod` and `service` are optional. The genesis checks read `@context` and the shape of each method and service, and they no longer require the controller `did:btcr2:_`. `DidDocumentBuilder` no longer writes `verificationMethod: []`. `resolveBtcr2SenderPk` gives another result for three kinds of `x1` genesis document); `@did-btcr2/api` (MINOR: the browser bundle holds the method package. The re-exported `Btcr2DidDocument` type changes. `btcr2.getInitialDocument`, `btcr2.resolve`, `resolveDid`, and `tryResolveDid` refuse an `x1` genesis document without `@context`); `@did-btcr2/cli` (PATCH: dependency uptake)

## Context

### The specification requires `@context` and `id`, and the other members are optional

The specification (Data Structures, DID Document) says: "A DID document is a map data structure defined by the DID core v1.1 specification." The section then gives two lists:

- "The following properties MUST be included:" `@context` ("A context array containing the following context URLs:" `"https://www.w3.org/ns/did/v1.1"` and `"https://btcr2.dev/context/v1"`) and `id` ("The `did`.").
- "It can optionally include one or more of the following properties:" `verificationMethod`, `assertionMethod`, `capabilityInvocation`, and `service`.

The section also gives the condition for an updatable document: "In order for this DID document to be updatable, controllers must include at least one verification method with a capability invocation verification relationship and at least one BTCR2 Beacon service."

The specification (Data Structures, Genesis Document) says: "A Genesis Document is a DID document (data structure) with the identifier set to the placeholder value (`did:btcr2:_`)."

The specification (Update) says: "Any property in the DID document may be updated except the `id`. Doing so would invalidate the DID document."

DID Core v1.1 also makes `verificationMethod` and `service` optional. If a document has one of these properties, the value must be a set.

### The specification serializes the genesis document with JCS

Specification pull request 387 ("Replace the Genesis Document placeholder in the JCS text") merged on 2026-10-09. It changes "If `genesis_bytes` is a SHA-256 Hash" of "Resolve". [ADR 144](144-did-document-keeps-every-property-and-only-the-key-template-sets-the-initialkey-relationships.md) quotes the old text. The new text says: "Serialize the Genesis Document, from `sidecar.genesisDocument` or from CAS, with JCS, and replace every occurrence of `did:btcr2:_` in the result with `did`. Parse the result as JSON to form `current_document`. The resulting DID Document (data structure) MUST be conformant to DID Core v1.1."

`Resolver.external` serializes the genesis document with `JSON.stringify`, replaces each placeholder with `replaceAll`, and parses the result.

### The constructor wrote three defaults

Before this change, the `DidDocument` constructor wrote a default for three absent members. It wrote `[]` for `verificationMethod` and `service`, and the two btcr2 contexts for `@context`. The validation ran after the defaults. This gave three problems:

1. A genesis document without `@context` resolved. The resolved document had a member that the genesis document did not have. Thus the hash of the resolved document was not the hash of `current_document`. The specification requires `@context`, so the genesis document does not give a conformant DID document.
2. For a DID document, the constructor checked `verificationMethod` and `service` before it wrote the defaults. An absent member failed with `Invalid verificationMethod: undefined` or `Invalid service: undefined`. Thus the resolver refused a genesis document without `service` or without `verificationMethod`. For a genesis document, the constructor did not run these checks, and it wrote `[]`. Thus `GenesisDocument.fromJSON` and `Identifier.validate` accepted the genesis document that the resolver refused. They also changed a `null` member to `[]`.
3. `Updater.construct` and the resolver check a patched document with `DidDocument.isValid`, which writes no default. Thus both refused an update that removed `/service`. The specification lets an update change this property.

### The genesis checks had a controller rule

`validateGenesis` required the controller `did:btcr2:_` for each verification method. The specification has no such rule. The rule had no ADR. Only the method that signs an update must have the DID as its controller ([ADR 147](147-only-the-method-that-signs-an-update-must-be-a-bip340-multikey-and-both-update-paths-check-that-method.md)).

The resolver does not run the genesis checks. Thus `Identifier.validate` and the api `createExternalFromDocument` refused a genesis document that the resolver accepted. An example is a document with an `authentication` key of an organization.

`validateGenesis` also did not read `@context`, and it did not check the shape of each method and service. A method or a service without `type` passed. A service whose `id` was not a string or an array gave a plain `TypeError`. A service whose `id` was an array that contains the placeholder passed.

### Examples

| Input | Before | After |
|---|---|---|
| An `x1` genesis document without `@context`, in the resolver or in the api `btcr2.getInitialDocument` | Resolves. The resolved document has the two btcr2 contexts, so its hash is not the hash of `current_document`. | `DidDocumentError` `INVALID_DID_DOCUMENT`: `Invalid "@context"` |
| The same genesis document in `GenesisDocument.fromJSON` or `Identifier.validate` | Valid | `Invalid GenesisDocument "@context"`. The detail of the `genesisDocument` check is `Invalid genesis document: Invalid GenesisDocument "@context"`. |
| The same genesis document in the api `createExternalFromDocument` | `The genesis document "@context" must include "https://www.w3.org/ns/did/v1.1" and "https://btcr2.dev/context/v1".` | No change |
| An `x1` genesis document without `service` | The resolver and the api `createExternalFromDocument`: `Invalid service: undefined`. `GenesisDocument.fromJSON` and `Identifier.validate`: valid, and the document gets `service: []`. | Valid on each path. The resolver asks for no beacon signals, and the resolved document has no `service`. |
| An `x1` genesis document without `verificationMethod`, whose relationships embed the method | The resolver and the api `createExternalFromDocument`: `Invalid verificationMethod: undefined` | Valid on each path. The resolved document has no `verificationMethod`. |
| An update with the patch `[{ "op": "remove", "path": "/service" }]` | `Updater.construct`: `Error validating targetDocument: Invalid "service"`. The resolver: `INVALID_DID_UPDATE`, `Invalid update: the patched document does not conform to DID Core: Invalid "service"` | `Updater.construct` accepts the patch. The resolver applies the update, and the document has no `service`. |
| A genesis document with a second method, for `authentication` only, whose controller is `did:example:org` | `Identifier.validate` and the api `createExternalFromDocument`: `Invalid GenesisDocument verificationMethod`. The resolver accepts the document. | Valid on each path |
| A genesis service whose `id` is `42`, in `GenesisDocument.fromJSON` or the api `createExternalFromDocument` | A plain `TypeError` | `DidDocumentError` `INVALID_DID_DOCUMENT`: `Invalid GenesisDocument service`. The resolver still accepts the document (decision 5). |
| A genesis document with `service: null` | `GenesisDocument.fromJSON` and `Identifier.validate`: valid, and the member becomes `[]` | `Invalid GenesisDocument service` |
| `resolveBtcr2SenderPk` for an `x1` sender whose genesis document has no `@context` | The key of `capabilityInvocation[0]` | `undefined` |
| `resolveBtcr2SenderPk` for an `x1` sender whose genesis document has no `service` | `undefined` | The key of `capabilityInvocation[0]` |
| `resolveBtcr2SenderPk` for an `x1` sender whose genesis document has no `verificationMethod`, and `capabilityInvocation` embeds the method | `undefined` | The key of `capabilityInvocation[0]` |

## Decision

### 1. The constructor sets no default member

The constructor copies each own property of the input (ADR 144) and writes no other member. An absent `@context`, `verificationMethod`, or `service` stays absent. The validation then checks the members of the input. `DidDocument.fromExternalIdentifier` and `Resolver.external` add no member.

`isValidVerificationMethods` and `isValidServices` accept an absent member (`undefined`). They refuse `null` and each other value that is not an array of valid items.

Reason: the specification requires `@context` and makes `verificationMethod` and `service` optional. A default changes the document, so the hash of the resolved document was not the hash of `current_document`. The default also hid an absent `@context` from the `@context` check of [ADR 057](057-did-document-validation-standards.md). A `null` member is not an absent member: DID Core v1.1 requires a set if the property is present.

### 2. The types follow the specification

In `Btcr2DidDocument`, `ExternalData`, and the `DidDocument` class, `@context` is required, and `verificationMethod` and `service` are optional. The class field `@context` has no initial value. The class fields still set the key order of ADR 144.

Reason: the types then agree with the checks at run time. For `fromExternalIdentifier`, the compiler refuses data without `@context`, and the constructor refuses it at run time. A TypeScript caller must check `verificationMethod` and `service` before use, for example with `document.service ?? []`.

### 3. Each helper that makes a document writes the two contexts

`DidDocument.fromKeyIdentifier` and `GenesisDocument.create` write the two btcr2 contexts. `GenesisDocument.fromPublicKey` calls `GenesisDocument.create`. `DidDocumentBuilder` writes the two contexts only if the initial document has no `@context`, and it no longer writes `verificationMethod: []`. Each helper writes a copy of `BTCR2_DID_DOCUMENT_CONTEXT`.

Reason: these helpers make a new document from parts, so they must write the required member. The copy keeps the exported constant safe. If a caller adds a context to the document, the constant does not change. The generated documents and their hashes do not change.

### 4. The genesis checks apply the rules of a DID document

`validateGenesis` runs these checks in this order. The first check that fails throws a `DidDocumentError` of type `INVALID_DID_DOCUMENT`:

1. The `id` is `did:btcr2:_`. The message is `Invalid GenesisDocument ID`.
2. `@context` is an array that contains the two btcr2 contexts. The message is `Invalid GenesisDocument "@context"`.
3. `verificationMethod` is absent, or an array of methods with a string `id`, `type`, and `controller`. Each method `id` contains the placeholder. The message is `Invalid GenesisDocument verificationMethod`.
4. `service` is absent, or an array of valid services. Each service `id` is a string that contains the placeholder. The message is `Invalid GenesisDocument service`.
5. The verification relationships have a valid shape.

Steps 3 and 4 use the shape checks of `DidDocument.isValid`. `validateGenesis` no longer compares the controller with `did:btcr2:_`. A method needs a string `controller`, and the value can be another DID.

Reason: the specification defines a genesis document only by its placeholder id, so a genesis document has the rules of a DID document. Only the method that signs an update must have the DID as its controller, and the update paths check that method (ADR 147). The lock-out guard of ADR 147 still refuses a genesis document if no `capabilityInvocation` method can sign. The resolver uses the same shape checks for these members. Only the genesis checks also require a string service `id` (decision 5) and the placeholder in each `id` (ADR 108).

### 5. A genesis service `id` must be a string

Step 4 checks the type of each service `id` before the placeholder check.

Reason: the service shape check (`isDidService`) checks only that an `id` exists. Before, an `id` that was not a string or an array gave a plain `TypeError`. An array `id` `["did:btcr2:_"]` passed, because `Array.prototype.includes` found the placeholder. This change is minimal. The resolver still accepts a service whose `id` is not a string. A later change of the DID Core checks can apply the string rule on each path.

### 6. A document without `service` has no beacon

`BeaconUtils.getBeaconServices` returns `[]` if `service` is absent or is not an array. The resolver then asks for no beacon signals. For such a source document, `DidBtcr2.update` finds no beacon service. It raises an `UpdateError` of type `INVALID_DID_UPDATE` with the message `No beacon service found for provided beaconId`. Before, both functions threw a plain `TypeError` for a document without `service`.

Reason: the specification makes `service` optional. "Find Beacon Signals" scans the `service` entries of `current_document`, and a document without `service` has no entry to scan.

### 7. The resolver keeps `JSON.stringify` for the placeholder step

`Resolver.external` still serializes the genesis document with `JSON.stringify`, replaces each `did:btcr2:_` with `replaceAll`, and parses the result. A comment names the step of the specification.

Reason: JCS writes each string and each number as `JSON.stringify` writes it. Only the member order is different. Outside a string, JSON text holds only structural characters, numbers, `true`, `false`, and `null`, and none of these can contain the placeholder. The placeholder contains no character that JSON escapes. Thus each occurrence is in one string, a member name or a value, and the two serializations give the same occurrences. The parsed value is the same, and so is its JCS hash.

Tests show this result for these inputs:

- A placeholder in a member name.
- A placeholder in each place of a nested string.
- A genesis document with its members in the reverse order.
- A genesis file whose JSON text contains the placeholder with an escape (`did:btcr2:\u005f`). The JSON parser changes the escape to `_` before the resolver gets the document.

### 8. The constructor keeps its three shape checks before the validation

For an id that is not the placeholder, the constructor still checks `id`, `verificationMethod`, and `service` before it copies the input. `DidDocument.validate` then checks `@context` first. Thus the first error depends on the path. An example is a document without `@context` and with `service: null`:

| Path | Error |
|---|---|
| `new DidDocument`, with a DID as the `id` | `Invalid service: null` |
| `DidDocument.isValid`, with a DID as the `id` | `Invalid "@context"` |
| `GenesisDocument.fromJSON`, with the placeholder as the `id` | `Invalid GenesisDocument "@context"` |

Reason: a new order changes the error messages of the constructor. A later change for DID Core conformance replaces these checks, and that change sets one order.

### 9. The api does not refuse a document without a beacon service, and its JSDoc gives the condition

After this change, a patch can remove `/service`, and a genesis document can have no `service`. A document without a beacon service has no address for an announcement. Nobody can then update or deactivate the DID. This state was already possible before this change. Three examples are a patch that replaces `/service` with `[]`, a patch that removes the last beacon service, and a genesis document with `service: []`.

The review of this change recommended a guard in the api. The proposed guard refuses a create or an update after which the document has no beacon service and is not deactivated. The reason was the api guard criterion of [ADR 135](135-an-update-is-refused-if-the-source-resolution-misses-an-update-of-the-sidecar-data.md): the removal of the last beacon is permanent, and the api holds the target document.

The maintainer chose documentation only. The maintainer gave this reason: "the spec does not disallow this. in fact, the spec allows one to update everything in the doc EXCEPT the id field". The specification (Update) says: "Any property in the DID document may be updated except the `id`."

The JSDoc of the api functions gives the condition:

- `createExternalFromDocument`: "A document without a beacon service also passes, but nobody can announce an update for its DID."
- `signUpdate` and `update`: "A target document without a beacon service also passes, but nobody can announce a later update for the DID."

The api README and the cli documentation of `genesis`, `create`, and `update` give the same information. The lock-out guard of ADR 147 does not change.

### 10. The test vectors do not change

`packages/api/lib/data` has 241 genesis documents. Each one has `@context`, `verificationMethod`, and `service`, and the controller of each method is `did:btcr2:_`. The documents of `GenesisDocument.fromPublicKey`, `buildGenesisDocument`, and `Resolver.deterministic` have the same hash as before. Thus each vector gives the same result, and this change regenerates no vector.

## Alternatives

- **Keep the defaults.** Rejected. The resolver then accepts a genesis document without `@context`, and the resolved document is not the `current_document` of the specification. The resolver also refuses a genesis document without `service`, which the specification allows.
- **Refuse a genesis document without `service`.** Rejected. The specification makes `service` optional, so a resolver must resolve such a document. The create path and the read path then disagree.
- **Refuse in the api a create or an update that leaves no beacon service.** Rejected by the maintainer (decision 9). The specification allows the state.
- **Keep the controller rule of the genesis checks.** Rejected. The specification has no such rule, and the resolver accepts such a document. Only the method that signs needs the DID as its controller (ADR 147).
- **Call JCS in place of `JSON.stringify` in the resolver.** Rejected. The parsed value and its hash are the same (decision 7). The JCS call adds a sort of each object and gives no other result.
- **Check `@context` first in the constructor now.** Rejected for this change. The change gives new error messages for the constructor. The later change for DID Core conformance sets one order.
- **Freeze `BTCR2_DID_DOCUMENT_CONTEXT` and share it.** Rejected for this change. The exported type then becomes `readonly`. A caller that adds a context to a document then gets a `TypeError`.

## Consequences

- The method and api packages get a MINOR release. The api re-exports `Btcr2DidDocument`, and its browser bundle holds the method package. [ADR 140](140-the-resolver-checks-the-genesis-id-and-compares-with-the-did-under-resolution.md) used MINOR for the same reason. The cli gets a PATCH release for the dependency uptake.
- The `@did-btcr2/aggregation` package gets no release. Only its tests and two `lib` scripts change, and the package publishes only `dist` and `src`. Its source code does not import the method package.
- A genesis document without `@context` no longer resolves. The api `btcr2.getInitialDocument`, `btcr2.resolve`, `resolveDid`, and `tryResolveDid` refuse it. The cli `identifier decode --initial-document --genesis-document` and `Identifier.validate` also refuse it. `createExternalFromDocument` already refused it with its own check ([ADR 108](108-genesis-document-builder-and-cli-genesis-build.md)), and that message does not change.
- A genesis document without `service` now resolves, and the api creates its DID. The same is true for a genesis document without `verificationMethod` whose relationships embed the methods. The resolved document has no such member. The create path, the read path, and `Identifier.validate` now agree.
- A genesis document with `null` for `verificationMethod` or `service` now fails the genesis checks. Before, the constructor changed the member to `[]`, and the genesis checks passed. A DID document with a `null` member already failed.
- A patch that removes `/service` now passes `Updater.construct`, and the resolver applies the update. The resolver then ignores a later signal at a removed beacon address ([ADR 114](114-resolver-ignores-the-signals-of-a-removed-beacon-address.md)). A patch can also remove `/verificationMethod` if the verification relationships embed the methods. A patch that removes `/@context` still fails.
- A genesis document with a method whose controller is another DID now passes the genesis checks. If the only `capabilityInvocation` method has another controller, the api still refuses the document. The message is now the lock-out message of ADR 147. Before, the message was `Invalid GenesisDocument verificationMethod`.
- `resolveBtcr2SenderPk` uses `Resolver.external` ([ADR 066](066-x1-transport-authentication.md)). For an `x1` sender whose genesis document has no `@context`, it now returns `undefined`, and the Nostr transport and the HTTP transport drop the opt-in. For an `x1` sender whose genesis document has no `service`, it now returns the key of `capabilityInvocation[0]`. The same is true if the genesis document has no `verificationMethod` and `capabilityInvocation` embeds the method.
- A TypeScript caller must check `verificationMethod` and `service` before use. A source document that a caller builds must have `@context`.
- The genesis checks still require the placeholder in each method `id` and each service `id` (ADR 108). The specification has no such rule. The resolver accepts a service `id` without the placeholder, for example an `https` URL. A later change can examine this rule.
- The specification gives the two conditions of an updatable document in one sentence. The api refuses a document that fails the `capabilityInvocation` condition (ADR 147). The api does not refuse a document that fails the beacon condition. The JSDoc of the api gives this condition (decision 9). This ADR does not apply the reason of decision 9 to the ADR 147 guard, and that guard does not change. A draft specification issue asks if a DID document can have no beacon service.
- For one input, the first error can depend on the path (decision 8).

**Superseded.**

- ADR 144, decision 1 "The constructor keeps every property": the sentence "Then it sets the defaults of `verificationMethod`, `service`, and `@context` as before." The constructor now sets no default, and an absent member stays absent (decision 1).
- ADR 144, decision 1: the sentence "Thus the JSON of a document with no other properties does not change." The class fields still set the key order. A document without `verificationMethod` or without `service` now gives JSON without that key.
- ADR 144, "Consequences": the bullet "The defaults of `@context`, `verificationMethod`, and `service` do not change."

**Unchanged.**

- ADR 144: the copy of each own property, `toJSON` as `{ ...this }`, the key order of the class fields, and the KEY template of `fromKeyIdentifier`. The alternative "Return the parsed object from `Resolver.external`, with no class" says: "Those defaults are separate gaps with their own decisions." This ADR is that decision.
- ADR 057, decision 1: the `@context` check. The array must contain the two btcr2 contexts, and it can contain other contexts. The check now sees the `@context` of the input.
- ADR 108: the checks of `createExternalFromDocument` (the placeholder `id`, the two contexts, and the placeholder in each method `id` and service `id`). `buildGenesisDocument` still refuses a spec with no `capabilityInvocation` method or no beacon.
- ADR 114: the resolver ignores a signal at an address that the current document does not have.
- ADR 135: the api guard criterion. The criterion gives the conditions for a refusal by the api. It does not require a refusal.
- ADR 140: the resolver raises `INVALID_DID_DOCUMENT` if the result of the placeholder step does not conform. A genesis document without `@context` gives such a result.
- ADR 147: only the method that signs an update must be a BIP340 Multikey with the DID as its controller. The api lock-out guard does not change.

## Implementation

- `packages/method/src/utils/did-document.ts`: the constructor, the class fields, `Btcr2DidDocument`, `ExternalData`, `isValidVerificationMethods`, `isValidServices`, `validateGenesis`, `fromKeyIdentifier`, `fromExternalIdentifier`, `GenesisDocument.create`, `GenesisDocument.fromJSON`, and the JSDoc.
- `packages/method/src/utils/did-document-builder.ts`: the two contexts, and no `verificationMethod: []`.
- `packages/method/src/core/beacon/utils.ts`: `getBeaconServices`.
- `packages/method/src/did-btcr2.ts`: the beacon lookup of `DidBtcr2.update`.
- `packages/method/src/core/resolver.ts`: the comment of the placeholder step and the JSDoc of `Resolver.external`.
- `packages/method/src/core/did-sender-resolver.ts`: the JSDoc of `resolveBtcr2SenderPk`.
- `packages/api/src/genesis.ts`: the comment of `assertGenesisDocument`. `packages/api/src/method.ts`: the JSDoc of `getInitialDocument`, `createExternalFromDocument`, `signUpdate`, and `update`.
- Tests: `packages/method/tests/did-document.spec.ts`, `resolve-external.spec.ts`, `resolver.spec.ts`, `updater.spec.ts`, `beacon.spec.ts`, `validate-identifier.spec.ts`, and `did-sender-resolver.spec.ts`. `packages/api/tests/genesis.spec.ts` and `did-method-api.spec.ts`. `packages/cli/tests/identifier-commands.spec.ts`.
- Type changes (`!`) only: `packages/method/tests/relative-did-url.spec.ts` and `signing-method.spec.ts`. `packages/api/tests/did-method-api-cas-policy.spec.ts`, `did-method-api-message.spec.ts`, and `did-method-api-offline-steps.spec.ts`. `packages/cli/tests/message-commands.spec.ts`. `packages/aggregation/tests/aggregation-submit-proof-id.spec.ts`, and the aggregation scripts `lib/operations/aggregation/e2e-http-transport.ts` and `e2e-nostr-transport.ts`.
- `packages/method/README.md`, `packages/method/docs/aggregation.md`, `packages/api/README.md`, and `packages/cli/docs/create.md`, `genesis.md`, `identifier.md`, `resolve.md`, and `update.md`: the optional members, the `@context` failure, the result of `resolveBtcr2SenderPk`, and the document without a beacon service.

## References

- [did:btcr2 specification, Data Structures](https://dcdpr.github.io/did-btcr2/data-structures.html): [DID Document](https://dcdpr.github.io/did-btcr2/data-structures.html#did-document) and [Genesis Document](https://dcdpr.github.io/did-btcr2/data-structures.html#genesis-document).
- [did:btcr2 specification, Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html): [If `genesis_bytes` is a SHA-256 Hash](https://dcdpr.github.io/did-btcr2/operations/resolve.html#if-genesis_bytes-is-a-sha-256-hash) and [Find Beacon Signals](https://dcdpr.github.io/did-btcr2/operations/resolve.html#find-beacon-signals).
- [did:btcr2 specification, Update](https://dcdpr.github.io/did-btcr2/operations/update.html).
- [Specification pull request 387](https://github.com/dcdpr/did-btcr2/pull/387).
- [DID Core v1.1](https://www.w3.org/TR/did-1.1/).
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785): the JSON Canonicalization Scheme (JCS).
- [ADR 057](057-did-document-validation-standards.md): the `@context` check.
- [ADR 066](066-x1-transport-authentication.md): the communication key of an `x1` participant.
- [ADR 108](108-genesis-document-builder-and-cli-genesis-build.md): the checks of `createExternalFromDocument`.
- [ADR 114](114-resolver-ignores-the-signals-of-a-removed-beacon-address.md): the signals of a removed beacon address.
- [ADR 135](135-an-update-is-refused-if-the-source-resolution-misses-an-update-of-the-sidecar-data.md): the api guard criterion.
- [ADR 140](140-the-resolver-checks-the-genesis-id-and-compares-with-the-did-under-resolution.md): the genesis id and `INVALID_DID_DOCUMENT`.
- [ADR 144](144-did-document-keeps-every-property-and-only-the-key-template-sets-the-initialkey-relationships.md): `DidDocument` keeps every property.
- [ADR 147](147-only-the-method-that-signs-an-update-must-be-a-bip340-multikey-and-both-update-paths-check-that-method.md): the method that signs an update and the lock-out guard.
