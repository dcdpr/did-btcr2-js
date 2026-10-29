# ADR 163: Each Input Fault of Identifier Encoding and Decoding Gives INVALID_DID, and the api Leaves the Identifier Input Checks to the Method

- **Status:** Accepted
- **Date:** 2026-10-29
- **Packages:** `@did-btcr2/method` (MINOR: `Identifier.encode` refuses an inherited `idType` and `genesisBytes` that are not a `Uint8Array`; `DidBtcr2.create` requires `options` and delegates to `Identifier.encode`; the decode outputs declare `network` as a name of `BitcoinNetworkNames`; new message text for genesis bytes); `@did-btcr2/api` (MINOR: the identifier paths give the `IdentifierError` of the method, not a plain `Error`; `did.validate` returns a report for a value that is not a string; `did.decode` and `did.validate` declare `network` as a name of `BitcoinNetworkNames`; `updateDid('')` and `deactivateDid('')` reject with a typed cause; the browser bundle holds the method package); `@did-btcr2/cli` (PATCH: dependency uptake through api)

## Context

### The specification

The section "DID-BTCR2 Identifier Encoding" of the specification says: "Any errors encountered during this algorithm MUST raise an [`INVALID_DID`] error." The section "DID-BTCR2 Identifier Decoding" has the same sentence. About the input `key_or_hash`, the encoding section says: "`key_or_hash` MUST be one of the supported [Genesis Bytes] variants defined in the Terminology chapter and MUST be representable as a 33-byte secp256k1 public key or a 32-byte SHA-256 hash. Implementations SHOULD require `key_or_hash` to include additional type information that clearly distinguishes between the supported [Genesis Bytes] variants."

The Create operation says: "These three values are encoded with the [DID-BTCR2 Identifier Encoding] algorithm." The Resolve operation says: "An [`INVALID_DID`] error MUST be raised in response to any errors raised while decoding."

About the network, the encoding section says: "Implementations SHOULD require `network_name` to include additional type information using symbolic names that MUST be representable as integer values listed in the following table:". The decoding section says: "`network_name` SHOULD be returned to the caller including additional type information using symbolic names that can be represented as integer values."

### The encoder accepted wrong input

`Identifier.encode` checked `idType` with the `in` operator. The `in` operator also finds a name that an object inherits. Thus the `idType` values `toString`, `constructor`, `__proto__`, and `hasOwnProperty` gave the same `x1` DID as `EXTERNAL`.

`Identifier.encode` did not check that `genesisBytes` is a `Uint8Array`. For `EXTERNAL`, it checked only the `length`, and then copied each item into a `Uint8Array`. The results:

| `genesisBytes` | `idType` | Result |
|---|---|---|
| `'a'.repeat(32)` | `EXTERNAL` | The DID of 32 zero bytes |
| `Array(32).fill(257)` | `EXTERNAL` | The DID of 32 bytes of `0x01` |
| `new Uint16Array(32).fill(300)` | `EXTERNAL` | The DID of 32 bytes of `0x2c` |
| A hex string of 66 characters | `KEY` | `TypeError: Length 116 exceeds limit 90` |
| `undefined`, `{ length: 32 }` | `EXTERNAL` | `TypeError` |

`Identifier.encode(bytes, undefined)` gave a `TypeError`, because it read the members of `undefined`.

### `DidBtcr2.create` gave another error type

`DidBtcr2.create(genesisBytes, options?)` refused a call with no `idType` with a `MethodError` of type `INVALID_DID_DOCUMENT`. `Identifier.encode` refused the same input with `INVALID_DID`. The JSDoc said that `idType` defaults to `'KEY'`, but no default existed. No test reached this check.

### The api checked the input first, with a plain `Error`

The api checked the input before it called the method:

- `assertString`, `assertBytes`, or `assertCompressedPubkey` on `did.encode`, `did.decode`, `btcr2.createDeterministic`, `btcr2.createExternal`, `createDid`, `btcr2.getInitialDocument`, and the source resolution of `updateDid` and `deactivateDid`.
- A `typeof` check on `did.validate`.

These checks threw a plain `Error` with no type. For example, `api.did.decode('')` threw `did must be a non-empty string.` For the same input, `Identifier.decode('')` gives an `IdentifierError` of type `INVALID_DID`. The api also threw for `did.validate(42)`, but ADR 107 says that validate "never throws on an invalid identifier".

`updateDid('x')` rejected with `Failed to resolve DID x: Invalid did: x` and a cause of type `INVALID_DID`. `updateDid('')` rejected with `source must be a non-empty string.` and no cause.

### The decode output declared the network as `string`

