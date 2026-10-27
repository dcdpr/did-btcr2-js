# ADR 156: Error Messages Print Only Primitive Values, BitcoinApi Refuses Unknown Option Values, the DID Document Context Is Frozen, and dereferenceZcapId Is Removed

- **Status:** Accepted
- **Date:** 2026-10-27
- **Packages:** `@did-btcr2/method` (MINOR: `BTCR2_DID_DOCUMENT_CONTEXT` is frozen and has a `readonly` type; `Appendix.dereferenceZcapId` is removed; an error message prints only a primitive value; `Updater.construct` checks the source document before the patch); `@did-btcr2/api` (MINOR: the `BitcoinApi` constructor refuses three option values with a `MethodError` of type `INVALID_OPTIONS`; an error message prints only a primitive value; the browser bundle holds the method package); `@did-btcr2/cli` (PATCH: six error messages print only a primitive value; dependency uptake through api)

## Context

### An error message converted each value of the caller to text

Many refusals of the method, api, and cli packages put the value of the caller into the message with `String(value)` or a template literal. JavaScript converts an object to text with its `toString` or `valueOf` member. This gave two failure modes:

1. `String()` throws a `TypeError` for an object with no usable `toString` or `valueOf`. Examples are `Object.create(null)` and the JSON value `{"toString":1}`. A JSON parse can give the second value from any input. Thus the refusal threw a raw `TypeError` in place of its typed error. The `TypeError` has no error type, and its text depends on the runtime: Node gives `Cannot convert object to primitive value`, and Bun gives `No default value`.
2. For most other objects, the message held `[object Object]`. This text gives the reader no information.

| Call | Before | After |
|---|---|---|
| `Updater.signingMethod(doc, Object.create(null))` | `TypeError` | `UpdateError` of type `INVALID_DID_UPDATE`: `Invalid verificationMethodId: expected a DID URL or a relative DID URL that starts with "#".` |
| `Updater.signingMethod(doc, 'initialKey')` | `...; got "initialKey".` | No change |
| `DidBtcr2.resolve(did, { versionId: Object.create(null) }).resolve()` | `TypeError` | `ResolveError` of type `INVALID_OPTIONS`: `Invalid resolution option versionId: expected an ASCII string of an integer.` |
| `DidBtcr2.resolve(did, { versionId: {} }).resolve()` | `..., got [object Object].` | `Invalid resolution option versionId: expected an ASCII string of an integer.` |
| `Updater.construct({ ...doc, id: {} }, [], 1)` | `Patches must not change the DID document id (source "[object Object]" to target "[object Object]").` | `Invalid sourceDocument: expected a string id.` |
| `btcr2 config set profiles.p.btc.signalDiscovery '{"toString":1}'` | `TypeError: Cannot convert object to primitive value` and a stack | `Invalid value for profiles.p.btc.signalDiscovery. Expected "indexer" or "fullnode".` |

Three of these refusals implement a rule of the specification. The specification fixes the error type, and a raw `TypeError` has no error type:

- Update, Construct BTCR2 Unsigned Update: "An [`INVALID_DID_UPDATE`] error MUST be raised if `targetDidDocument.id` is not equal to `sourceDidDocument.id`."
- Resolve, Apply `update`: the resolver verifies that `current_document.id` equals `did`. "Otherwise raise [`INVALID_DID_UPDATE`]."
- Resolve: "When provided, `resolutionOptions.versionId` MUST be parsed as an integer and `resolutionOptions.versionTime` SHOULD be parsed as an XML Datetime. Raise an [`INVALID_OPTIONS`] error if either value does not parse."

The specification defines no message text.

### `Updater.construct` gave the wrong reason for an object id

`JSONPatch.apply` makes a JSON copy of the source document (ADR 155). If `sourceDocument.id` is an object, the copy of the id is a new object. Thus the target id never equals the source id, and the id check refused each such update with `Patches must not change the DID document id`. The patch did not change the id. Controlled Identifiers v1.0 section 2.1.1, which DID Core v1.1 uses for the `id` property, says: "The value of id property MUST be a string that conforms to the rules in the URL Standard."

### `BitcoinApi` accepted unknown option values

The `BitcoinApi` constructor did not check two option values:

