# ADR 149: The DID Document Checks Apply DID Core v1.1, and the Write and Create Paths Also Apply the Rules of a Producer

- **Status:** Accepted
- **Date:** 2026-10-19
- **Packages:** `@did-btcr2/method` (MINOR: `DidDocument.isValid` and `validateGenesis` apply the member rules of DID Core v1.1 and take a role, `consumer` or `producer`. Each path refuses more documents, and each message names the member, the path of the value, and the rule. `DidDocument.isValidVerificationRelationships` is removed. `GenesisDocument.create` and `Updater.construct` apply the rules of a producer. `Identifier.validate` applies the rules of the resolver, so it no longer requires the placeholder in each method `id` and service `id`); `@did-btcr2/api` (MINOR: the browser bundle holds the method package. `btcr2.buildGenesisDocument`, `btcr2.createExternalFromDocument`, `btcr2.constructUpdate`, `btcr2.signUpdate`, and `btcr2.update` apply the rules of a producer. The resolution and `did.validate` apply the rules of a consumer); `@did-btcr2/cli` (PATCH: dependency uptake)

## Context

### The specification requires DID Core v1.1 on each path

The specification (Resolve) gives the same requirement for the initial DID document of each identifier type: "The resulting DID Document (data structure) MUST be conformant to DID Core v1.1." For each update, it says: "Verify that `current_document` conforms to DID Core v1.1 and that `current_document.id` equals `did`. Otherwise raise `INVALID_DID_UPDATE`."

The specification (Update) says: "`targetDidDocument` MUST be conformant to DID Core v1.1." The Deactivate operation "is the Update operation with a predetermined patch".

The specification (Data Structures, DID Document) gives one exception for the resolver: "A resolver parses only one URL in a DID document. That URL is the `serviceEndpoint` of a BTCR2 Beacon service, and the resolver parses it as a Beacon Address. A resolver MAY treat all other URLs in the document as opaque strings." Footnote 2 adds: "This rule applies to the resolver, and does not change the requirements of DID Core v1.1 or of a JSON-LD processor." The same section also says: "Implementations MUST resolve a relative DID URL against the document `id` before they compare that URL with another reference."

### DID Core v1.1 takes the member rules from Controlled Identifiers v1.0

DID Core v1.1 (section 5) defines the members of a DID document through Controlled Identifiers (CID) v1.0, section 2. These rules apply:

| Member | Rule |
|---|---|
| `controller` (CID 2.1.2) | "If present, its value MUST be a string or a set of strings, each of which conforms to the rules in the URL Standard." DID Core 5.1.2 extends the rule "to include DIDs". |
| `alsoKnownAs` (CID 2.1.3) | "If present, its value MUST be a set where each item in the set is a URI conforming to [RFC3986]." |
| `service` (CID 2.1.4) | "Each service map MUST contain id, type, and serviceEndpoint properties." The `id`: "its value MUST be a URL conforming to URL Standard. A conforming document MUST NOT include multiple service entries with the same id." The `type`: "Its value MUST be a string or a set of strings." The `serviceEndpoint`: "a single string, a single map, or a set composed of one or more strings and/or maps. Each string value MUST be a valid URL conforming to URL Standard." |
| `verificationMethod` (DID Core 5.2) | "(a) the id value MUST conform to Section 3.2 DID URL Syntax or Section 3.2.1 Relative DID URLs and (b) the controller value MUST conform to Section 3.1 DID Syntax." |
| `expires`, `revoked` (CID 2.2) | "it MUST be an [XMLSCHEMA11-2] dateTimeStamp string". |
| Key material (CID 2.2.1) | "A verification method MUST NOT contain multiple verification material properties for the same material. For example, expressing key material in a verification method using both publicKeyJwk and publicKeyMultibase at the same time is prohibited." |
| `publicKeyMultibase`, `secretKeyMultibase` (CID 2.2.2) | "If present, its value MUST be a Multibase encoded value as described in Section 2.4 Multibase." Section 2.4 gives the alphabets of the headers `u` and `z`, and says: "Other Multibase encoding values MAY be used, but interoperability is not guaranteed between implementations using such values." |
| `publicKeyJwk`, `secretKeyJwk` (CID 2.2.3) | "The publicKeyJwk property MUST NOT contain any property marked as "Private" or "Secret" in any registry contained in the JOSE Registries [JOSE-REGISTRIES], including "d"." For `secretKeyJwk`: "It MUST NOT be used if the data structure containing it is public or may be revealed to parties other than the legitimate holders of the secret key." |
| The verification relationships (CID 2.3) | "If present, its value MUST be a set of one or more verification methods. Each verification method MAY be embedded or referenced." |

