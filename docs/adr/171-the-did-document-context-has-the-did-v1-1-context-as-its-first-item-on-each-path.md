# ADR 171: The DID Document Context Has the DID v1.1 Context as Its First Item on Each Path

- **Status:** Accepted
- **Date:** 2026-11-02
- **Packages:** `@did-btcr2/method` (MINOR: `DidDocument.isValid` and `GenesisDocument.validateGenesis` refuse a `@context` whose first item is not `https://www.w3.org/ns/did/v1.1`, and a `@context` with an item that is not a string or a JSON object; the message names the rule); `@did-btcr2/api` (MINOR: `createExternalFromDocument` leaves the `@context` check to the method, so the message and the error `data` change; the resolution and the update functions apply the new rules through the method); `@did-btcr2/cli` (PATCH: the cli messages of the `@context` check name the rule; dependency uptake through api); `@did-btcr2/aggregation` (PATCH: the JSDoc of `genesisDocument` names the order rule and the kinds rule)

## Context

### The specification

DID Core v1.1, section 6.2.3 "JSON-LD Processors", says: "In addition to using the JSON representation production rules, production MUST include the @context entry. The serialized value of @context MUST be the JSON String https://www.w3.org/ns/did/v1.1, or a JSON Array where the first item is the JSON String https://www.w3.org/ns/did/v1.1 and the subsequent items are serialized according to the JSON production rules."

The same section defines the value of `@context`: "The JSON-LD Context is either a string or a list containing any combination of strings and/or ordered maps."

DID Core v1.1 also says:

- Section 1.4: "Everything else in this specification is normative."
- Section 6.1: "A conforming consumer MUST produce errors when consuming non-conforming DIDs or DID documents."
- Section 6.3.1 is a non-normative section. It lists the steps that an application can use to detect the `application/did` media type. One step is: "Ensure that the first element of the @context property matches https://www.w3.org/ns/did/v1.1."

The did:btcr2 specification says:

- Conformance: "Implementations MUST be conformant to all normative statements in Decentralized Identifiers v1.1".
- DID Document (data structure): "`@context`: A context array containing the following context URLs:" `"https://www.w3.org/ns/did/v1.1"` and `"https://btcr2.dev/context/v1"`. The text gives no order.
- Resolve, for the genesis document: "The resulting DID Document (data structure) MUST be conformant to DID Core v1.1".
- Resolve, "Apply update": "Verify that `current_document` conforms to DID Core v1.1". The step ends with: "Otherwise raise `INVALID_DID_UPDATE`."
- Update, "Construct BTCR2 Unsigned Update": "`targetDidDocument` MUST be conformant to DID Core v1.1". The step names `INVALID_DID_UPDATE` only for a malformed patch and for a changed id.

### The check accepted the two required contexts at any position

`DidDocument.isValid` and `GenesisDocument.validateGenesis` called the private check `isValidContext`. ADR 057, decision 1, set its rule: the value is a non-empty array, and it contains each of the two required contexts. ADR 057 rejected the alternative "Also require the DID Core context first." The reason was that the rule "could reject documents accepted today".

So the check accepted the two contexts in any order. It also accepted an item of any kind, for example `null` or `5`. The check runs on these paths:

- The resolver, for the genesis document and in the "Apply update" step.
- `Updater.construct`, for the target document.
- The create path: `GenesisDocument.fromJSON` and the api `createExternalFromDocument`.
- The check command: `Identifier.validate`.
- The constructor of `DidDocument` and of `GenesisDocument`. So `DidDocumentBuilder.build`, `GenesisDocument.toDidDocument`, and `resolveBtcr2SenderPk` also run the check.

### The api had its own copy of the check

`assertGenesisDocument` in `packages/api/src/genesis.ts` checks the genesis document of `createExternalFromDocument`. It had its own `@context` check, with the message `The genesis document "@context" must include "https://www.w3.org/ns/did/v1.1" and "https://btcr2.dev/context/v1".` and the `data` `{ context }`. Then it called `GenesisDocument.fromJSON(document).validateGenesis('producer')`, and that call ran the method check again.

### Examples