`IdentifierComponents.network` had the type `string`. Thus `BitcoinNetworkNames[components.network]` did not compile in strict mode (`TS7015`). The api `#networkMismatch` also declared the network as `string | number` and had a branch for a custom network that decodes to a number. ADR 107 removed custom networks.

### The decode messages held the genesis bytes

`Identifier.decode` refused invalid genesis bytes with `Invalid genesisBytes: ${genesisBytes}`. The message held the bytes as a comma list, for example `Invalid genesisBytes: 2,3,3,3,...`. ADR 156, decision 1, says: "For an object or a function, the message holds no value."

## Decision

### 1. `Identifier.encode` checks each input

`Identifier.encode(genesisBytes, options)` does these checks. Each failure is an `IdentifierError` of type `INVALID_DID`.

1. `options` can be `undefined` or `null`. The encoder then reads no values from it, and the `idType` check refuses the call.
2. `idType` must be `KEY` or `EXTERNAL`. The check compares with the two values, so an inherited name fails.
3. `version` must be 1, and `network` must be a name of `BitcoinNetworkNames`. These checks do not change (ADRs 062 and 118).
4. `genesisBytes` must be a `Uint8Array`. A `Buffer` passes. A hex string, a plain array of numbers, and another typed array fail.
5. For `KEY`, `genesisBytes` must have 33 bytes, and the bytes must be a valid compressed secp256k1 public key. The length message is `Expected "genesisBytes" to be a 33-byte compressed secp256k1 public key, got <n> bytes`. The message for 33 bytes that are not a valid compressed secp256k1 public key does not change.
6. For `EXTERNAL`, `genesisBytes` must have 32 bytes. The message is `Expected "genesisBytes" to be a 32-byte hash for EXTERNAL identifiers, got <n> bytes`.

`idType` stays required. The encoder does not infer it from the length, because the specification says that implementations "SHOULD require `key_or_hash` to include additional type information".

### 2. `DidBtcr2.create` delegates to `Identifier.encode`

The signature is `DidBtcr2.create(genesisBytes, options: DidCreateOptions)`. The `options` parameter is required in TypeScript. The function calls `Identifier.encode(genesisBytes, options)` and does no check of its own. `Identifier.encode` sets the defaults of `version` (1) and `network` (`bitcoin`). A JavaScript call with no options gets `INVALID_DID` through decision 1, check 1.

### 3. The api leaves the identifier input checks to the method

The api removes its checks from these paths:

- `did.encode`, `btcr2.createDeterministic`, `btcr2.createExternal`, and `createDid`: the method checks the genesis bytes.
- `did.decode` and `btcr2.getInitialDocument`: `Identifier.decode` refuses `''` and a value that is not a string with `INVALID_DID` (ADR 157, decision 6, checks 1 and 2). The one exception is a valid DID of another method: it gives `METHOD_NOT_SUPPORTED` (ADR 157).
- `did.validate`: the api passes each value to `Identifier.validate`, which returns a report. `validate(42)` gives `valid: false` and a failed `prefix` check.
- The source resolution of `updateDid` and `deactivateDid`: a DID source of `''` goes to `resolveDid`. The call rejects with `Failed to resolve DID` and a cause of type `INVALID_DID`, as `updateDid('x')` does (ADR 097).

The helpers `assertString`, `assertBytes`, and `assertCompressedPubkey` stay for the other api inputs. Examples are a key pair, a KMS input, an SMT leaf, a Bitcoin api input, and the DID of `rootCapability`. No decoding algorithm applies to these inputs, so `INVALID_DID` is not the correct type for them.

### 4. The decode outputs declare the network as a name of `BitcoinNetworkNames`

The type of `IdentifierComponents.network`, `DidComponents.network`, and `IdentifierReport.network` is `keyof typeof BitcoinNetworkNames`. Thus `BitcoinNetworkNames[Identifier.decode(did).network]` compiles and gives the network value of the identifier. The values at run time do not change.

The encode inputs `DidCreateOptions.network` and `DidCreateOptions.idType` keep the type `string`. The run-time checks of decision 1 refuse an invalid value.

The api `#networkMismatch` declares the network as `DidComponents['network']`. The change removes the branch for a network that decodes to a number, and the JSDoc sentence about it.

### 5. The genesis bytes messages hold no bytes

`Identifier.decode` refuses the genesis bytes of a `k` identifier with `Invalid genesisBytes: expected a 33-byte compressed secp256k1 public key`. It refuses the genesis bytes of an `x` identifier with `Invalid genesisBytes: expected 32 bytes, got <n> bytes`. The `data` of each error keeps `{ identifier }`.

### 6. `rootCapability` does not change