DID Core v1.1 (section 4) defines a set: "A finite ordered sequence of items that does not contain the same item twice as specified in the Infra Standard."

### DID Core v1.1 separates a producer and a consumer

DID Core v1.1 (section 1.4) defines two roles. "A conforming producer is any algorithm realized as software and/or hardware that generates conforming DIDs or conforming DID Documents". "A conforming consumer is any algorithm realized as software and/or hardware that consumes conforming DIDs or conforming DID documents".

Section 6.2 gives each role its rules. For production, a set is "A JSON Array, where each element of the set is added, in order, as a value of the array". For consumption, a JSON Array of a set gives "A set, where each value of the JSON Array is added to the set in order". The Infra Standard says: "To append to an ordered set: if the set contains the given item, then do nothing; otherwise, perform the normal list append operation."

Thus a producer writes each item of a set one time. A consumer that reads the same item two times gets a set with that item one time.

### The checks before this change

`DidDocument.isValid` checked `@context`, the `id`, and the shape of `verificationMethod`, `service`, and four verification relationships. A method needed a string `id`, `type`, and `controller` ([ADR 147](147-only-the-method-that-signs-an-update-must-be-a-bip340-multikey-and-both-update-paths-check-that-method.md)). No check read the syntax of a URL, the key material, the dates, the items of a set, `keyAgreement`, or two services with one `id`. A relationship with no item passed.

For a DID as the `id`, the constructor ran three checks before the copy, so the first error depended on the path ([ADR 148](148-did-document-adds-no-member-so-context-is-required-and-verificationmethod-and-service-are-optional.md), decision 8).

The genesis checks required the placeholder `did:btcr2:_` in each method `id` and each service `id` ([ADR 108](108-genesis-document-builder-and-cli-genesis-build.md)). `Identifier.validate` ran these checks, and the resolver did not. Thus `Identifier.validate` refused a genesis document that the resolver accepted.

`Updater.construct` read `targetDocument.id` before it checked that the target is a JSON object. A patch that replaces the whole document with `null` gave a plain `TypeError`.

### Examples

| Input | Before | After |
|---|---|---|
| A method whose `controller` is `did:example:a#key-1`, on each path | Valid | `Invalid "verificationMethod": verificationMethod[1].controller must be a DID` |
| A method whose `publicKeyJwk` has the member `d`, on each path | Valid | `Invalid "verificationMethod": verificationMethod[1].publicKeyJwk.d must not be present: a public key has no private member` |
| `authentication: []`, on each path | Valid | `Invalid "authentication": authentication must be an array of one or more items` |
| Two services with the ids `#links` and `<did>#links`, on each path | Valid | `Invalid "service": service[1].id is the id of service[0]: each service needs a different id` |
| `authentication` holds one reference two times | Valid on each path | The resolver accepts the document. `Updater.construct`: `Error validating targetDocument: Invalid "authentication": authentication[1] repeats authentication[0]: a set contains each item one time` |
| A method with a valid `secretKeyMultibase` | Valid on each path | The resolver accepts the document. The write path and the create path refuse it: `verificationMethod[0].secretKeyMultibase must not be present: a DID document is public` |
| `alsoKnownAs: ["a.example"]` | Valid on each path | The resolver accepts the document. The write path and the create path refuse it: `alsoKnownAs[0] must be a URI` |
| A genesis document with a service whose `id` is `https://example.com/svc` | `Identifier.validate`: `Invalid GenesisDocument service`. The resolver accepts the document. | `Identifier.validate`: valid. `createExternalFromDocument`: `Invalid GenesisDocument service: service[1].id must contain "did:btcr2:_"` |
| A DID document without `@context` and with `service: null`, in `new DidDocument` | `Invalid service: null` | `Invalid "@context"`, on each path |
| A patch that replaces the whole document with `null`, in `Updater.construct` | A plain `TypeError` | `Error validating targetDocument: Invalid DID document: the document must be a JSON object` |

