# ADR 159: Three Packages Get New Names That Start at 0.1.0: common Becomes std, cryptosuite Becomes integrity, and keypair Becomes keys

- **Status:** Accepted
- **Date:** 2026-10-28
- **Packages:** `@did-btcr2/std`, `@did-btcr2/integrity`, and `@did-btcr2/keys` (new names, first version 0.1.0: the code of `@did-btcr2/common` 11.0.0, `@did-btcr2/cryptosuite` 11.0.0, and `@did-btcr2/keypair` 0.13.3 with no change); `@did-btcr2/bitcoin`, `@did-btcr2/key-manager`, `@did-btcr2/method`, `@did-btcr2/aggregation`, and `@did-btcr2/api` (MINOR: each package uses the new packages, so each class that it takes, returns, throws, or re-exports from them is a new class; the browser bundles of method, aggregation, and api hold the new packages); `@did-btcr2/cli` (PATCH: dependency uptake; `CLIError` extends the `DidMethodError` of std); `@did-btcr2/common`, `@did-btcr2/cryptosuite`, and `@did-btcr2/keypair` (no new version; deprecated on npm after the publish)

## Context

### Two packages have high major numbers

`@did-btcr2/common` went above 1.0 before its API was stable. After that, each break of its API gave a new major version. `@did-btcr2/cryptosuite` followed the same path. Both packages are now at 11.0.0. The other eight packages are 0.x, for example `@did-btcr2/keypair` 0.13.3 and `@did-btcr2/method` 0.74.0.

npm never accepts a version number a second time. Semver orders 11.0.0 above each 0.x version. Thus a range such as `*` and an update tool take 11.0.0 in place of a later 0.x release. The only path back to 0.x is a new package name.

### Three names do not tell what the package holds

The other packages have short names that tell their content: `smt`, `bitcoin`, `key-manager`, `method`, `aggregation`, `api`, and `cli`. The name `common` tells only that other packages use the package. The name `cryptosuite` names one part of its package: the package also holds `BIP340DataIntegrityProof` and `SchnorrMultikey`. The name `keypair` names one kind of class. The package also holds public keys, secret keys, and signers.

### A dependent takes the classes of the renamed packages

bitcoin, key-manager, method, aggregation, and api take, return, throw, or re-export classes of the three packages. A class of an old package and the class of the same name in a new package are two classes. A consumer can thus get a mix of old and new classes if a dependent moves to a new package in a PATCH release.

## Decision

### 1. The new names

- `@did-btcr2/common` becomes `@did-btcr2/std`.
- `@did-btcr2/cryptosuite` becomes `@did-btcr2/integrity`.
- `@did-btcr2/keypair` becomes `@did-btcr2/keys`.

The code, the exports, the error types, and the result shapes do not change. Each export keeps its name. The std `description` in `package.json` is "Shared types, errors, JCS canonicalization, hashing, and JSON Patch for the did-btcr2-js packages."

### 2. The directories move

`git mv` moves `packages/common` to `packages/std`, `packages/cryptosuite` to `packages/integrity`, and `packages/keypair` to `packages/keys`. The move holds 87 tracked files: 28 in std, 36 in integrity, and 23 in keys. Git keeps the history of each file. Each of the 10 package directories thus has the short name of its package. `pnpm --filter std` and the package list of `scripts/coverage-report.mjs` need no name map.

The move does not keep dead files under a new name:

- `packages/std/build/` is deleted. Its 2 files make a browser bundle with `globalName : 'BTCR2Common'`, and no script runs them.
- `packages/integrity/lib/` is deleted. Its 16 dev scripts are from the did:btc1 era. `tsc -p lib/tsconfig.json --noEmit` gave 15 errors on them, and no gate runs them.

### 3. Each new name starts at 0.1.0