`api.btcr2.rootCapability('')` still throws a plain `Error`. The function does not decode the DID. The specification defines the members of a Root Capability, but no error rule for its derivation. A check that refuses each invalid DID is a new refusal with no rule in the specification.

### 7. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| The api removes its checks, and the method gives the error (decision 3). | Identifier Encoding and Identifier Decoding: "Any errors encountered during this algorithm MUST raise an [`INVALID_DID`] error." | Conforms. The specification names no layer. With two checks, one fault had two messages and two error types. |
| The length messages give the length, and the message for a key that is not valid stays (decisions 1 and 5). | The specification defines no message text. ADR 156, decision 1: a message holds only a primitive value. | Conforms. |
| `Identifier.encode(bytes, undefined)` gives `INVALID_DID` (decision 1, check 1). | Identifier Encoding: "Any errors encountered during this algorithm MUST raise an [`INVALID_DID`] error." | Conforms. ADR 157, decision 6, check 1, applies the same rule to decode. |
| The bytes check is `instanceof Uint8Array` (decision 1, check 4). | Identifier Encoding: "`key_or_hash` MUST be one of the supported [Genesis Bytes] variants defined in the Terminology chapter and MUST be representable as a 33-byte secp256k1 public key or a 32-byte SHA-256 hash." The Terminology chapter defines Genesis Bytes as "The bytes used to generate a **did:btcr2** identifier." | Conforms. Each MUST constrains the value. "Representable as" does not require the encoder to convert a hex string or an array of numbers. |
| `idType` stays required (decision 1). | Identifier Encoding: "Implementations SHOULD require `key_or_hash` to include additional type information that clearly distinguishes between the supported [Genesis Bytes] variants." | Conforms. An inference from the length does not follow the SHOULD. |
| `DidBtcr2.create` requires `options` and delegates (decision 2). | Create: "These three values are encoded with the [DID-BTCR2 Identifier Encoding] algorithm." | Conforms. Create applies only the encoding algorithm. The one-argument call always threw. |
| `did.validate` returns a report for each value (decision 3). | The specification has no validate operation. ADR 107: validate "never throws on an invalid identifier", and the api delegates. | Conforms. |
| A DID source of `''` goes to the resolution (decision 3). | Resolve: "An [`INVALID_DID`] error MUST be raised in response to any errors raised while decoding." | Conforms. ADR 097: the failure carries its root cause. |
| Only the decode outputs get the name type (decision 4). | Identifier Decoding: "`network_name` SHOULD be returned to the caller including additional type information using symbolic names that can be represented as integer values." Identifier Encoding: "Implementations SHOULD require `network_name` to include additional type information". | Conforms. Each text is a SHOULD. The decode output gets the declared type. The encode inputs get a run-time check of the symbolic name. |
| `#networkMismatch` loses the number branch (decision 4). | ADR 107: "`DidComponents.network` is always a network name." The specification has no text. | Conforms. |
| `rootCapability` does not decode the DID (decision 6). | Data Structures (Root Capability): "`invocationTarget`: MUST be the `did`." "`controller`: MUST be the `did`." | Conforms. The specification defines no error rule and no derivation algorithm. |

## Alternatives

**Keep the api checks and give them the type `INVALID_DID`.** Rejected. One fault then has two checks and two messages. The method message also holds the length, so the api check adds nothing.

**Convert a hex string or a plain array of numbers in `Identifier.encode`.** Rejected. The TypeScript type is `Uint8Array`, and a conversion guesses the meaning of the caller. A plain array with values above 255 gave other bytes than the caller gave.

**Infer `idType` from the length of `genesisBytes`.** Rejected. The specification says that implementations "SHOULD require" the type information.

**Keep `options?` in `DidBtcr2.create` and cast `idType`.** Rejected. A call with no options always threw, so the optional type has no use. The required type tells the caller about the fault at compile time.

**Also narrow the encode inputs: `DidCreateOptions.network` to the name union, and `DidCreateOptions.idType` to `'KEY' | 'EXTERNAL'`.** Rejected. The change applies the two encode SHOULDs at compile time. It also changes more callers, for example the api `#networkOption` and the three `Identifier.encode` calls of `Resolver`. The run-time check already refuses each value that is not a symbolic name.

**No type change.** Rejected. A caller cannot write `BitcoinNetworkNames[network]` with the decoded network without a cast.

**`rootCapability` decodes the DID first.** Rejected. The function is not a write and holds no data of the api. The refusal has no rule in the specification.

## Consequences

