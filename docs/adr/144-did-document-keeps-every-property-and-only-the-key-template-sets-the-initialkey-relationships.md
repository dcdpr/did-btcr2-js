# ADR 144: DidDocument Keeps Every Property, and Only the KEY Template Sets the `#initialKey` Relationships

- **Status:** Accepted
- **Date:** 2026-10-08
- **Packages:** `@did-btcr2/method` (MINOR: `DidDocument` keeps every property of its input; the constructor adds no `#initialKey` relationship to a `k1` document); `@did-btcr2/api` (PATCH: the browser bundle holds the method package, and a resolved `x1` document keeps every genesis property)

## Context

### The resolver dropped genesis properties

The specification (Resolve, "If `genesis_bytes` is a SHA-256 Hash") says: "Process the Genesis Document provided in `sidecar.genesisDocument` by replacing the identifier placeholder (`"did:btcr2:_"`) with the `did`. A simple string replacement is sufficient. Parse the result as JSON to form `current_document`."

`Resolver.external` did the replacement and the parse. Then it returned `new DidDocument(currentDocument)`. The constructor set only nine properties: `id`, `@context`, `verificationMethod`, `service`, `deactivated`, and the four verification relationships. `toJSON` returned only these nine properties. Thus the resolver dropped each other property of the genesis document, for example `alsoKnownAs`, `controller`, `keyAgreement`, or an extension property.

The specification (Data Structures, DID Document) says: "A DID document is a map data structure defined by the DID core v1.1 specification." Its list of optional properties ("It can optionally include one or more of the following properties") is not a closed list.

The hash of the resolved document was not the hash of the specification `current_document`. Example: the genesis document has `"alsoKnownAs": ["https://example.com/alice"]`.

| | Resolved document | Document hash |
|---|---|---|
| Specification | has `alsoKnownAs` | hash A |
| This library | no `alsoKnownAs` | hash B |

Each update states the hash of the document that it changes (`sourceHash`). Thus:

1. A first update from a conformant implementation has `sourceHash` A. The resolver of this library refused it with `INVALID_DID_UPDATE`.
2. A first update from this library has `sourceHash` B. A conformant resolver refuses it.

The DID itself did not change: the genesis bytes are the hash of the raw genesis document. After an update, the document is a JSON copy (`JSONPatch.apply` clones it), so a property that an update adds stays. Only the properties of the genesis document were lost.

### The constructor added `#initialKey` relationships

The constructor tested `id.includes('k1')`. For a `k1` id, it set each absent relationship to `[<id>#initialKey]`. The specification has these four relationships in one place only: the template of "If `genesis_bytes` is a secp256k1 Public Key". The constructor also added them to a `k1` document after an update removed a relationship, for example through `DidDocumentBuilder.build`. The hash of that document then changed. The resolver does not construct a `DidDocument` after a patch, so resolution results were correct.

## Decision

### 1. The constructor keeps every property

The constructor copies each own property of the input to the instance. Then it sets the defaults of `verificationMethod`, `service`, and `@context` as before. `toJSON` returns every own property of the instance (`{ ...this }`).

The class fields set the order of the nine named properties. Thus the JSON of a document with no other properties does not change. The other properties come after them.

### 2. The copy uses `Object.defineProperty`

`JSON.parse` makes a `"__proto__"` key an own property. An assignment `this[key] = value` with this key replaces the prototype of the instance. `Object.defineProperty` keeps the property as data, and the instance stays a `DidDocument`.

### 3. Only the KEY template sets the `#initialKey` relationships

The constructor adds no relationship. `DidDocument.fromKeyIdentifier` sets `authentication`, `assertionMethod`, `capabilityInvocation`, and `capabilityDelegation` to `[<did>#initialKey]`. `Resolver.deterministic` calls `fromKeyIdentifier`. Thus the code has one KEY template, and the equality of [ADR 122](122-api-exports-vector-tool-steps-and-smt-rejects-empty-sibling-in-hashes.md) (`fromKeyIdentifier` equals `Resolver.deterministic`) holds by construction.

### 4. `deactivated` does not change

The copy keeps `deactivated` as the input holds it. The separate assignment of [ADR 142](142-the-deactivation-checks-use-strict-equality-and-did-document-keeps-the-deactivated-property.md) goes, and its rule stays.

## Alternatives

- **Return the parsed object from `Resolver.external`, with no class.** Rejected. The defaults of `@context`, `verificationMethod`, and `service` then also change in this step. Those defaults are separate gaps with their own decisions. The return type of `Resolver.external` also changes.
- **Copy with `Object.assign`.** Rejected. `Object.assign` uses assignment, so a `"__proto__"` property replaces the prototype.
- **Find the KEY type from the decoded identifier, not from the text `k1`.** Rejected. The constructor then still adds back a relationship that an update removed. The specification has the four relationships only in the KEY template.

## Consequences

- A resolved `x1` document keeps every genesis property. Its hash is the hash of the specification `current_document`. A first update over such a document resolves the same in each conformant implementation.
- An update that the api makes for such a DID has the `sourceHash` of the full document.
- `new DidDocument(...)` and `DidDocumentBuilder.build()` for a `k1` id with no relationships give a document with no relationships. A caller that needs the KEY template must call `DidDocument.fromKeyIdentifier`. This changes the behavior of a public class, so method gets a MINOR release.
- The test vectors do not change. No genesis document in `packages/api/lib/data` has another property. The other properties in the vectors come from update patches.
- `toIntermediate` still tests `id.includes('k1')`. For a valid did:btcr2 id, this test gives the identifier type, because `1` is not a bech32 data character.
- The defaults of `@context`, `verificationMethod`, and `service` do not change.

## Implementation

- `packages/method/src/utils/did-document.ts`: the constructor, `toJSON`, and `fromKeyIdentifier`.
- `packages/method/src/core/resolver.ts`: `Resolver.deterministic` calls `DidDocument.fromKeyIdentifier`.
- `packages/method/tests/did-document.spec.ts`: the tests "DidDocument properties (ADR 144)", and the four relationships in the `fromKeyIdentifier` test.
- `packages/method/tests/resolver.spec.ts`: the test "genesis properties that DidDocument does not name (ADR 144)".

## References

- [did:btcr2 specification, Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html): "If `genesis_bytes` is a SHA-256 Hash" and "If `genesis_bytes` is a secp256k1 Public Key".
- [did:btcr2 specification, DID Document](https://dcdpr.github.io/did-btcr2/data-structures.html#did-document).
- [DID Core v1.1](https://www.w3.org/TR/did-1.1/).
- [ADR 122](122-api-exports-vector-tool-steps-and-smt-rejects-empty-sibling-in-hashes.md): `fromKeyIdentifier` equals `Resolver.deterministic`.
- [ADR 142](142-the-deactivation-checks-use-strict-equality-and-did-document-keeps-the-deactivated-property.md): `DidDocument` keeps the `deactivated` property.