- Each new `package.json` has `"version": "0.0.0"`.
- One changeset gives each new package a `minor` release. The first published version is thus 0.1.0.
- A later `patch` or `minor` changeset in the same release also gives 0.1.0, because changesets uses the highest type per package.
- A `major` changeset on a new package gives 1.0.0. Thus a break of a new package uses `minor` while the package is 0.x.
- `pnpm-workspace.yaml` and the `workspaces` array of the root `package.json` list the new directories. changesets reads the root array first, so a stale array stops the version step.

### 4. Each new package starts a new CHANGELOG

The rename deletes the moved `CHANGELOG.md` of each package. The changeset writes a new file with the header `# @did-btcr2/std` (or `integrity`, or `keys`) and the entry `## 0.1.0`. The entry links the old file at commit `9c260b13`, for example `https://github.com/dcdpr/did-btcr2-js/blob/9c260b13/packages/common/CHANGELOG.md`. Thus each name has one history, and the old record stays available.

### 5. No shim, no alias package, no re-export of the old names

No package re-exports `@did-btcr2/common`, `@did-btcr2/cryptosuite`, or `@did-btcr2/keypair`. No new version of an old name re-exports a new package. A consumer changes its imports. The READMEs do not name the old packages. The CHANGELOG entry, this ADR, and the npm deprecation text hold the link from the old name to the new name.

### 6. Each dependent gets a MINOR release

The change is a break of each dependent, because the identity of each class from a renamed package changes:

1. `instanceof` gives `false` between an old class and a new class. For example, a std `ResolveError` is not `instanceof` the common `DidMethodError`.
2. TypeScript refuses an old class in place of a new class if the class has a `#private` member (TS2322). These classes are the key classes of keys and the `SchnorrMultikey` of integrity. The std error classes have no `#private` member, so TypeScript accepts them.
3. Published code reads the class. The `resolutionErrorCode` function of api 0.36.0 gives `INVALID_DID` for a common `ResolveError` of the type `INVALID_DID`. It gives `INTERNAL_ERROR` for a std `ResolveError` of the same type.

A PATCH release puts the break into old installs. For example, api 0.36.0 needs `@did-btcr2/method ^0.74.0`. A method 0.74.1 on std throws a std `ResolveError`, and api 0.36.0 then reports `INTERNAL_ERROR` in place of the real error type. A MINOR release of a 0.x package is outside the range `^0.y.z`, so an old install keeps the old graph.

The new versions are: bitcoin 0.12.0, key-manager 0.8.0, method 0.75.0, aggregation 0.9.0, and api 0.37.0. bitcoin uses only std. Its declarations use only the std type aliases `Bytes` and `UnixTimestamp`. But it throws the std `MethodError`, so a caller gets a new error class.

### 7. The cli version follows its command surface

The cli gets a PATCH release (0.29.11). The cli library exports `CLIError`. `CLIError` extends the `DidMethodError` that the api exports, and that class is the std class. By the rule of decision 6, this is a break of the cli library surface. PATCH is still the lowest viable bump:

1. No published package depends on the cli, so no caret range can pull a new cli into an old graph.
2. The cli version follows its command surface: the commands, the flags, and the output. The rename changes none of them.
3. cli 0.29.7 to 0.29.10 got PATCH releases for the api MINOR releases 0.33.0 to 0.36.0. For example, api 0.36.0 changed `didResolutionMetadata.error` of `DidResolutionResult` to an error object, and the cli type `CommandResult` exports `DidResolutionResult` by reference.

### 8. The old names get a deprecation after the publish

After the first publish of the new names, each old name gets `npm deprecate` for all its versions. The text names the new package, for example: "Renamed to @did-btcr2/std. Install @did-btcr2/std. This package gets no new versions." The old versions stay available. An install of an old version prints the text. ADR 004 used the same step for the `@did-btc1` scope.

### 9. The lockfile keeps each resolution