| Case | Before | After |
|---|---|---|
| `["https://www.w3.org/ns/did/v1.1", "https://btcr2.dev/context/v1"]` | Valid | Valid |
| `["https://btcr2.dev/context/v1", "https://www.w3.org/ns/did/v1.1"]` | Valid | `Invalid "@context": @context[0] must be "https://www.w3.org/ns/did/v1.1"` |
| `["https://www.w3.org/ns/did/v1.1", "https://x.example/v1", "https://btcr2.dev/context/v1"]` | Valid | Valid |
| `["https://www.w3.org/ns/did/v1.1", "https://btcr2.dev/context/v1", null]` | Valid | `Invalid "@context": @context[2] must be a string or a JSON object` |
| `["https://www.w3.org/ns/did/v1.1", "https://btcr2.dev/context/v1", { "@vocab": "https://x.example/#" }]` | Valid | Valid |
| `["https://www.w3.org/ns/did/v1.1"]` | `Invalid "@context"` | `Invalid "@context": @context must contain "https://btcr2.dev/context/v1"` |
| `"https://www.w3.org/ns/did/v1.1"` (a string), or no `@context` | `Invalid "@context"` | `Invalid "@context": @context must be an array` |
| `[]` | `Invalid "@context"` | `Invalid "@context": @context[0] must be "https://www.w3.org/ns/did/v1.1"` |
| A genesis document with the btcr2 context first, in the api `createExternalFromDocument` | Valid | `Invalid GenesisDocument "@context": @context[0] must be "https://www.w3.org/ns/did/v1.1"` |
| An update with the patch `[{ "op": "move", "from": "/@context/0", "path": "/@context/-" }]` | The resolver applies the update. `Updater.construct` accepts the patch. | The resolver refuses the update with `INVALID_DID_UPDATE`. The message is `Invalid update: the patched document does not conform to DID Core: Invalid "@context": @context[0] must be "https://www.w3.org/ns/did/v1.1"`. `Updater.construct` refuses the patch with `INVALID_DID_UPDATE`. The message is `Error validating targetDocument: Invalid "@context": @context[0] must be "https://www.w3.org/ns/did/v1.1"`. |

The first eight rows show the result of `DidDocument.isValid`. `validateGenesis` gives the same rule in the message `Invalid GenesisDocument "@context": <rule>`. In each of these rows, the result is the same for a producer and for a consumer.

## Decision

### 1. The first item of `@context` is the DID v1.1 context

The private check `contextProblem(context)` replaces `isValidContext`. It returns the first rule that the `@context` value breaks, or `undefined`. The checks run in this order:

1. The value is an array. The rule is `@context must be an array`. An absent `@context` breaks this rule.
2. The first item is `https://www.w3.org/ns/did/v1.1`. The rule is `@context[0] must be "https://www.w3.org/ns/did/v1.1"`. An empty array breaks this rule. This ADR calls this rule the order rule.
3. Each item is a string or a JSON object (decision 2). The rule is `@context[<i>] must be a string or a JSON object`, with the index of the first item of a wrong kind.
4. An item is `https://btcr2.dev/context/v1` (decision 3). The rule is `@context must contain "https://btcr2.dev/context/v1"`.

The check accepts only an array. DID Core v1.1 also allows the string `https://www.w3.org/ns/did/v1.1`. A did:btcr2 document must also contain the btcr2 context, so the string form cannot be a valid did:btcr2 `@context`.

### 2. Each item is a string or a JSON object

The DID Core v1.1 definition of `@context` allows "any combination of strings and/or ordered maps". This ADR calls this rule the kinds rule. The check uses `isJsonMap` of `src/utils/did-core-conformance.ts` for an ordered map: a value of type `object` that is not `null` and not an array. So the check refuses `null`, a number, a boolean, and an array as an item.

The check does not parse the URL of a string item (see the residuals).

### 3. The btcr2 context can be at any position

The DID Document (data structure) section says "containing" and gives no order. So the check requires only that one item is `https://btcr2.dev/context/v1`. The array can hold other contexts before or after it, for example a proof suite context (ADR 057, decision 1).

### 4. The rules apply to both roles

`DidDocument.isValid(document, role)` and `validateGenesis(role)` apply the same `@context` rules for each role.

