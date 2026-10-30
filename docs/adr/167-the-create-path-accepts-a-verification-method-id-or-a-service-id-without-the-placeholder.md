# ADR 167: The Create Path Accepts a Verification Method id or a Service id Without the Placeholder

- **Status:** Accepted
- **Date:** 2026-10-30
- **Packages:** `@did-btcr2/method` (PATCH: `validateGenesis('producer')` and `GenesisDocument.create` no longer require the placeholder `did:btcr2:_` in each verification method `id` and each service `id`); `@did-btcr2/api` (PATCH: `btcr2.createExternalFromDocument` accepts such an id, and `btcr2.buildGenesisDocument` keeps a service `id` that is not a fragment as given; the browser bundle holds the method package); `@did-btcr2/cli` (PATCH: the `create` and `genesis` docs; dependency uptake through api)

## Context

### The create path required the placeholder in each id

In this ADR, a method id is the `id` of a verification method. ADR 108 says that `createExternalFromDocument` checks "the placeholder in every verification method and service id". ADR 149 (decision 1, check 4) kept this rule only for a producer. Thus `validateGenesis('producer')` refused a method id or a service id without `did:btcr2:_`. It refused such an id with `Invalid GenesisDocument <member>: <member>[<index>].id must contain "did:btcr2:_"`.

These functions call `validateGenesis('producer')`:

- `GenesisDocument.create`. `GenesisDocument.fromPublicKey` and the api `btcr2.buildGenesisDocument` call it.
- The api `assertGenesisDocument`, which `btcr2.createExternalFromDocument` calls.

The cli `create -t x --document` calls `createExternalFromDocument`. The cli `genesis build` calls `buildGenesisDocument`, and then `createExternalFromDocument`.

### The builder had a second rule

`btcr2.buildGenesisDocument` refused a service `id` that is not a fragment and does not contain the placeholder. It refused such an `id` with `services[<index>].id "<id>" must be a fragment ("#name") or contain the placeholder "did:btcr2:_".`

### Only the create path refused these documents

ADR 149 (decision 8) gave `Identifier.validate` the rules of a consumer, the same rules as the resolver. Thus the read paths accept a genesis document with an id without the placeholder. The create path refused the same document:

| Change to the genesis document | `createExternalFromDocument` | `Identifier.validate` | Resolver |
|---|---|---|---|
| None | Accepts | Valid | Accepts |
| Method id `#key-0` | Refuses | Valid | Accepts |
| Beacon service id `#service-0` | Refuses | Valid | Accepts |
| Other service id `#service-1` | Refuses | Valid | Accepts |
| Other service id `https://example.com/svc` | Refuses | Valid | Accepts |

The resolver replaces only the placeholder with the DID. Thus a relative id stays relative in the initial DID document, for example `#key-0`. With `expandRelativeUrls: true` (ADR 162), the resolver expands each relative DID URL of the result document.

### The specification sets the placeholder only in the document id

Data Structures, "Genesis Document", says: "A [Genesis Document] is a [DID document (data structure)] with the identifier set to the placeholder value (`did:btcr2:_`)." The specification gives no rule for the id of a verification method or a service in a genesis document.

Data Structures, "DID Document", says: "Verification method references in this document MAY be relative DID URLs."

DID Core v1.1, section 5.2, adds a restriction to each verification method: "(a) the id value MUST conform to Section 3.2 DID URL Syntax or Section 3.2.1 Relative DID URLs". Section 3.2.1 says: "A relative DID URL is any URL value in a DID document that does not start with did:<method-name>:<method-specific-id>." It also says: "The URL is expected to reference a resource in the same DID document."

DID Core v1.1, section 5.4, says: "Identifiers used in services can be expressed according to Section 3.1 DID Syntax or Section 3.2 DID URL Syntax." Controlled Identifiers v1.0, section 2.1.4, says: "The id property is OPTIONAL. If present, its value MUST be a URL conforming to URL Standard."

## Decision

### 1. The genesis checks of a producer do not check the placeholder in an id

`validateGenesis('producer')` no longer runs check 4 of ADR 149, decision 1. The other genesis checks and their order do not change. Each caller in the context gets the new rule. Thus `btcr2.createExternalFromDocument` and the cli `create -t x --document` accept a method id or a service id without the placeholder, for example `#key-0`. The cli `genesis build` gets decision 2.

The create path still checks the syntax of each id with the rules of a producer (ADR 149, decisions 4 and 5).

### 2. The builder keeps a service id that is not a fragment

`btcr2.buildGenesisDocument` sets the `id` of each other service as follows:

1. No `id`: the builder gives `did:btcr2:_#service-<position>`.
2. A fragment `#name`: the builder gives `did:btcr2:_#name`.
3. Another string: the builder keeps the `id` as given, for example `https://a.example/services#1` or `links`.