## Decision

### 1. One internal module holds the member rules

The internal module `src/utils/did-core-conformance.ts` holds the function `didCoreProblem(document, role)`. The package does not export the module ([ADR 132](132-the-api-exports-only-its-facade-and-a-sub-facade-function-does-each-crud-step.md)). The function returns the first rule that a member breaks, as `{ member, message }`, or `undefined`. The checks run in the order of DID Core section 5: `controller`, `alsoKnownAs`, `verificationMethod`, the five verification relationships, and `service`. A producer then checks the ids that two items share. Each message starts with the path of the value, for example `service[1].id`.

`DidDocument.isValid(document, role)` runs these checks in this order. The first check that fails throws a `DidDocumentError` of type `INVALID_DID_DOCUMENT`:

1. The document is a JSON object. The message is `Invalid DID document: the document must be a JSON object`.
2. `@context` contains the two btcr2 contexts ([ADR 057](057-did-document-validation-standards.md), decision 1). The message is `Invalid "@context"`.
3. The `id` is a did:btcr2 identifier. The message is `Invalid "id"`.
4. `didCoreProblem`. The message is `Invalid "<member>": <rule>`.

`validateGenesis(role)` runs these checks in this order:

1. The `id` is the placeholder. The message is `Invalid GenesisDocument ID`.
2. `@context` contains the two btcr2 contexts. The message is `Invalid GenesisDocument "@context"`.
3. `didCoreProblem`. The message is `Invalid GenesisDocument <member>: <rule>`.
4. A producer only: each method `id` and each service `id` contains the placeholder (ADR 108). The message is `Invalid GenesisDocument <member>: <member>[<index>].id must contain "did:btcr2:_"`.

This change removes the private checks `isValidVerificationMethods` and `isValidServices`, and the public static `isValidVerificationRelationships`. The shape check of a service no longer uses `isDidService` of `@web5/dids`.

Reason: each path uses one rule set, and the role selects the extra rules. A message with the path of the value shows the caller which item to correct.

### 2. The read path is a consumer, and the write path and the create path are a producer

The type `ConformanceRole` is `'consumer' | 'producer'`. The terms are the terms of DID Core section 6. The default role is `consumer`.

These call sites use the role `producer`:

- `Updater.construct`, for the target document. Thus `DidBtcr2.update`, `Updater.sign`, and the api `btcr2.constructUpdate`, `btcr2.signUpdate`, `btcr2.update`, and `btcr2.deactivate` apply the rules of a producer.
- `GenesisDocument.create`. It runs `validateGenesis('producer')` after the constructor. `GenesisDocument.fromPublicKey` and the api `btcr2.buildGenesisDocument` call it.
- The api `assertGenesisDocument`, which `btcr2.createExternalFromDocument` calls.

The other call sites use the role `consumer`: the resolver (the initial DID document and each update), the `DidDocument` constructor, `GenesisDocument.fromJSON`, `DidDocument.fromExternalIdentifier`, and `Identifier.validate`.

Reason: the write path and the create path generate the DID document, so they are producers. The resolver reads the DID document, so it is a consumer. DID Core section 6 gives each role its own rules for a set. The specification lets a resolver treat a URL as an opaque string.

### 3. The rules on each path

Each path applies these rules. An absent member passes. A present member must have the value of its rule, so `null` fails.