| Config | Before |
|---|---|
| `{ network: 'regtest', signalDiscovery: 'Fullnode' }` | Accepted. The api read the beacon signals as for `'indexer'`. |
| `{ network: 'regtest', signalDiscovery: null }` | Accepted as `'indexer'`. |
| `{ network: 'toString' }` | The network lookup found the inherited member `Object.prototype.toString`. The transport then threw a raw `TypeError`. |
| `{ network: 'bitcoin', signalDiscovery: 'fullnode' }` with no `rpc` | A plain `Error`. The cli printed it with its stack. |

The cli refuses an unknown `--btc-signal-discovery` value and an unknown network before it makes the api. A JavaScript caller can give any value, for example from a JSON configuration file. The specification does not define the api configuration. DID Resolution defines: "INVALID_OPTIONS: One or more of the options provided for DID Resolution or DID URL dereferencing are invalid."

### The DID document context array was writable

`BTCR2_DID_DOCUMENT_CONTEXT` holds the two context URLs that the specification requires: "`@context`: A context array containing the following context URLs". The method package exports the array. `DidDocument` and the api genesis check read it to check the `@context` of each document. A write to the exported array, for example a `push`, changed the check of each later document in the process.

ADR 148 rejected the alternative "Freeze `BTCR2_DID_DOCUMENT_CONTEXT` and share it". Its reasons: the exported type becomes `readonly`, and "A caller that adds a context to a document then gets a `TypeError`." The second reason applies only if a document holds the shared array. ADR 148 also made each helper write a copy of the array. Thus a freeze makes no document read-only. `BTCR2_UPDATE_CONTEXT` is a frozen array already (ADR 109).

### `Appendix.dereferenceZcapId` implemented a removed algorithm

The JSDoc of `Appendix.dereferenceZcapId` linked `9.4.2 Dereference Root Capability Identifier`. The specification no longer has this algorithm. The function returned `{ id, controller, invocationTarget }` with no `@context`. The specification says: "The Root Capability MUST be a map containing only the following properties". The first property is `@context`.

The function threw a `DidError` of the `@web5/dids` package. No code in the packages, the `lib` scripts, or the tests called it. The resolver compares `proof.capability` by string equality (ADR 112).

### The JSDoc links had section numbers and dead anchors

The JSDoc of the method and common packages named 21 sections of the specification with a number, for example `7.2.e.1 Process CAS Beacon` and `8.c JSON Document Hashing`. The headings of the specification have no numbers, for example `## JSON Document Hashing`. 8 links pointed to anchors that the rendered specification does not have, for example `#didbtcr2-identifier-decoding` on the root page. The method README update example called `new BitcoinConnection({ network: 'mutinynet' })`. That call does not compile: `rest` is a required member.

## Decision

### 1. An error message prints only a primitive value

An error message holds the text of a value of the caller only if the value is a primitive. The primitives are a string, a number, a BigInt, a boolean, a Symbol, `null`, and `undefined`. For an object or a function, the message holds no value. The `data` of the error always holds the value.

The method, api, and cli packages each have an internal function `messageText(value)`. The packages do not export it. It gives `String(value)` for a primitive and `undefined` for an object or a function. It uses `String()` and not a template literal, because a template literal throws a `TypeError` for a Symbol.

The rule applies to these refusals:

- method:
  - `Updater.signingMethod`: the method id and the DID of the root capability
  - `Updater.construct`: the id check
  - `Updater`: the `NeedFunding` check
  - `DidBtcr2.update`: the `sourceVersionId` check
  - the resolver: the `minConf`, `versionId`, and `versionTime` checks, and the id check of `Resolver.applyUpdate`
- api:
  - the `announce.feeRate` check
  - the genesis document builder: the relationship, beacon type, and address type checks
  - `verifyMessage`: the method type and controller texts. These texts are the `detail` of a failed check, so no `data` holds the value.
- cli:
  - `config set` and `config validate`: the three enum checks
  - the `--source-document` id check
  - the version checks of the keystore file and of the secret envelope

Each message keeps its prefix, except the method type text of `verifyMessage`. The resolver keeps the prefix `Invalid update: the patched document id is not the DID`. A string value of a resolution option still prints in quotes, for example `got "x"`.

### 2. `Updater.construct` checks the source document before the patch

After the `sourceVersionId` check, `Updater.construct` checks the source document:

1. `sourceDocument` must be a JSON object. Else the message is `Invalid sourceDocument: expected a DID document object.`, and `data.sourceDocument` holds the value.
2. `sourceDocument.id` must be a string. Else the message starts with `Invalid sourceDocument: expected a string id`. For a primitive id, `; got <value>.` follows. `data.sourceId` holds the value.