- A producer applies the MUST of section 6.2.3 directly. The Update operation also says: "`targetDidDocument` MUST be conformant to DID Core v1.1".
- A consumer must "produce errors when consuming non-conforming DIDs or DID documents" (section 6.1). The resolver consumes the JSON serialization, and a serialization with another first item breaks a MUST of section 6.2.3.

### 5. The message names the rule

`DidDocument.isValid` refuses a bad `@context` with a `DidDocumentError` of type `INVALID_DID_DOCUMENT`. The message is `Invalid "@context": <rule>`. `validateGenesis` refuses it with the same error type and the message `Invalid GenesisDocument "@context": <rule>`. The old message is the start of the new message. The `data` does not change: it is the document.

### 6. The api leaves the `@context` check to the method

`assertGenesisDocument` no longer has its own `@context` check. The method check in `GenesisDocument.fromJSON` and `validateGenesis('producer')` applies the rules. So `createExternalFromDocument` refuses a bad `@context` with the method message, for example `Invalid GenesisDocument "@context": @context must be an array`. The `data` is the document, not `{ context }`.

The reason is that one rule must have one definition. Two copies of one rule can become different, and the api copy had no order rule. ADR 163, decision 3, applies the same pattern to the identifier input checks.

The api still checks first that the document is a JSON object with the id `did:btcr2:_`.

### 7. The update path needs no new code

In the "Apply update" step, the resolver checks the patched document with `DidDocument.validate`. It wraps a failure in a `ResolveError` of type `INVALID_DID_UPDATE`. `Updater.construct` checks the target document with `DidDocument.isValid(targetDocument, 'producer')`. It wraps a failure in an `UpdateError` of type `INVALID_DID_UPDATE`.

So the resolver and `Updater.construct` refuse a patch that moves the DID v1.1 context from the first position. They also refuse a patch that adds an item of a wrong kind. New tests show each of the two refusals for the resolver and for `Updater.construct`.

### 8. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| A consumer refuses a document whose first `@context` item is not the DID v1.1 context (decision 4). | DID Core v1.1, section 6.1: "A conforming consumer MUST produce errors when consuming non-conforming DIDs or DID documents." Resolve, "Apply update": "Verify that `current_document` conforms to DID Core v1.1". | Conforms. The serialization breaks a MUST of section 6.2.3. Section 1.4 gives a narrower definition of a conforming DID document (see the alternatives). |
| A producer refuses the same document (decision 4). | DID Core v1.1, section 6.2.3: "The serialized value of @context MUST be the JSON String https://www.w3.org/ns/did/v1.1, or a JSON Array where the first item is the JSON String https://www.w3.org/ns/did/v1.1". Conformance: "Implementations MUST be conformant to all normative statements in Decentralized Identifiers v1.1". | Conforms. |
| Each item is a string or a JSON object (decision 2). | DID Core v1.1, section 6.2.3: "The JSON-LD Context is either a string or a list containing any combination of strings and/or ordered maps." Section 1.4: "Everything else in this specification is normative." | Conforms. The definition has no RFC 2119 keyword, but section 1.4 makes it normative. |
| The btcr2 context can be at any position (decision 3). | DID Document (data structure): "`@context`: A context array containing the following context URLs:" | Conforms. The text gives no order. |
| The check refuses the string form (decision 1). | DID Document (data structure): "`@context`: A context array containing the following context URLs:" | Conforms. A string cannot contain the btcr2 context. |
| The api leaves the check to the method (decision 6). | The specification has no text about the location of a check. | The specification is silent. The location is a library decision. |
| The resolver refuses a patch that moves the DID v1.1 context. The error type is `INVALID_DID_UPDATE` (decision 7). | Resolve, "Apply update": "Otherwise raise `INVALID_DID_UPDATE`." | Conforms. |
| `Updater.construct` refuses the same patch with `INVALID_DID_UPDATE` (decision 7). | Update, "Construct BTCR2 Unsigned Update": "`targetDidDocument` MUST be conformant to DID Core v1.1". | Conforms. The step names no error type for this MUST. The error type is a library decision. |

## Alternatives

**Only a producer applies the order rule.** Rejected. DID Core v1.1, section 1.4, defines a conforming DID document by sections 4 and 5, and the order rule is in section 6.2.3. This alternative lets a consumer accept another order. But section 6.1 tells a consumer to produce errors for a non-conforming document, and the resolver consumes the serialization. A resolver that accepts another order can also return a document that the media type check of section 6.3.1 (a non-normative section) does not recognize.