1. `controller` is a string or an array of strings.
2. `alsoKnownAs` is an array of strings.
3. `verificationMethod` is an array of maps. Each map has a string `id`, `type`, and `controller`.
4. The `id` of a method follows the reference rule of decision 5. The `controller` of a method is a DID (DID Core 5.2(b)).
5. The key material and the dates follow decision 6.
6. Each of the five verification relationships, `keyAgreement` included, is an array of one or more items. An item is a string that follows the reference rule, or an embedded map with the rules of items 3 to 5.
7. `service` is an array of maps. Each map has a string `id` and a `type` that is a string or an array of strings. Its `serviceEndpoint` is a string, a map, or an array of one or more strings and maps.
8. No two services have the same `id` after a relative `id` resolves against the document `id` (CID 2.1.4).

An empty array is valid for `controller`, `alsoKnownAs`, `verificationMethod`, `service`, and the `type` of a service. CID defines these values as "a set" with no minimum size. Only the verification relationships and an array `serviceEndpoint` need "one or more" items.

### 4. The rules of a producer

The write path and the create path also apply these rules:

1. A set does not contain the same item two times. Two maps are the same item if their JCS text is the same. Two references are the same item if they give the same absolute DID URL. The rule applies to `controller`, `alsoKnownAs`, `verificationMethod`, the verification relationships, the `type` of a service, and an array `serviceEndpoint`.
2. A top-level `controller` item is a DID or a URL. An item with the `did` scheme must be a DID, so it cannot have a path, a query, or a fragment (DID Core 5.1.3).
3. An `alsoKnownAs` item is an RFC 3986 URI.
4. A service `id` follows the reference rule of decision 5.
5. A `serviceEndpoint` string is a URL.
6. A method has no `secretKeyMultibase`.
7. No two items of `verificationMethod`, the verification relationships, and `service` have the same `id` after a relative `id` resolves against the document `id`. An embedded method counts.

The message of rule 1 is `<path>[<index>] repeats <path>[<first>]: a set contains each item one time`. The message of rule 7 is `<path>.id is the id of <first path>: each verification method and each service needs a different id`.

Reason: a producer generates the DID document, so it must write a conformant document. The specification lets only the resolver treat a URL as opaque.

### 5. The syntax checks use the grammar that each rule names

The internal module `src/utils/url-syntax.ts` holds the syntax checks:

- A DID and a DID URL follow the ABNF of DID Core sections 3.1 and 3.2. ABNF strings are case-insensitive (RFC 5234, section 2.3), so `DID:` also matches the `did:` string. The method name must be lowercase.
- A URI and a relative reference follow the ABNF of RFC 3986, with IPv6 and IPvFuture hosts.
- A URL is a value that the URL parser of the URL Standard accepts with no base URL (`URL.canParse`).

A method `id` and a relationship reference follow this reference rule:

1. A value with the `did` scheme must be a DID URL. The message is `<path> must be a DID URL: the value has the "did" scheme`.
2. A value with no scheme is a relative DID URL. It must be an RFC 3986 relative reference. The message is `<path> must be a relative DID URL: an RFC 3986 relative reference`. A consumer does not check a relative reference that starts with `//`.
3. A producer checks that a value with another scheme is a URL. The message is `<path> must be a URL`. A consumer treats such a value as opaque.

Reason: DID Core 5.2 requires a DID URL or a relative DID URL for a method `id`. A value with the `did` scheme has the syntax of the `did` URI scheme, so it is not a relative reference (RFC 3986, section 4.2). A relative reference with an authority (`//`) contains a host. The specification lets a resolver skip the parse of a host (Data Structures, footnote 1). The URL Standard parser accepts a non-ASCII host, and CID names the URL Standard for `controller`, a service `id`, and `serviceEndpoint`. CID names RFC 3986 for `alsoKnownAs`, so an `alsoKnownAs` item with a non-ASCII host fails.

### 6. The checks of the key material and the dates

These checks apply on each path to each method in `verificationMethod` and to each embedded method. They do not depend on the method `type`:

1. A method does not have both `publicKeyMultibase` and `publicKeyJwk` (CID 2.2.1). A public key and a secret key are different material, so `publicKeyMultibase` with `secretKeyMultibase` passes this check.
2. `publicKeyMultibase` and `secretKeyMultibase` start with a Multibase header. The headers are the 25 headers with an encoding in the multibase registry, at commit `72573756` of `multibase.csv`. After a `u` header or a `z` header, each character must be in the alphabet of that header. CID defines no alphabet for the other headers, so the check stops at the header.
3. `publicKeyJwk` is a map with a string `kty` (RFC 7517, section 4.1). It has no member of the "Private" class of the IANA JSON Web Key Parameters registry: `d`, `p`, `q`, `dp`, `dq`, `qi`, `oth`, `k`, and `priv` (read on 2026-10-19).
4. A method has no `secretKeyJwk`. A DID document is public, so CID 2.2.3 does not let it hold this property.
5. `expires` and `revoked` are XML Schema 1.1 `dateTimeStamp` strings: a date and a time with a timezone. The new internal function `isDateTimeStamp` makes this check. The resolver uses it also for the `created` and `expires` values of a proof.

The checks do not compare a Multikey header with the method type, and they do not decode a key. CID 2.2.2 says: "Implementations that adhere to this specification will raise errors in the event of a Multikey header value that is not in the public key header table above". This change does not apply that sentence. Only the method that signs an update must be a BIP340 Multikey, and the update paths decode its key (ADR 147).

### 7. The constructor and `Updater.construct` check the root value first

The `DidDocument` constructor checks only that its input is a JSON object. Then it copies the input (ADR 144) and runs `DidDocument.isValid` or `validateGenesis` with the role `consumer`. The three checks before the copy are removed. Thus one input gives the same first error on each path.

`Updater.construct` checks that the target document is a JSON object before it compares the `id` of the target with the `id` of the source.

The genesis checks now run in the order of decision 1. ADR 148 (decision 4) checked `verificationMethod` and its placeholders before `service`, and the verification relationships last. Now the checks follow DID Core section 5, and the placeholder checks run last. The specification gives no order for these checks.

Reason: ADR 148 (decision 8) kept the three checks until a change for DID Core conformance set one order. This is that change.

### 8. The check command applies the rules of the resolver

`Identifier.validate` with `options.genesisDocument` calls `GenesisDocument.fromJSON`, so it applies the rules of a consumer. The api `did.validate` and the cli `identifier validate --genesis-document` use it. The check no longer requires the placeholder in each method `id` and service `id`. The create path keeps the placeholder rule of ADR 108.

Reason: the check reports if a genesis document gives a DID document that resolves. The resolver does not apply the genesis checks of a producer. Before, the check refused a genesis document that the resolver accepted.

### 9. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| Only a producer refuses two items with the same `id` (methods, embedded methods, services). The service rule applies on each path. | CID 3.4, note: "doing so is to be avoided and the behaviour is not defined." CID 2.1.4: "A conforming document MUST NOT include multiple service entries with the same id." | Conforms. The note gives no requirement for a consumer. The service text is a MUST, so each path applies it. |
| Only a producer refuses `secretKeyMultibase`. | CID 2.2.2: "The secretKeyMultibase property is OPTIONAL." Also: "Developers are advised to not accidentally publish a representation of a secret key." | Conforms. The text has no MUST NOT for a consumer. A producer publishes the document, so it refuses the secret key. |
| A consumer accepts an item that occurs two times in a set. A producer refuses it. | DID Core 6.2.2 and the Infra Standard (above). | Conforms. The consumption rule adds each item to the set, and the set ignores an item that it contains. |
| An empty array is valid for `controller`, `alsoKnownAs`, `verificationMethod`, `service`, and a service `type`. | CID 2.1.2, 2.1.3, and 2.1.4 say "a set". Only the verification relationships and `serviceEndpoint` say "one or more". | Conforms. |
| The genesis checks follow DID Core section 5, and the placeholder checks run last. | The specification gives no order. | Conforms. |
| The read path checks the DID syntax of a method `controller`, and the DID URL syntax of a method `id` and a relationship reference. | DID Core 5.2 (a) and (b) are MUST rules. Resolve requires DID Core v1.1. Data Structures requires a resolver to resolve a relative DID URL before a comparison, so the resolver reads these values. | Conforms. The MAY of Data Structures does not cover a value that the resolver resolves and compares. |
| For a Multibase header other than `u` and `z`, the check stops at the header. | CID 2.4: "Other Multibase encoding values MAY be used". CID defines only the alphabets of `u` and `z`. | Conforms. |