Each refusal is an `UpdateError` of type `INVALID_DID_UPDATE`. The check does not test the `did:btcr2:` prefix. `Updater.signingMethod` tests the prefix before the signature.

### 3. The `BitcoinApi` constructor refuses unknown option values

The constructor checks the options in this order:

1. `signalDiscovery` must be `undefined`, `'indexer'`, or `'fullnode'`. `undefined` gives `'indexer'`. The message is `` `signalDiscovery` must be 'indexer' or 'fullnode' ``, and `; got '<value>'.` follows for a primitive. This check runs first, so a value such as `'Fullnode'` cannot act as `'indexer'`.
2. The network must be a string and an own key of `DEFAULT_BITCOIN_NETWORK_CONFIG`. The check uses `Object.hasOwn`, so an inherited member such as `toString` is not a network. The message is `Unknown Bitcoin network '<value>'. Available: ...`, with no value for an object.
3. `'fullnode'` needs an RPC config for the network. The message does not change.

Each refusal is a `MethodError` of type `INVALID_OPTIONS`, and `data` holds the values. The constructor serves the read path and the write path, so one error class fits each refusal. The api does not change a value, for example `'Fullnode'` to `'fullnode'` (the rule of ADR 150, decision 1).

`createApi` makes the `BitcoinApi` at the first access of `api.btc` or `api.btcr2`. Thus that access throws the refusal. `resolveDid` throws the `MethodError`, and `tryResolveDid` gives the error `INVALID_OPTIONS`. The cli prints the `'fullnode'` refusal as one line, with no stack.

### 4. `BTCR2_DID_DOCUMENT_CONTEXT` is frozen

The array is `Object.freeze([...] as const)`. Its type is the `readonly` tuple of the two URLs. A write to the array throws a `TypeError` in strict mode. Each document holds its own copy of the array, as before. The JSDoc of the constant links the DID Document data structure of the specification.

### 5. `Appendix.dereferenceZcapId` is removed

`Appendix.deriveRootCapability(did)` gives the Root Capability of a DID, with the four properties of the specification. Its JSDoc now links the Root Capability data structure, and its example `id` is encoded: `urn:zcap:root:did%3Abtcr2%3Ak1...`. `appendix.ts` no longer imports `DidError` and `DidErrorCode`.

### 6. Each JSDoc link names the section without a number

Each label loses its number. Six links to dead anchors now point to the current pages. The two other dead links go: decision 5 removes `dereferenceZcapId`, and the JSDoc of the `Appendix` class no longer links the specification. One link changes from `http` to `https`. The method README example sets `rest: { host: 'https://mutinynet.com/api' }`, and `docs/beacon-system-overview.md` links two sections by name.

### 7. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| A message prints a primitive value and no object value. `data` holds each value. | Update and Resolve (the three texts above) fix the error type. The specification defines no message text. | Conforms. Each refusal gives its error type for each value. |
| `Updater.construct` refuses a source id that is not a string. It does not test the `did:btcr2:` prefix. | Update: "An [`INVALID_DID_UPDATE`] error MUST be raised if `targetDidDocument.id` is not equal to `sourceDidDocument.id`." CID 2.1.1: "The value of id property MUST be a string that conforms to the rules in the URL Standard." | Conforms. A string id compares by value after the JSON copy. `Updater.signingMethod` tests the prefix before the signature. |
| `DidBtcr2.update` keeps its own `sourceVersionId` message, with the primitive value. | The specification defines no message text. | Conforms. The error type stays `INVALID_DID_UPDATE`. |
| The `BitcoinApi` refusals are a `MethodError` of type `INVALID_OPTIONS`. | DID Resolution: "INVALID_OPTIONS: One or more of the options provided for DID Resolution or DID URL dereferencing are invalid." | Conforms. The specification does not define the api configuration. `INVALID_OPTIONS` has the nearest meaning. |
| `Appendix.dereferenceZcapId` is removed. | Data Structures: "The Root Capability MUST be a map containing only the following properties". Resolve: "Implementations MAY derive a [Root Capability (data structure)] from `update.proof` and invoke it according to Authorization Capabilities for Linked Data v0.3" | Conforms. `Appendix.deriveRootCapability` gives the data structure. The derivation is optional. |
| The two common labels `8.c JSON Document Hashing` lose the number. | Algorithms: `## JSON Document Hashing`. | Conforms. The heading has no number. |
| The JSDoc of the `Appendix` class has no link to the specification Appendix. | The Appendix of the specification holds `BTCR2 Update Aggregation`, `Optimized Sparse Merkle Tree Implementation`, `Privacy Considerations`, and `Security Considerations`. | Conforms. The Appendix of the specification holds no function of the class. |
| `docs/beacon-system-overview.md` links `Find Beacon Signals` and `Announce DID Update` in place of `7.2.e.1` and `8.2`. | Resolve: `## Find Beacon Signals { #find-beacon-signals }`. Update: `## Announce DID Update`. | Conforms. The sections hold the algorithms that the page describes. |