**Check only the order, and not the kind of each item.** Rejected. The DID Core definition of `@context` gives the kinds rule. The check reads only the kind of each item, so it needs no JSON-LD processor.

**Also check the URL syntax of a string item.** Rejected. That check needs an IRI parser (RFC 3987). The method has an RFC 3986 parser (`src/utils/url-syntax.ts`), but an IRI can hold non-ASCII characters that RFC 3986 does not allow. Only a JSON-LD processor fails on a string item that is not a URL.

**Require the btcr2 context as the second item.** Rejected. The DID Document (data structure) section gives no order. A producer can put another context, for example a proof suite context, before the btcr2 context.

**Keep the api check with its own message.** Rejected. The api check then needs the same four rules in a second place. The old api copy shows the risk: it had no order rule.

**Keep the rule of ADR 057.** Rejected. ADR 057 rejected the order rule because it "could reject documents accepted today". The order rule is a MUST of DID Core v1.1, and the Conformance section of did:btcr2 requires each normative statement of DID Core v1.1. No test vector has a document with another order (see the consequences).

## Consequences

- The method and the api get a MINOR release. The cli and the aggregation package get a PATCH release. No other package gets a release.
- The test vectors do not change. The test vectors in `packages/api/lib/data` have 654 `@context` arrays of DID documents. In each array, the first item is the DID v1.1 context, each item is a string, and one item is the btcr2 context.
- The resolver no longer resolves a DID whose genesis document has another first `@context` item. It refuses the DID with `INVALID_DID_DOCUMENT`. If an update moves the DID v1.1 context from the first position, the resolver refuses it with `INVALID_DID_UPDATE`. The helpers of the method write the DID v1.1 context first (ADR 148, decision 3).
- `resolveBtcr2SenderPk` returns `undefined` for an `x1` sender whose genesis document has another first `@context` item. So a service transport of the aggregation package that uses it refuses the opt-in of such a sender.
- Each `@context` message of the method has a rule after the old text. A test that matches the old message as the start of the message still passes. The pattern of `document-not-conformant` in `FAILURE_RULES` matches `Invalid update: the patched document does not conform`, so it does not change.
- The api `createExternalFromDocument` refuses a bad `@context` with the method message. The `data` is the document.

These residuals stay:

- **The URL syntax of a string item.** The check accepts a string item that is not a URL, for example `"not a url"`. Only a JSON-LD processor fails on such an item.
- **The content of a JSON object item.** The check accepts each JSON object as an item, for example `{}`.

**Superseded.**

- ADR 057, decision 1: the check "permits any additional entries (further string contexts or inline object contexts)". The decision also says: "The change deliberately does **not** add a new position constraint (for example, requiring the DID Core context first)". Decision 1 of this ADR requires the DID v1.1 context as the first item. Decision 2 of this ADR permits only a string or a JSON object as an item.
- ADR 057, the rejected alternative "Also require the DID Core context first." Decision 1 of this ADR takes this alternative.
- ADR 148, "Examples": the errors `Invalid "@context"` and `Invalid GenesisDocument "@context"` for a genesis document without `@context`. Decision 5 of this ADR adds the rule `@context must be an array` to each message.
- ADR 148, "Examples": the api `createExternalFromDocument` refuses a genesis document without `@context` with `The genesis document "@context" must include "https://www.w3.org/ns/did/v1.1" and "https://btcr2.dev/context/v1".` Decision 6 of this ADR removes this message.
- ADR 148, decision 4, check 2: "`@context` is an array that contains the two btcr2 contexts. The message is `Invalid GenesisDocument "@context"`." Decisions 1 and 2 of this ADR add the order rule and the kinds rule. Decision 5 of this ADR adds the rule to the message.
- ADR 148, decision 8: the table gives the errors `Invalid "@context"` and `Invalid GenesisDocument "@context"` for a document without `@context`. Decision 5 of this ADR adds the rule `@context must be an array` to each message.
- ADR 148, "Consequences": `createExternalFromDocument` "already refused it with its own check", and "that message does not change". Decision 6 of this ADR removes the api check, so the message changes.
- ADR 149, "Examples": the error `Invalid "@context"` for a DID document without `@context` and with `service: null`. Decision 5 of this ADR adds the rule `@context must be an array` to the message.
- ADR 149, decision 1, check 2 of `DidDocument.isValid`: "`@context` contains the two btcr2 contexts". The message of the check is `Invalid "@context"`. Decisions 1 and 2 of this ADR add the order rule and the kinds rule. Decision 5 of this ADR adds the rule to the message.
- ADR 149, decision 1, check 2 of `validateGenesis`: "`@context` contains the two btcr2 contexts. The message is `Invalid GenesisDocument "@context"`." Decisions 1 and 2 of this ADR add the order rule and the kinds rule. Decision 5 of this ADR adds the rule to the message.
- ADR 156, "Context": "`DidDocument` and the api genesis check read it to check the `@context` of each document." Decision 6 of this ADR removes the api check, so only the method reads the array.