The resolver does not treat a service whose `type` is an array that contains `SingletonBeacon` as a beacon. The specification (Beacons) says: "The `type` of a `service` defining a Singleton Beacon in a DID document is `"SingletonBeacon"`." Resolve matches the service `type` to Beacons Table 1. This change keeps that behavior.

### 10. The test vectors do not change

The 413 DID documents and the 241 genesis documents in `packages/api/lib/data` pass the rules of a consumer. Four genesis documents of one scenario (one on each network) have a relative method `id`, so they fail the placeholder rule of a producer. They failed `GenesisDocument.fromJSON` before this change too, and the resolver did not apply that rule then or now.

The offline vector check (`lib/verify-scenarios.ts`) gives the same failures as before this change. Each failure comes from the `proof.invocationTarget` check of ADR 147 or from an old error code in one vector. No failure comes from the DID Core checks.

The vector rule `document-not-conformant` matches the message by its prefix, `Invalid update: the patched document does not conform`. The new text after the prefix does not change the match. Its recipe sets the `type` of `#initialKey` to the number `42`, and that document still breaks the rule. The message now ends with `verificationMethod[0] must be a map with a string id, type, and controller`.

## Alternatives

- **Apply the rules of a producer on each path.** Rejected. The resolver then refuses a document that the consumption rules of DID Core accept, for example a set with the same item two times. The specification lets the resolver treat a URL as opaque.
- **Apply only the shape checks on the read path.** Rejected. Resolve requires DID Core v1.1, and DID Core 5.2 gives MUST rules for the `id` and the `controller` of a method. CID gives MUST rules for the key material.
- **Refuse an item that occurs two times in a set on each path.** Rejected. The consumption rule of DID Core 6.2.2 adds each item to the set, and an ordered set ignores an item that it contains.
- **Accept two items with the same `id` on each path.** Rejected for a producer. CID 3.4 says that such a document "is to be avoided", and a producer can avoid it.
- **Refuse `secretKeyMultibase` on each path.** Rejected. CID makes the property optional and gives only an advisory text. A producer refuses it, because the producer publishes the document.
- **Check the Multikey header against the method type.** Rejected for this change. The specification requires the BIP340 key only for the method that signs an update (ADR 147).
- **Use RFC 3986 for each URL.** Rejected. CID names the URL Standard for `controller`, a service `id`, and `serviceEndpoint`. The URL Standard parser accepts a non-ASCII host, which RFC 3986 refuses.
- **Treat a `did:` value that fails the DID URL syntax as a relative DID URL.** Rejected. DID Core 3.2.1 defines a relative DID URL as a URL value that "does not start with" the DID syntax. A value with the `did` scheme has the syntax of that scheme, and an RFC 3986 relative reference has no scheme.
- **Keep the placeholder rule in the check command.** Rejected. The check then refuses a genesis document that the resolver accepts.
- **Apply the rules of a producer in `DidDocumentBuilder.build`, `GenesisDocument.toDidDocument`, and `DidDocument.fromExternalIdentifier`.** Rejected for this change. These helpers call the constructor, which applies the rules of a consumer. The write path and the create path check the document before it leaves the library.

## Consequences