Before, the builder refused an `id` of form 3 without the placeholder. Now `GenesisDocument.create` checks the `id` with the rules of a producer. A service `id` follows the reference rule (ADR 149, decision 4, rule 4, and decision 5). For `not a url`, the message is `Invalid GenesisDocument service: service[<index>].id must be a relative DID URL: an RFC 3986 relative reference`. ADR 149 (decision 5, rule 2) gives this message for a value with no scheme that is not an RFC 3986 relative reference. The `<index>` counts the beacons too: it is the position in the `service` array of the document.

The builder still refuses an `id` that is not a string or that is empty, with `services[<index>].id must be a non-empty string.` Each id that the builder makes contains the placeholder, as before.

### 3. A method id does not need to be under the DID

The create path now accepts a method id under another DID, for example `did:example:a#key-0`. It also accepts an `https` method id, for example `https://a.example/keys#1`. The read paths and the write path accepted these ids before this change.

Only the method that signs an update must have an id under the DID. The write path checks this rule (ADR 147, decision 6, rule 2). `btcr2.createExternalFromDocument` still refuses a document if no `capabilityInvocation` method can sign an update (ADR 147, decision 9). Thus it refuses a document whose only `capabilityInvocation` method has an id under another DID.

### 4. The docs give the new rule

The JSDoc of `validateGenesis`, `createExternalFromDocument`, `assertGenesisDocument`, `buildGenesisDocument`, and `GenesisDocumentSpec.services` gives the new rule. The cli docs of `create --document` and of the `genesis build` spec give it too.

The api README and the cli `create` doc list the URLs that a producer checks and that the resolver does not check. The list now also names a method `id` and a relationship reference.

### 5. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| The create path does not require the placeholder in the id of a verification method or a service (decision 1). | Data Structures, "Genesis Document": "A [Genesis Document] is a [DID document (data structure)] with the identifier set to the placeholder value (`did:btcr2:_`)." | Conforms. The definition sets only the identifier of the document. |
| The create path accepts a relative method id, for example `#key-0` (decision 1). | DID Core v1.1, section 5.2: "(a) the id value MUST conform to Section 3.2 DID URL Syntax or Section 3.2.1 Relative DID URLs". Data Structures, "DID Document": "Verification method references in this document MAY be relative DID URLs." | Conforms. Section 5.2 allows a relative DID URL as a method id. The Data Structures text allows a relative DID URL as a reference. |
| The create path accepts a method id under another DID and an `https` method id (decision 3). | DID Core v1.1, section 5.2: the text of the row above. Section 3.2.1: "A relative DID URL is any URL value in a DID document that does not start with did:<method-name>:<method-specific-id>." "The URL is expected to reference a resource in the same DID document." | Conforms. `did:example:a#key-0` has the DID URL syntax of section 3.2. `https://a.example/keys#1` does not start with a DID, so the definition of section 3.2.1 makes it a relative DID URL. "expected" is not a BCP 14 keyword. ADR 149 (decision 5, rule 3) checks such an id as a URL. |
| The create path and the builder accept a service id without the placeholder (decisions 1 and 2). | Controlled Identifiers v1.0, section 2.1.4: "The id property is OPTIONAL. If present, its value MUST be a URL conforming to URL Standard." DID Core v1.1, section 5.4: "Identifiers used in services can be expressed according to Section 3.1 DID Syntax or Section 3.2 DID URL Syntax." | Conforms. "can" is not a BCP 14 keyword. The rules of a producer check the syntax of the `id` (ADR 149, decision 5). |
| The builder keeps a service id that is not a fragment as given (decision 2). | The specification does not define the inputs of a builder. | Conforms. |

## Alternatives

**Keep the placeholder rule on the create path.** Rejected. The specification sets the placeholder only in the document `id`. The create path then refuses a genesis document that the resolver accepts.

**Refuse a method id that is not under the DID.** Rejected. DID Core v1.1 lets a method id be a DID URL or a relative DID URL. The read paths and the write path accept such an id. ADR 147 applies the id rule only to the method that signs an update.

**Keep the builder refusal of a service id without the placeholder.** Rejected. The builder then refuses a service that `createExternalFromDocument` accepts.

## Consequences

- The method, api, and cli packages get a PATCH release. The aggregation package gets no change.
- `validateGenesis('producer')`, `GenesisDocument.create`, `btcr2.createExternalFromDocument`, and the cli `create -t x --document` accept a method id or a service id without the placeholder. Before, they refused such an id with `Invalid GenesisDocument <member>: <member>[<index>].id must contain "did:btcr2:_"`.
- `btcr2.buildGenesisDocument` and the cli `genesis build` keep a service `id` that is not a fragment as given. Before, the builder refused such an `id` without the placeholder, with the message of the context. Now `GenesisDocument.create` refuses an `id` with a wrong syntax, with the message of decision 2.
- `GenesisDocument.fromPublicKey` and the scenario script `packages/api/lib/generate-scenario.ts` give `GenesisDocument.create` only placeholder ids. Their output does not change.
- The resolver keeps each relative id of the genesis document in the initial DID document, for example `#key-0`. `btcr2.getBeacons` gives a relative beacon id as the document gives it, for example `#service-0`. `btcr2.signUpdate` with the method id `#key-0` gives the proof `verificationMethod` `<did>#key-0`. These results do not change. New api tests check them.
- The test vectors do not change. ADR 149 (decision 10) says that four genesis documents have a relative method `id`. The placeholder rule of a producer refused them. The rules of a producer now accept them. These rules also accept each of the 116 genesis documents with a different JSON text in `packages/api/lib/data`.