- The rename edits `pnpm-lock.yaml` by name: the importer keys, the `link:` values, and the dependency keys. `pnpm install --frozen-lockfile --offline` then verifies the file.
- The rename does not run a plain `pnpm install` before the edit. Such an install resolves the 3 new importers again and changes dependency versions, for example eslint 9.35.0 to 9.39.4.
- The edit leaves the 3 importer blocks out of order. A sort step moves them to their sorted places. The result has 104 changed lines against `9c260b13`, and a line `sort` of the edited file and of the sorted file gives the same output.
- On pnpm 11.4.0, `pnpm install --offline --fix-lockfile` does not sort the file ("Already up to date"). An install that changes a dependency sorts it. The sort step thus removed one devDependency of `packages/smt/package.json`, ran `pnpm install --offline`, put the file back, and ran the install again. The final `packages/smt/package.json` is the same as before.
- Without the sort step, the first later change of a dependency gets about 80 lines of reorder in its own diff.

### 10. Concept names stay

The rename changes package names only. A name of a specification concept or a crypto concept stays:

- `api.crypto.keypair`, the class `KeyPairApi`, and the `cryptosuite` sub-facade of the api.
- The class directory `packages/integrity/src/cryptosuite/` and the class `BIP340Cryptosuite`.
- The std error classes `KeyPairError` and `CryptosuiteError`.
- The cli text "Manage keypairs in the encrypted keystore."
- The npm keyword "cryptosuite" in the `package.json` of integrity and keys.

### 11. Each judgment call conforms to the specification texts

The did:btcr2 specification does not name the packages of an implementation, so no decision of this ADR depends on a specification text.

## Alternatives

**Merge common into keypair.** Rejected. keypair then holds DID error types, JCS, and JSON Patch, so its scope is a mix. bitcoin then depends on a key package that it does not use. cryptosuite stays at 11.0.0.

**The same name, with a 0.x release after 11.0.0.** Rejected. Semver orders 11.0.0 above each 0.x version, so a range such as `*` and an update tool take 11.0.0 in place of the 0.x release.

**Keep the high major numbers.** Rejected. This is correct semver and needs no change. But the major number grows with each break, and the names stay unlike the other names.

**Continue the version numbers, as ADR 004 did for the scope rename (`@did-btc1/common@1.1.0` to `@did-btcr2/common@2.0.0`).** Rejected. std then starts at 12.0.0, and the high major numbers stay.

**Keep the directory names.** Rejected. Three of the 10 directories then have names that are not the names of their packages. `pnpm --filter common` no longer matches a package, and the coverage report needs a name map.

**Keep the old CHANGELOG under the new header.** Rejected. changesets puts `## 0.1.0` above `## 11.0.0`, so the std file lists 9 versions (9.2.0 to 11.0.0) that std never had.

**Keep the old CHANGELOG as `HISTORY.md` next to a new `CHANGELOG.md`.** Rejected. One of the two files is then a legacy file, and the link of decision 4 gives the same record.

**`"version": "0.1.0"` in each new `package.json` and no changeset entry.** Rejected. A later `minor` changeset then gives std 0.2.0 before the first publish. A std release gives keys 0.1.1. The new CHANGELOG gets no `## 0.1.0` entry.

**An alias package or a shim under each old name.** Rejected. It keeps two names for one class and hides the rename. ADR 004 made the same choice for the `@did-btc1` scope.

**PATCH for the dependents.** Rejected. Caret ranges pull a PATCH into old installs, and old and new classes then mix (decision 6).

**MINOR for the cli.** Rejected. No package depends on the cli, and the rename does not change its command surface (decision 7).

**A plain `pnpm install` in place of the lockfile edit.** Rejected. It changes the versions of eslint, rimraf, and typescript-eslint in a commit that must change only names.

**No sort step for the lockfile.** Rejected. The reorder then goes into the diff of an unrelated later change.

## Consequences