## Alternatives

- **Put the value only into `data` at each refusal.** Rejected. A typo such as `initialKey` in place of `#initialKey` then gives no hint in the cli message.
- **Print the value with `JSON.stringify`.** Rejected. `JSON.stringify` throws for a BigInt and for a cycle. It also runs a `toJSON` member of the caller, and the message can get very long.
- **Catch the `TypeError` of `String()`.** Rejected. The message then holds `[object Object]` for most objects. A `toString` member of the caller still runs.
- **Export one function from the common package.** Rejected. The function has four lines, and a common export makes it a public API. The api exports as little as possible (ADR 132). The cli does not depend on the common package.
- **Keep a plain `Error` for the two other `BitcoinApi` refusals.** Rejected. One constructor then gives two error classes for one kind of fault.
- **Use a `ResolveError` for the `BitcoinApi` refusals.** Rejected. The constructor serves the write path too.
- **Keep `Appendix.dereferenceZcapId` and fix it.** Rejected. A fix decodes the URN and returns `Appendix.deriveRootCapability(did)`, with a typed error for a bad id. No code calls the function, and `deriveRootCapability` already gives the data structure.
- **Share the frozen array in each document.** Rejected, as in ADR 148. A caller that adds a context to a document then gets a `TypeError`.
- **Test the `did:btcr2:` prefix in `Updater.construct`.** Rejected. The Construct BTCR2 Unsigned Update step has no prefix rule. `Updater.signingMethod` tests the prefix before the signature.

## Consequences

- The method and api packages get a MINOR release. The cli gets a PATCH release. The common package gets no release, because only two JSDoc labels change.
- A refusal with an object value now gives its typed error, also for an object with no usable `toString`. Except for the checks of decision 2, a refusal with a primitive value gives the same message as before. A caller that matches the full message of a refusal with an object value must change its code.
- The `BitcoinApi` constructor refuses `signalDiscovery` values that it accepted before. The network refusal and the `'fullnode'` refusal change from a raw `TypeError` or a plain `Error` to a `MethodError` of type `INVALID_OPTIONS`.
- A TypeScript caller that writes to `BTCR2_DID_DOCUMENT_CONTEXT` gets a compile error. A caller that gives the array where the type `string[]` is necessary also gets a compile error and must copy the array.
- A caller of `Appendix.dereferenceZcapId` must call `Appendix.deriveRootCapability` with the DID.
- A resolution result changes only for an object with no usable `toString`. The raw `TypeError` gave `INTERNAL_ERROR` in `tryResolveDid`, and the typed error now gives `INVALID_OPTIONS` or `INVALID_DID_UPDATE`. For each other input, only the message of an object value changes. No test vector holds such a value.
- A link check of the JSDoc against the rendered specification gives 49 links that work and 0 dead links. Before this change, it gave 41 links that work and 8 dead links.
- The rule does not cover each message yet. These sites stay:
  - the `@internal` `Updater` constructor
  - `Appendix.absoluteDidUrl` with an object DID
  - the text of a thrown value that is not an `Error`, for example in `errorCause`
  - template literals of values that an earlier check makes strings
- `Updater.provide` of `NeedFunding` with `null` throws a raw `TypeError` on `proof.utxoCount`.

**Superseded.**

- ADR 148, the alternative "Freeze `BTCR2_DID_DOCUMENT_CONTEXT` and share it": the freeze part only. Decision 4 of this ADR freezes the array. The share part stays rejected.
- ADR 112, the text "`Appendix.dereferenceZcapId` stays as a public utility". Decision 5 of this ADR removes the function.

**Unchanged.**

- ADR 085: each refusal is a typed error.
- ADR 109: `BTCR2_UPDATE_CONTEXT` is frozen, and each update holds a copy.
- ADR 112: the resolver compares `proof.capability` by string equality and does not derive the Root Capability.
- ADR 148: each helper writes a copy of `BTCR2_DID_DOCUMENT_CONTEXT` into a document.
- ADR 150, decision 3: the `publishToCas` message holds no value. Decision 1 of this ADR applies the same reason to the `feeRate` message, which now holds only a primitive value.
- ADR 155: `JSONPatch.apply` makes a JSON copy of the source document.