- The method and api packages get a MINOR release. The cli gets a PATCH release for the dependency uptake. The cli output does not change. The cli checks the hex text and the length before it calls the api. It never gives `''` to `updateDid` or to an api decode path. `resolveRef` and `assertValidIdentifier` refuse `''` first.
- The aggregation package gets no release from this change. `method` is only a devDependency of aggregation.
- A JavaScript caller that gave a plain array of byte values for an `EXTERNAL` identifier to `Identifier.encode` or `DidBtcr2.create` got a correct DID before. The call now fails with `INVALID_DID`.
- `instanceof Uint8Array` refuses a `Uint8Array` of another realm, for example of an iframe or a `vm` context. The api `assertBytes` had the same rule, so an api caller sees no change. A method caller in another realm now gets `INVALID_DID`. `Identifier.validate` has the same rule.
- A TypeScript caller that builds `DidComponents` from a `string` variable gets `TS2322`. The callers in the repository use literal values or `Identifier.decode`.
- The message for `updateDid('')` is `Failed to resolve DID : Invalid did: `. The empty DID leaves a space before the first colon, and the message ends with a space. The message format of ADR 097 gives this text.

These residuals stay:

- `api.btcr2.rootCapability('')` throws a plain `Error` (decision 6). `rootCapability('\uD800')` throws a raw `URIError` from `encodeURIComponent`.
- `getInitialDocument` of an `x` DID with no genesis document throws a plain `Error`. It is not an identifier input fault.
- The api, bitcoin, and cli packages still hold other plain errors. ADR 085 records the change of these errors to typed errors as follow-up work.

**Superseded.**

- ADR 009, the line "Input validation at public boundaries: `assertString()`, `assertBytes()`, `assertCompressedPubkey()`." For the create, encode, decode, initial-document, and update-source paths, the api no longer calls these helpers. `Identifier.encode` and `Identifier.decode` check the input (decision 3).

**Unchanged.**

- ADR 062: the version and network checks of `Identifier.encode`.
- ADR 085: the lint scope, and the change of the other plain errors to typed errors as follow-up work. Decision 3 of this ADR adds the typed errors of the identifier paths.
- ADR 097: the update-source failure carries its root cause.
- ADR 107: `validate` never throws on an invalid identifier, the api delegates, and the network is always a name. Decision 3 of this ADR adds the report for a value that is not a string.
- ADR 118: `Identifier.encode` refuses a network value whose enum lookup is not a number.
- ADR 156, decision 1: a message holds only a primitive value. Decision 5 of this ADR adds the decode messages of the genesis bytes.
- ADR 157, decision 6: the decode order. Decision 3 of this ADR adds each api decode path.
- ADR 157, decision 7: `tryResolveDid` gives `INVALID_DID` for a value that is not a string.

## Implementation

- `packages/method/src/core/identifier.ts`: the `idType` and `Uint8Array` checks, `options ?? {}`, and the length messages in `encode`; the decode messages; the `network` type of `IdentifierComponents` and `IdentifierReport`, and the casts in `decode` and `validate`; JSDoc.
- `packages/method/src/did-btcr2.ts`: `create` requires `options` and calls `Identifier.encode`; JSDoc; the change removes the imports of `MethodError` and `INVALID_DID_DOCUMENT`.
- `packages/api/src/did.ts`: the change removes the checks of `encode`, `decode`, and `validate`; JSDoc.
- `packages/api/src/method.ts`: the change removes the checks of `createDeterministic`, `createExternal`, and `getInitialDocument`; `#networkMismatch`; JSDoc.
- `packages/api/src/api.ts`: the change removes the check of `#resolveUpdateSource`; the JSDoc of `createDid`.
- Docs: `packages/method/README.md`, `packages/api/README.md`.
- Tests:
  - method: `encode-identifier.spec.ts` (inherited names, values that are not a `Uint8Array`, no options, the length messages), `create-errors.spec.ts` (new), `decode-identifier.spec.ts` (the messages of decision 5; `BitcoinNetworkNames[network]` for each network compiles only with the type of decision 4).
  - api: `did-api.spec.ts`, `did-method-api.spec.ts`, `did-btcr2-api.spec.ts` (the error type of each path; `validate(42)`; `updateDid('')` and `deactivateDid('')`; a source with no `versionId` or a non-numeric `versionId`).

## References

- did:btcr2 specification: [Algorithms](https://dcdpr.github.io/did-btcr2/algorithms.html) (DID-BTCR2 Identifier Encoding, DID-BTCR2 Identifier Decoding), [Terminology](https://dcdpr.github.io/did-btcr2/terminology.html) (Genesis Bytes), [Create](https://dcdpr.github.io/did-btcr2/operations/create.html), [Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html), [Data Structures](https://dcdpr.github.io/did-btcr2/data-structures.html) (Root Capability).
- ADRs 009, 062, 085, 097, 107, 118, 156, 157.