- The method and api packages get a MINOR release. The api browser bundle holds the method package. The cli gets a PATCH release for the dependency uptake.
- The `@did-btcr2/aggregation` package gets no change.
- The resolver refuses a DID document that breaks a rule of decision 3 or 6. The error is `INVALID_DID_DOCUMENT` for the initial DID document and `INVALID_DID_UPDATE` for an update. Before, the resolver accepted such a document. Examples are a method whose `controller` is a URL, a public JWK with `d`, and a relationship with no item.
- The write path and the create path refuse a document that breaks a rule of decision 4. The resolver accepts the same document. If a source DID document breaks such a rule, an update must also correct the value. The deactivation patch of the api adds only `deactivated`, so `btcr2.deactivate` fails for such a source. An `update` with a patch that corrects the value and adds `deactivated` passes. The Deactivate operation of the specification is the Update operation, and Update requires a conformant target document.
- Each message names the member, the path of the value, and the rule. Before, the messages were `Invalid "verificationMethod"`, `Invalid "service"`, `Invalid verification relationships`, `Invalid GenesisDocument verificationMethod`, `Invalid GenesisDocument service`, and `Invalid GenesisDocument assertionMethod`.
- `DidDocument.isValidVerificationRelationships` is no longer public.
- The `DidDocument` constructor no longer throws `DID Document must have an id`, `Invalid id: <id>`, `Invalid verificationMethod: <value>`, or `Invalid service: <value>`. For a value that is not a JSON object, it throws `Invalid DID document: the document must be a JSON object`. Before, `null` gave a plain `TypeError`, and an array gave `DID Document must have an id`.
- `Identifier.validate` accepts a genesis document with a method `id` or a service `id` without the placeholder, for example a service with an `https` id. `createExternalFromDocument` still refuses it (ADR 108).
- `btcr2.buildGenesisDocument` refuses a spec whose service gives a `serviceEndpoint` that is not a URL, or an `id` with a wrong syntax. The api check `assertUniqueIds` stays. It runs before `GenesisDocument.create` and names the spec entries.
- CID 2.1.4 says: "Each service map MUST contain id, type, and serviceEndpoint properties." The same section also says: "The id property is OPTIONAL." Each path refuses a service without `id`, as before this change. A service `id` that is present must be a string, because CID requires a URL.
- The checks do not process JSON-LD. The specification (Data Structures) says: "Concrete representations of these data structures MUST conform to the JSON-LD 1.1 specification." DID Core 6.2.3 says: "A conforming producer that generates a JSON-LD representation SHOULD NOT produce a DID document that contains terms not defined via the @context". A member that DID Core does not define still passes on each path.
- The decision of the read path does not depend on footnote 2 of Data Structures. The specification (Conformance) says that "notes in this specification are non-normative". The footnote repeats the MUST of Resolve, which is normative.
- DID Core says that "a DID method can use any data structures it requires, including intermediate, partial, or temporary DID documents, as long as they are kept internal to the DID method, and the DID documents returned by the method operations are fully conformant". The resolver checks each version, because Resolve requires a check after each update. `Identifier.validate` checks the genesis document before the placeholder step. The placeholder `did:btcr2:_` is a valid DID, so the result is the same as for the initial DID document.

**Superseded.**

- ADR 147, decision 1: the bullet "The `DidDocument` validation needs only a string `id`, `type`, and `controller` for each member of `verificationMethod` (`Appendix.isDidVerificationMethod`)." The validation now also applies decisions 3 to 6. A method can still have any type.
- ADR 147, "Consequences": the bullet "The create path, the write path, and the read path still accept a private JWK member `d`, `secretKeyJwk`, `secretKeyMultibase`, and a method with both `publicKeyJwk` and `publicKeyMultibase`." Decisions 4 and 6 refuse these properties.
- ADR 148, decision 4: the order of the genesis checks and the messages `Invalid GenesisDocument verificationMethod` and `Invalid GenesisDocument service`. Decision 1 of this ADR gives the new order and messages.
- ADR 148, decision 5: the sentence "The resolver still accepts a service whose `id` is not a string." Each path now refuses it.
- ADR 148, decision 8: the three checks of the constructor before the copy. Decision 7 of this ADR removes them.
- ADR 108: the placeholder rule in `GenesisDocument.fromJSON` and `Identifier.validate`. The rule now applies only to a producer (decision 8).

**Unchanged.**

- ADR 057, decision 1: the `@context` check.
- ADR 108: the checks of `createExternalFromDocument`, the placeholder rule of the create path, and `assertUniqueIds`.
- ADR 144: the constructor copies each own property, and `toJSON` returns `{ ...this }`.
- ADR 147: only the method that signs an update must be a BIP340 Multikey with the DID as its controller. The id rule of the method that signs and the lock-out guard do not change.
- ADR 148: the constructor adds no member, `@context` is required, and `verificationMethod` and `service` are optional.