- std, integrity, and keys get their first version, 0.1.0. bitcoin, key-manager, method, aggregation, and api get a MINOR release. The cli gets a PATCH release. smt gets no release. common, cryptosuite, and keypair get no new version.
- A consumer must change each import of an old name to the new name. A program that uses an old package and a new package gets two classes with the same name. `instanceof` then gives `false`, and TypeScript refuses the key classes and `SchnorrMultikey` (TS2322).
- A publish before the version step gives 0.0.0 for std, integrity, and keys, and a dependent then needs `^0.0.0`. The publish must come after the version step.
- A changeset that names an old package stops `changeset version` for all packages ("Found changeset ... which is not in the workspace"). Each later changeset must use the new names.
- The README badges link to the GitHub labels `package: std`, `package: integrity`, and `package: keys`. These links show no label until the old labels get the new names.
- Old ADRs keep the old names and paths. Eight relative links in ADRs 002, 014, 015, 019, and 038 point to the old directories, so `pnpm docs:build` gives a warning for each of them. Each link resolves at the commit of its ADR.
- The example tool of the specification repository pins `@did-btcr2/api` 0.32.0 exactly, so it keeps the old packages. After the deprecation, an install of that tool prints a deprecation warning.

**Superseded.**

- ADR 001, the decision: the names `common`, `keypair`, and `cryptosuite` in the package tree (lines 32 to 34). The names are now `std`, `keys`, and `integrity` (decision 1).
- ADR 001, the consequence "Consumers install only what they use.": the names in "A wallet resolver takes `common`, `keypair`, `cryptosuite`, `method`" (line 49). The names are now `std`, `keys`, and `integrity` (decision 1).

**Unchanged.**

- ADR 001: the package boundaries and the dependency direction. Each renamed package keeps its content and its place in the graph.
- ADR 004: the deprecation of the old names and no shim package. Decisions 5 and 8 of this ADR apply the two rules again.
- ADR 054: the integrity package stays method-agnostic.
- ADR 084: the coverage report. Its package list holds the new directory names.
- ADR 085: the typed-error lint block. It covers the same packages at the new paths.
- ADR 132: the api exports the same names.

## Implementation

- `packages/std/`, `packages/integrity/`, and `packages/keys/`: the moved directories. In each `package.json`: the `name`, `"version": "0.0.0"`, and the name of each workspace dependency. In the std `package.json` and README: the new description.
- `packages/std/build/` and `packages/integrity/lib/`: deleted (decision 2).
- The moved `CHANGELOG.md` files: deleted (decision 4).
- Each `package.json`, `tsconfig.json`, source file, test file, and dev script with an old package name or path: the new name. The rename script changed 201 files with the lockfile and 440 lines, each line 1 to 1.
- Root: `package.json` (`workspaces` and the filter scripts), `pnpm-workspace.yaml`, `tsconfig.json`, `typedoc.json`, `eslint.config.cjs`, `scripts/coverage-report.mjs`, `did-btcr2-js.code-workspace`, and `pnpm-lock.yaml` (decision 9).
- `packages/key-manager/lib/smoke-test-tarball.sh`: the tarball names and the import line.
- Comments and test titles that name a package: `packages/api/src/index.ts`, `packages/api/tests/helpers.spec.ts`, `packages/method/src/utils/error-cause.ts`, `packages/method/tests/beacon-signature-verifies.spec.ts`, and `packages/std/tests/errors.spec.ts`.
- Docs: the root `README.md`, `docs/architecture/overview.md`, `docs/architecture/package-graph.md`, `docs/contributing/`, and the package READMEs.
- `.changeset/rename-std-integrity-keys.md`: the changeset of decisions 3, 4, 6, and 7.

## References

- [Semantic Versioning 2.0.0](https://semver.org/): item 4 (major version zero) and item 11 (precedence).
- [npm deprecate](https://docs.npmjs.com/cli/commands/npm-deprecate).
- [Changesets](https://github.com/changesets/changesets): `changeset version`.
- ADRs 001, 004, 054, 084, 085, 132.
