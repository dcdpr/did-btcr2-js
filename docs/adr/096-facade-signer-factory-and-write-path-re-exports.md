# ADR 096: The Facade Produces Signers, and the Write Path Is Importable from the API Alone

- **Status:** Accepted
- **Date:** 2026-08-28
- **Packages:** `@did-btcr2/api`

## Context

The api is the pre-configured entry point for the stack: its `kms` sub-facade eagerly defaults to the bundled `LocalKeyManager` when no `KeyManager` is injected through `ApiConfig.kms`, and `generateDid()` already stores the generated key in that kms, marks it active, and returns `{ did, keyId }`. The key-manager package exists to be this default signing backend; a caller with unusual custody needs swaps it out, and everything on the facade follows.

The chain dead-ended one step short of a write. Every write on the facade (`updateDid`, `deactivateDid`, `DidMethodApi.update` and `deactivate`, `UpdateBuilder.signer`) requires a `Signer`, and nothing on the facade produced one. The bridge exists (`KeyManagerSigner` wraps any `KeyManager` behind the `Signer` contract), but reaching it meant installing `@did-btcr2/key-manager` separately and reaching through the facade's internals. The incantation `new KeyManagerSigner(api.kms.kms, keyId)` appeared verbatim in the cli's update and deactivate commands, the package's `README.md` and `DEMO.md`, and `lib/e2e-full-lifecycle.ts`: five independent call sites reimplementing the same two lines against a double-`kms` property path is a facade missing a method, not consumers misusing one.

A second, broader gap: types that appear in public facade signatures (`Signer`, `Btcr2DidDocument`, `SignedBTCR2Update`, `ResolutionOptions`, `BitcoinConnection`, and others) were not re-exported, so consumer code could not name them without direct dependencies on `@did-btcr2/keypair`, `@did-btcr2/key-manager`, `@did-btcr2/method`, or `@did-btcr2/bitcoin`. Under pnpm's strict `node_modules` those imports fail outright.

