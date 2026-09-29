# ADR 132: The api Exports Only Its Facade, and a Sub-facade Function Does Each CRUD Step

- **Status:** Accepted
- **Date:** 2026-09-29
- **Packages:** `@did-btcr2/api` (MINOR, breaking: the exports), `@did-btcr2/cli` (PATCH: it imports only the api and key-manager)

## Context

The api is the one entry point of this implementation. The cli is its only consumer in this repository. ADR 096 set the export rule of the api: the write path, and the types in the signatures of the CRUD calls. ADR 122 added the names that a vector tool needs. ADRs 097, 105, and 108 added more names. api 0.28.3 had 53 runtime exports and about 60 type exports.

An audit of api 0.28.3 found five problems:

1. The api re-exported 19 runtime values from the lower packages. Five of them (`BeaconFactory`, `BeaconUtils`, `DidBtcr2`, `Resolver`, `Updater`) are in no signature of the facade. For most of the others, a sub-facade method gives the same capability.
2. `export *` of `helpers.ts` and `genesis.ts` shipped internal functions: `NOOP_LOGGER`, the four `assert*` functions, `resolutionErrorCode`, and a second `buildGenesisDocument` beside `DidMethodApi.buildGenesisDocument`.
3. Seven type exports were in no public signature: `BroadcastResult`, `BlockV3`, `RawTransactionV2`, `CryptosuiteName`, `Hex`, `ProofBytes`, and `MultikeyObject`. Many types that public signatures use were not exported, for example the types of `api.crypto`, the Bitcoin client types, `Did`, `CID`, and `FeeEstimator`.
4. The facade throws `IdentifierError`, `DidDocumentError`, `UpdateError`, and `ResolveError`, but the api exported no error class. A caller could not use `instanceof` without a second package.
5. Callers went around the facade:
   - The cli imported `Identifier`, `BeaconUtils`, `KeyManagerSigner`, and `SchnorrKeyPair` for needs that the facade covers. It imported `StaticFeeEstimator` from method for a fixed fee rate, and `SchnorrKeyPair` for a watch-only key. The facade had no path for these two needs.
   - The example generator of the specification (`bin/gen-examples.ts` in `dcdpr/did-btcr2`) imported ten names from the api, and also `@did-btcr2/smt`. It called `Updater.construct` and `Updater.sign`, because `DidMethodApi.update` always broadcasts.

## Decision

**1. A runtime value is public only if it is one of these:**

- the facade: `createApi`, `DidBtcr2Api`, and the sub-facade classes;
- a configuration class: the three CAS executors;
- a constant or a preset for a user;
- an error class that the facade throws (item 4).

The api removes 18 re-exports and 8 helper exports. `DEFAULT_MIN_CONF` stays, because it is a constant for a user. The result is 34 runtime values. A test fixes the list, so a new value is a decision.

**2. A type is public if and only if a public signature uses it.** A public signature is a parameter, a return type, or a public property of the facade, or a field of an exported type. Three limits apply:

- A member of a class from a lower package does not count. `SchnorrKeyPair` is exported as a type, but the types of its members are not.
- A type of a third-party package is exported only if a facade signature names it: `Did`, `DidResolutionResult`, `DidService`, `DidVerificationMethod`, and `CID`.
- If the api exports a type under its own name (`BeaconAddressType`), or exports a compatible type with the same name (`DidVerificationMethod`), the lower-package name stays out.

The api removes the 7 types of Context item 3 and adds 35 types. Each type from a lower package is a type-only export.

**3. A sub-facade function does each CRUD step that loses a re-export.** Where the facade had no path, the api adds one:

| Need | Removed name | Sub-facade path |
|---|---|---|
| Decode, validate, or encode an identifier | `Identifier`, `IdentifierTypes` | `api.did` (current), and the `'KEY'` or `'EXTERNAL'` literal |
| A genesis document and its bytes | `GenesisDocument`, the free `buildGenesisDocument` | `api.btcr2.buildGenesisDocument`, `createExternalFromDocument` (current) |
| The initial document and the beacon addresses | `Resolver`, `BeaconUtils`, `DidDocument` | `api.btcr2.getInitialDocument`, `getBeacons` (current) |
| A signer for a key of the KMS | `KeyManagerSigner`, `LocalSigner`, `LocalKeyManager` | `api.kms.signer` (current). `LocalKeyManager` is the default KMS. |
| A Bitcoin connection | the `BitcoinConnection` value | `api.btc.connection` (current) |
| An update with no broadcast | `Updater`, `DidBtcr2` | new: `api.btcr2.constructUpdate(source, patch)` and `api.btcr2.signUpdate(did, unsignedUpdate, verificationMethod, signer)` |
| JSON Document Hashing | `canonicalHash` | new: `api.btcr2.hashDocument(document)` |
| The target document of a patch | `JSONPatch` | new: `api.btcr2.applyPatch(document, patch)` |
| The root capability of a DID | `Appendix` | new: `api.btcr2.rootCapability(did)` |
| A watch-only key pair | the `SchnorrKeyPair` value | new: `api.crypto.keypair.fromPublicKey(bytes)` |
| A fixed fee rate | (`StaticFeeEstimator` of method) | new: `announce.feeRate` |
| The Sparse Merkle Tree of a beacon signal | (`@did-btcr2/smt`) | new: `api.smt.build(entries)` and `api.smt.verify(proof, did)` |

The details of the new functions:

- `constructUpdate` takes a `SourceState`, as `update` does (ADR 123).
- `signUpdate` refuses a verification method with no `publicKeyMultibase`. Thus the key check of `Updater.sign` always runs.
- `applyPatch` applies the patch strictly, as an update does. The first operation that fails, a failed `test` included, fails the whole patch.
- `announce.feeRate` is a positive finite number of sats/vB. The api refuses it together with `announce.feeEstimator`, before any read.
- `api.smt` uses the encoding of the SMT Proof data structure: `nonce` and `updateId` are base64url strings with no padding.

**4. The api exports `DidMethodError` and each subclass that a `@throws` tag of the facade names.** These are `IdentifierError`, `DidDocumentError`, `MethodError`, `UpdateError`, and `ResolveError`. `DidMethodError` is the base class. Its `type` is the error code.

**5. A vector tool needs only this package.** This rule replaces the rule of ADR 122. The api exports no step of a vector tool as a lower-package name. Each step is a sub-facade function. The api gets an `smt` sub-facade for the tree of one signal. Aggregation stays out of the facade (ADR 050).

**6. The cli imports only `@did-btcr2/api` and `@did-btcr2/key-manager`.** Each CRUD need goes through the api. The cli keystore implements the `KeyManager` contract over `LocalKeyManager`, the default key manager of the api and the cli. That implementation imports key-manager directly (`LocalKeyManager`, `KeyEntry`, `KeyValueStore`). A user can give the api another `KeyManager`. The cli drops its dependencies on common, keypair, method, and `@web5/dids`.

## Scope boundary

- No aggregation sub-facade (ADR 050).
- No `auxRand` option on a signer (ADR 122). A tool that pins `aux_rand` keeps its own `Signer`.
- No change to the lower packages.
- The api tests and the scripts in `packages/api/lib/` import the source modules and the lower packages directly. They are the tools of the package, not consumers.
- This change does not update `bin/gen-examples.ts` in `dcdpr/did-btcr2`.

## Consequences

**Positive.**

- A caller needs one package for each CRUD operation, for the type of each public signature, and for the errors.
- The runtime surface falls from 53 to 34 values, and a test fixes it.
- The facade can sign an update with no broadcast, for example for an aggregate beacon.
- A copy of `bin/gen-examples.ts` that imports only `@did-btcr2/api` (and `@noble/curves` for its signer) passes `--check` against the committed corpus of the specification: 14 files match.

**Negative.**

- api 0.29.0 breaks each caller that imports a removed name. The example generator of the specification must change.
- The api depends on `@did-btcr2/smt` at run time. Before, it was a dev dependency. method already depended on it at run time.
- This decision reverses parts of earlier ADRs: the re-exported values of ADR 096, the public `rootCauseMessage` of ADR 097, the free `buildGenesisDocument` and `assertGenesisDocument` of ADR 108, and the vector-tool rule and the "no `smt` sub-facade" rule of ADR 122.

**Unchanged.** The behavior of each current facade call. The printed output of the cli. The default fee rate and the default change address.

## Implementation

- `packages/api/src/index.ts`: explicit named exports only, with the rule as a comment.
- `packages/api/src/method.ts`: `constructUpdate`, `signUpdate`, `hashDocument`, `applyPatch`, `rootCapability`, and `AnnounceOptions.feeRate`.
- `packages/api/src/smt.ts` (new): `SmtApi`, `SmtEntry`, `SmtTree`. `packages/api/src/api.ts`: `DidBtcr2Api.smt`.
- `packages/api/src/crypto.ts`: `KeyPairApi.fromPublicKey`.
- `packages/api/package.json`: `@did-btcr2/smt` moves to the dependencies.
- `packages/api/tests/`: `index-exports.spec.ts` (the runtime list, the removed names, the type witness), `did-method-api-offline-steps.spec.ts` (new), `smt-api.spec.ts` (new), `did-method-api-cas-policy.spec.ts` (`feeRate`), and `keypair-api.spec.ts`. Three specs import a source module.
- `packages/api/lib/verify-scenarios.ts`: `resolutionErrorCode` from the source module.
- `packages/api/README.md`: the new functions and the export table.
- `packages/cli/src/`: `DidApi`, `DidMethodApi`, `api.kms.signer`, `api.crypto.keypair`, `feeRate`, and the types and `DidMethodError` from the api. `packages/cli/package.json` and `packages/cli/tsconfig.json`: the dependencies and the project references.
- `packages/cli/tests/`: the fixtures through the api, and `feeRate` in place of `StaticFeeEstimator`.

## References

- [Construct BTCR2 Unsigned Update](https://dcdpr.github.io/did-btcr2/operations/update.html#construct-btcr2-unsigned-update), [JSON Document Hashing](https://dcdpr.github.io/did-btcr2/algorithms.html#json-document-hashing), [SMT Proof](https://dcdpr.github.io/did-btcr2/data-structures.html#smt-proof).
- The example generator of the specification: `bin/gen-examples.ts` in `dcdpr/did-btcr2`.
- [ADR 050](050-split-aggregation-packages.md): aggregation stays out of the api facade.
- [ADR 096](096-facade-signer-factory-and-write-path-re-exports.md): the earlier re-export rules of the api.
- [ADR 097](097-resolution-failures-carry-their-root-cause.md): `rootCauseMessage`.
- [ADR 108](108-genesis-document-builder-and-cli-genesis-build.md): the genesis document builder.
- [ADR 122](122-api-exports-vector-tool-steps-and-smt-rejects-empty-sibling-in-hashes.md): the steps of a vector tool.
- [ADR 123](123-update-and-deactivate-follow-the-specification-signatures.md): the specification signatures of the write methods.