**Superseded.**

- ADR 108, "The api creates the identifier from the document": the check of "the placeholder in every verification method and service id". Decision 1 of this ADR removes it.
- ADR 108, "The api builds the genesis document": the words "the other services with a placeholder id". Decision 2 of this ADR keeps a service `id` that is not a fragment as given.
- ADR 148, decision 4: the sentence "Each method `id` contains the placeholder." in step 3, and the words "that contains the placeholder" in step 4. The reason: the words "and the placeholder in each `id` (ADR 108)". Decision 1 of this ADR removes the rule.
- ADR 148, "Consequences": the bullet that starts "The genesis checks still require the placeholder in each method `id` and each service `id` (ADR 108)." The "Unchanged" block: the words "and the placeholder in each method `id` and service `id`" in the ADR 108 bullet. Decision 1 of this ADR removes the rule.
- ADR 149, "Examples": the text "`createExternalFromDocument`: `Invalid GenesisDocument service: service[1].id must contain "did:btcr2:_"`". Decision 1 of this ADR makes the create path accept that document.
- ADR 149, decision 1: check 4 of `validateGenesis(role)`. Decisions 7 and 9: the words "and the placeholder checks run last". Decision 1 of this ADR removes the check.
- ADR 149, decision 8: the sentence "The create path keeps the placeholder rule of ADR 108." The "Consequences" section: the sentence "`createExternalFromDocument` still refuses it (ADR 108)." The "Superseded" block: the sentence "The rule now applies only to a producer (decision 8)." The "Unchanged" block: the words "the placeholder rule of the create path" in the ADR 108 bullet. Decision 1 of this ADR removes the rule from the create path.

**Unchanged.**

- ADR 108: the builder and its defaults. `createExternalFromDocument` still checks the document `id` `did:btcr2:_` and the two contexts. Decision 2 of this ADR adds a service `id` that the builder keeps as given.
- ADR 147: only the method that signs an update must be a BIP340 Multikey with the DID as its controller (decisions 1 and 2). On the write path, its id must be under the DID (decision 6, rule 2). `btcr2.createExternalFromDocument` still refuses a lock-out (decision 9). Decision 3 of this ADR adds that each other method can have an id that is not under the DID.
- ADR 149: the genesis document `id` is the placeholder (decision 1, check 1). The create path applies the rules of a producer (decision 2). The read paths apply the rules of a consumer. The create path still checks the syntax of each id (decisions 4 and 5). The api check `assertUniqueIds` stays. Decision 1 of this ADR adds the create path to the paths that accept an id without the placeholder.

## Implementation

- `packages/method/src/utils/did-document.ts`: `validateGenesis` no longer checks the placeholder in each id; its JSDoc.
- `packages/api/src/genesis.ts`: `serviceId` keeps an id that is not a fragment; the JSDoc of `GenesisDocumentSpec.services`, `buildGenesisDocument`, `assertGenesisDocument`, and `serviceId`.
- `packages/api/src/method.ts`: the JSDoc of `createExternalFromDocument`.
- Docs: `packages/api/README.md` (the checks of `createExternalFromDocument`), `packages/cli/docs/genesis.md` (the `services[]` row and "The document"), `packages/cli/docs/create.md` (the `--document` row).
- Tests:
  - method: `did-core-conformance.spec.ts` (the rules of a producer accept each accept case; the create path and the read path accept a method id and a service id without the placeholder), `data/did-core-cases.ts` (a new accept case with a method id under another DID; the change removes the flag `placeholderFree`).
  - api: `genesis.spec.ts` (the builder keeps `did:example:1#x`, `https://e.example/services#1`, and `links`, and it refuses `not a url` and `''`; `createExternalFromDocument` creates a DID from a document with ids without the placeholder, and it refuses a document whose only `capabilityInvocation` method has an id under another DID; `signUpdate` signs with `#key-0`).

## References

- did:btcr2 specification: [Data Structures](https://dcdpr.github.io/did-btcr2/data-structures.html) ("DID Document", "Genesis Document").
- [DID Core v1.1](https://www.w3.org/TR/did-1.1/), sections 3.2, 3.2.1, 5.2, and 5.4.
- [Controlled Identifiers v1.0](https://www.w3.org/TR/cid-1.0/), section 2.1.4.
- ADRs 108, 147, 148, 149, 162.