**Unchanged.**

- ADR 057, decision 1: the array can hold other contexts, for example a proof suite context. Decision 3 of this ADR keeps the btcr2 context at any position.
- ADR 108: `createExternalFromDocument` checks the id `did:btcr2:_` and the two contexts. Decision 6 of this ADR adds the order rule and the kinds rule through the method check.
- ADR 148, decision 3: each helper that makes a document writes the two contexts. The helpers write the DID v1.1 context first. Decision 1 of this ADR adds the order as a rule.
- ADR 149, decision 1: `DidDocument.isValid` checks that the document is a JSON object before it checks `@context`. The extra member rules depend on the role. Decision 4 of this ADR adds the same `@context` rules for each role.
- ADR 156, decision 4: `BTCR2_DID_DOCUMENT_CONTEXT` is frozen. Decision 1 of this ADR adds that its first item is also the first item of each valid `@context`.
- ADR 163, decision 3: the api leaves the identifier input checks to the method. Decision 6 of this ADR adds the `@context` check of a genesis document.

## Implementation

- `packages/method/src/utils/did-document.ts`: the private check `contextProblem`, which replaces `isValidContext`; the messages of `isValid` and `validateGenesis`; the JSDoc of `BTCR2_DID_DOCUMENT_CONTEXT`, `isValid`, `validateGenesis`, and `GenesisDocument`.
- `packages/api/src/genesis.ts`: the removal of the `@context` check from `assertGenesisDocument`, and the JSDoc of `assertGenesisDocument`. `packages/api/src/method.ts`: the JSDoc of `createExternalFromDocument`.
- `packages/aggregation/src/participant/participant.ts` and `participant-runner.ts`: the JSDoc of `genesisDocument`.
- Docs: `packages/method/README.md`, `packages/method/docs/aggregation.md`, `packages/cli/docs/create.md`, `packages/cli/docs/identifier.md`, and `packages/cli/docs/resolve.md`.
- Tests:
  - method: `did-document.spec.ts` (each of the first eight example rows on `isValid` and `validateGenesis`, for each role, with the exact message, and the items `true` and `{}`); `resolve-external.spec.ts` (a genesis document with the btcr2 context first); `resolver.spec.ts` ("Apply update": a patch that moves the DID v1.1 context, and a patch that adds `null`); `updater.spec.ts` (`Updater.construct` with the same two patches); the new messages in `did-core-conformance.spec.ts` and `validate-identifier.spec.ts`.
  - api: `genesis.spec.ts` (`createExternalFromDocument` with no `@context`, with only the DID v1.1 context, with the btcr2 context first, and with the item `5`, each with the method message, and the error `data`; six refusals of `buildGenesisDocument` that had no test, and the byte-array branch of the key refusal); `did-method-api.spec.ts` (the new message).

## References

- [DID Core v1.1](https://www.w3.org/TR/did-1.1/), sections 1.4, 6.1, 6.2.3, and 6.3.1.
- did:btcr2 specification: [Conformance](https://dcdpr.github.io/did-btcr2/conformance.html), [DID Document (data structure)](https://dcdpr.github.io/did-btcr2/data-structures.html#did-document), [Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html), [Update](https://dcdpr.github.io/did-btcr2/operations/update.html).
- ADRs 057, 108, 148, 149, 156, 163.