## Implementation

- `packages/method/src/utils/did-core-conformance.ts` (new, internal): `ConformanceRole`, `didCoreProblem`, `isJsonMap`, `isDateTimeStamp`, `NOT_A_JSON_OBJECT`, and `VERIFICATION_RELATIONSHIPS`.
- `packages/method/src/utils/url-syntax.ts` (new, internal): `isDid`, `isDidUrl`, `hasDidScheme`, `hasScheme`, `isUri`, `isRelativeReference`, and `isUrl`.
- `packages/method/src/utils/did-document.ts`: the constructor, `isValid`, `validateGenesis`, `GenesisDocument.create`, and the JSDoc. The removed checks.
- `packages/method/src/core/updater.ts`: the root check and the role `producer` in `Updater.construct`.
- `packages/method/src/core/resolver.ts`: `proofInstant` uses `isDateTimeStamp`.
- `packages/api/src/genesis.ts`: `assertGenesisDocument` runs `validateGenesis('producer')`.
- Tests: `packages/method/tests/data/did-core-cases.ts` (new: the accept cases, the refusal cases of each path, and the refusal cases of a producer), `packages/method/tests/did-core-conformance.spec.ts` (new), `did-document.spec.ts`, `resolver.spec.ts`, and `updater.spec.ts`.
- `packages/method/README.md`, `packages/api/README.md`, and `packages/cli/docs/create.md`, `deactivate.md`, `genesis.md`, `identifier.md`, `resolve.md`, and `update.md`: the rules of each role and the new messages.

## References

- [did:btcr2 specification, Data Structures](https://dcdpr.github.io/did-btcr2/data-structures.html): [DID Document](https://dcdpr.github.io/did-btcr2/data-structures.html#did-document) and [Genesis Document](https://dcdpr.github.io/did-btcr2/data-structures.html#genesis-document).
- [did:btcr2 specification, Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html), [Update](https://dcdpr.github.io/did-btcr2/operations/update.html), [Deactivate](https://dcdpr.github.io/did-btcr2/operations/deactivate.html), and [Beacons](https://dcdpr.github.io/did-btcr2/beacons.html).
- [DID Core v1.1](https://www.w3.org/TR/did-1.1/): sections 1.4, 3.1, 3.2, 4, 5, and 6.2.
- [Controlled Identifiers v1.0](https://www.w3.org/TR/cid-1.0/): sections 2.1, 2.2, 2.3, 2.4, and 3.4.
- [Infra Standard](https://infra.spec.whatwg.org/#ordered-set): ordered sets.
- [URL Standard](https://url.spec.whatwg.org/).
- [RFC 3986](https://www.rfc-editor.org/rfc/rfc3986): URI generic syntax. [RFC 5234](https://www.rfc-editor.org/rfc/rfc5234): ABNF. [RFC 7517](https://www.rfc-editor.org/rfc/rfc7517): JSON Web Key.
- [IANA JSON Web Key Parameters](https://www.iana.org/assignments/jose/jose.xhtml#web-key-parameters).
- [multibase.csv at commit 72573756](https://github.com/multiformats/multibase/blob/72573756adb8514d1741b692fe14ebea7f1c01da/multibase.csv).
- [ADR 057](057-did-document-validation-standards.md): the `@context` check.
- [ADR 108](108-genesis-document-builder-and-cli-genesis-build.md): the checks of `createExternalFromDocument` and the placeholder rule.
- [ADR 132](132-the-api-exports-only-its-facade-and-a-sub-facade-function-does-each-crud-step.md): the exports of a package.
- [ADR 144](144-did-document-keeps-every-property-and-only-the-key-template-sets-the-initialkey-relationships.md): `DidDocument` keeps every property.
- [ADR 147](147-only-the-method-that-signs-an-update-must-be-a-bip340-multikey-and-both-update-paths-check-that-method.md): the method that signs an update.
- [ADR 148](148-did-document-adds-no-member-so-context-is-required-and-verificationmethod-and-service-are-optional.md): the constructor adds no member.