Re-exporting is complicated by a name collision. `@did-btcr2/keypair` and `@did-btcr2/key-manager` both export a `SignOptions`, and the shapes differ for a structural reason: `Signer.sign` takes its scheme as a positional parameter, so keypair's options carry only `merkleRoot`; `KeyManager.sign` takes its scheme inside options, so key-manager's adds `scheme?`. Both packages also export a textually identical `SigningScheme` (key-manager's own doc comment says it "mirrors" keypair's). A wildcard re-export of both packages is an ambiguous-export compile error, and the signing implementations themselves are already single-sourced (`LocalKeyManager.sign` delegates to keypair's `signWithScheme`), so the collision is a type-layer naming accident between complementary packages, not an architectural fork.

## Decision

**`KeyManagerApi.signer(id?)` returns a `Signer` bound to one concrete key of the facade's own key manager.** The binding happens at creation: the given id, or the key active at that moment; with neither, the factory throws immediately. Binding resolves the key's public material eagerly, so an unknown id fails at the call site rather than at sign time (a watch-only id still fails only when signing, since a public key is all that binding can check). The canonical write becomes `signer: api.kms.signer(keyId)`, completing the `generateDid` chain with no second install and no reach into facade internals. A companion `activeKeyId` getter restores read symmetry with `setActive`: the facade could previously set the active key but not report it.

Creation-time binding is deliberate, not a convenience. The underlying `KeyManagerSigner` adapter, handed no key id, caches its reported `publicKey` on first read while re-resolving the active key on every `sign`. Held across a `setActive`, or across a `generateDid` (which activates the new key by default), such a signer can sign with a different key than the one its `publicKey` reports; the write path's wrong-key check compares against `publicKey`, so the drift would surface only downstream, as an update whose proof cannot verify. A facade-produced signer therefore never floats. The floating behaviour remains available to callers who construct `KeyManagerSigner` directly and accept its documented staleness trade-off.

**The write path, and the types named in the main facade's CRUD signatures, are re-exported from the package root, as explicit named exports, never `export *`.** Values: `LocalSigner` and `SchnorrKeyPair` (keypair); `KeyManagerSigner` and `LocalKeyManager` (key-manager); `BeaconFactory`, `BeaconUtils`, `DidBtcr2`, `Resolver`, `Updater` (method, joining the classes already re-exported); `BitcoinConnection` (bitcoin). Types: `Signer`, `SigningScheme`, `SignOptions` (keypair); `GenerateKeyOptions`, `ImportKeyOptions`, `KeyIdentifier`, `KeyManager`, `VerifyOptions` (key-manager); `BeaconService`, `BroadcastOptions`, `BroadcastResult`, `Btcr2DidDocument`, `CASAnnouncement`, `DidCreateOptions`, `IdentifierComponents`, `ResolutionOptions`, `Sidecar`, `SignedBTCR2Update`, `SMTProof` (method).

**Plain names belong to their end-state owners.** The plain `SignOptions` is keypair's Signer-level shape; key-manager's KeyManager-level shape is exported as `KmsSignOptions`. This anticipates the source-level reconciliation (a follow-up in the key-manager package: re-export keypair's `SigningScheme` instead of mirroring it, and rename its options type so the extender carries the qualified name). Choosing the other direction would have forced the api's plain `SignOptions` to change meaning when that rename lands. `SigningScheme` is re-exported from keypair only; the two declarations are structurally identical, and taking one kills the drift risk.

**`signer` remains a required parameter on every write.** Two alternatives were rejected. Defaulting a missing `signer` to the active key invites signing an update with a key that does not match the named verification method, a failure that surfaces later as an invalid update or a wasted beacon UTXO rather than at the call site. Accepting a `keyId` directly on `updateDid` as an alternative to `signer` adds a second way to express the same thing; the factory composes with every existing signature, including `UpdateBuilder.signer()`.

## Scope boundary

**No change to keypair or key-manager here.** The source-level reconciliation of the colliding names is deliberately a separate task in the key-manager package; this ADR only fixes the api surface and picks re-export names consistent with that end state.

**Contract-implementation types stay with their contracts.** `KeyEntry`, `KeyValueStore`, `MemoryStore`, and `VerifyScheme` are not re-exported: they matter to someone implementing a custom `KeyManager` or store, and implementing a package's contract is legitimately a direct dependency on that package (as the cli's file-backed keystore is). The api re-exports what consuming the facade requires, not what extending the backend requires.

**The sweep covers the CRUD surface, not every sub-facade signature.** Types appearing only in the crypto and bitcoin sub-facades' signatures (`SchnorrMultikey`, the cryptosuite classes, `SecuredDocument` and `VerificationResult`, the Bitcoin REST client and its response types) are still unnameable from the api alone. Sweeping them is mechanical if wanted later; this change is scoped to completing the CRUD cycle.

## Consequences

**Positive.** A full CRUD cycle is expressible with `@did-btcr2/api` as the only installed did-btcr2 package. The five hand-rolled `KeyManagerSigner` constructions collapse to one facade call, and the double-`kms` property path drops out of the documented write path. The cli's update and deactivate commands can shed their only value imports from `@did-btcr2/key-manager`.

**Negative.** The surface grows by one method, one getter, and 30 re-exported names (10 values, 20 types) on a facade meant to stay minimal. Until the source-level rename lands, `api.kms.sign` declares its options parameter with key-manager's `SignOptions` while the api exports that same shape as `KmsSignOptions`: an IDE hover shows the source name, not the re-export alias. Assignability is unaffected, and the wrinkle disappears with the follow-up.

**Neutral.** Nothing here was impossible before; every re-exported name was importable from its home package. The change removes the second and third installs, not a capability gap.

## Implementation

- `packages/api/src/key-manager.ts`: `signer(id?)` and the `activeKeyId` getter on `KeyManagerApi`.
- `packages/api/src/index.ts`: the explicit named re-export blocks, with the collision rationale in a comment beside the `KmsSignOptions` alias.
- Tests: signer bound to a named key; the no-id signer binding the active key at creation (not the newest key, and not floating to a later `setActive`); eager failure on an unknown id and on no id with no active key; a facade-produced signature verifying through the facade; `activeKeyId` lifecycle; and an import-surface spec asserting every re-exported value is constructible, every re-exported type usable in type position, and the plain `SignOptions` compile-time-checked to be the scheme-less Signer-level shape.

## References

- ADR 093 (network inheritance), ADR 094 (deactivation as an ordinary update), ADR 095 (offline initial document and beacon addresses): the same api CRUD review produced all four findings.
- `docs/api-crud-review.md`: the review that surfaced this, as gap G4.
- ADR 033: the kms-to-key-manager package rename, which fixed the package's role as the reference `KeyManager` this facade defaults to.