## Implementation

- `packages/method/src/utils/message-text.ts`, `packages/api/src/helpers.ts`, `packages/cli/src/message-text.ts`: `messageText`.
- `packages/method/src/core/updater.ts`: the source document checks of `construct`, the messages of `absoluteMethodId`, `construct`, `signingMethod`, and the `NeedFunding` check, and the JSDoc links.
- `packages/method/src/core/resolver.ts`: `gotValue` in place of `shown`, the id message of `applyUpdate`, and the JSDoc links.
- `packages/method/src/did-btcr2.ts`: the `sourceVersionId` message and the JSDoc links.
- `packages/method/src/utils/did-document.ts`: the frozen `BTCR2_DID_DOCUMENT_CONTEXT` and its JSDoc.
- `packages/method/src/utils/appendix.ts`: `dereferenceZcapId` removed, the JSDoc of the class and of `deriveRootCapability`.
- `packages/method/src/core/identifier.ts`, `packages/method/src/core/beacon/cas-beacon.ts`, `packages/method/src/core/beacon/smt-beacon.ts`, `packages/common/src/canonicalization.ts`: the JSDoc links.
- `packages/api/src/bitcoin.ts`: the three refusals and their JSDoc. `packages/api/src/api.ts`: the `@throws` tags of `btc` and `btcr2`. `packages/api/src/types.ts`: the JSDoc of `signalDiscovery`.
- `packages/api/src/method.ts`, `packages/api/src/genesis.ts`, `packages/api/src/message.ts`: the messages.
- `packages/cli/src/config-schema.ts`, `packages/cli/src/commands/write.ts`, `packages/cli/src/keystore/envelope.ts`, `packages/cli/src/keystore/file-key-store.ts`: the messages.
- Tests: `message-text.spec.ts` in method and cli, `updater.spec.ts`, `resolver.spec.ts`, `did-document.spec.ts`, `bitcoin-api.spec.ts`, `helpers.spec.ts`, `genesis.spec.ts`, `did-btcr2-api.spec.ts`, `did-method-api.spec.ts`, `did-method-api-message.spec.ts`, `did-method-api-cas-policy.spec.ts`, `did-method-api-offline-steps.spec.ts`, `config-schema.spec.ts`, `envelope.spec.ts`, `file-key-store.spec.ts`, and `update.spec.ts`.
- Docs: `packages/method/README.md`, `packages/method/docs/beacon-system-overview.md`, `packages/api/README.md`, and `packages/cli/docs/resolve.md`.

## References

- [did:btcr2 specification, Construct BTCR2 Unsigned Update](https://dcdpr.github.io/did-btcr2/operations/update.html#construct-btcr2-unsigned-update), [Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html), [Apply `update`](https://dcdpr.github.io/did-btcr2/operations/resolve.html#apply-update), [DID Document](https://dcdpr.github.io/did-btcr2/data-structures.html#did-document), and [Root Capability](https://dcdpr.github.io/did-btcr2/data-structures.html#root-capability).
- [DID Resolution v1.0](https://www.w3.org/TR/did-resolution/): the Errors section.
- [Controlled Identifiers v1.0](https://www.w3.org/TR/cid-1.0/), section 2.1.1, and [DID Core v1.1](https://www.w3.org/TR/did-1.1/), section 5.1.1.
- [ADR 085](085-typed-error-policy.md): typed errors.
- [ADR 109](109-btcr2-update-carries-the-pinned-context-array.md): the frozen update context.
- [ADR 112](112-update-paths-check-the-proof-fields-and-apply-the-patch-strictly.md): the proof field checks.
- [ADR 132](132-the-api-exports-only-its-facade-and-a-sub-facade-function-does-each-crud-step.md): the api exports.
- [ADR 148](148-did-document-adds-no-member-so-context-is-required-and-verificationmethod-and-service-are-optional.md): the context copy and the freeze alternative.
- [ADR 150](150-the-api-refuses-an-unknown-publishtocas-value-and-each-option-refusal-has-the-type-invalid-options.md): the api option refusals.
- [ADR 155](155-jsonpatch-applies-the-rules-of-rfc-6901-and-rfc-6902-with-its-own-engine-and-accepts-each-member-name.md): the JSON copy of `JSONPatch.apply`.
