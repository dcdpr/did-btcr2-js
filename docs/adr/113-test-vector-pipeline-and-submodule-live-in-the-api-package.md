# ADR 113: The Test-Suite Submodule and the Test-Vector Pipeline Live in the api Package, One Generator Writes the Fixed Vector Layout, and Vectors Must Verify, Not Match Byte for Byte

- **Status:** Accepted
- **Date:** 2026-09-11
- **Packages:** development scripts under `lib/` in `@did-btcr2/api` and `@did-btcr2/method`; no shipped package changes

## Context

ADR 011 (2026-03-06) put the test-vector generator at `packages/method/lib/generate-vector.ts` and the vector submodule at `packages/method/lib/data`. The submodule tracks [did-btcr2-test-suite](https://github.com/dcdpr/did-btcr2-test-suite), the vector corpus that other implementations of did:btcr2 consume. ADR 011 set two goals that this decision changes. A vector must be reproducible byte for byte. The generator is a stepped command-line tool with one subcommand per lifecycle step.

Since ADR 011, a second generator grew next to the first one. The scenario pipeline reads a JSON recipe per scenario. It consists of `generate-scenario.ts`, the artifact, delivery, publication, funding, anchoring, and verification scripts, and a test-network wallet. It writes every beacon type, aggregation cohorts, and multi-update scenarios. The two generators write two different shapes of `resolve/output.json`. The stepped tool writes Singleton vectors only, sets `sourceVersionId` to `1` in every update, and writes no resolution input. The pipeline scripts hard-code mutinynet for funding, anchoring, delivery, and live verification.

The corpus and the tooling had four defects on 2026-09-10:

- The recorded submodule commit `8005d85e` was the tip of a branch that the test-suite repository deleted. A fresh clone could not fetch it. The checkout `19f8d424`, the `main` branch of the test-suite repository, has the same tree.
- All 20 committed signed updates (6 on regtest, 14 on mutinynet) carry the `@context` array from before ADR 109. No committed vector with an update resolves with method 0.64.0. The offline verifier stops at the first failure.
- The type check of the method `lib/` directory reports 20 errors in 12 files: the stale scripts under `lib/operations/`, and one call in `publish-scenarios.ts`.
- The signet directory is a stub, and testnet4 has no directory. No vector covers a resolution option (`versionId`, `versionTime`, `minConf`), a negative case, an embedded verification method, or an SMT non-inclusion proof.

Three facts shape the decision:

- The api package is the entry point for every user of the stack, and the cli is its only consumer (ADR 006). The scripts that produce user-facing artifacts belong next to it. The `files` list of the api package contains `dist` and `src` only, so nothing under `lib/` ships. No unit test reads the submodule.
- The shipped signer uses BIP340 with random auxiliary data. Every run produces a different `proofValue` for the same input. The other implementations take the vector inputs and check that their own outputs verify and resolve. They do not compare bytes.
- The api resolve operation returns the DID Resolution result with the metadata of ADR 110. The method scripts built that envelope by hand because the method package cannot import the api package.

## Decision

**The submodule and the pipeline live in the api package.** The submodule path is `packages/api/lib/data`. The pipeline scripts, the recipes, the wallet, the funding notes, and the Danubetech interop harness (`lib/debug`) move to `packages/api/lib/`. The `scenario:*` and `wallet` package scripts and the test-vector document move to the api package. The scripts import `@did-btcr2/method` and `@did-btcr2/smt` where the api facade has no path. Those paths are a tampered update for a negative vector, and single-party CAS and SMT creation. `@did-btcr2/smt` becomes a development dependency of the api package. The submodule moves first, in this change. The method scripts read the new path until they move.

**One generator.** The scenario pipeline is the only generator. The pipeline move deletes the stepped tool `generate-vector.ts`, the scripts under `lib/operations/`, the endpoint table `bitcoin-endpoints.ts`, and the shell runners. Every case that the stepped tool covered has a recipe.

**The vector layout is fixed.** A vector set is `{network}/{k1|x1}/{hash}/` with these files:

- `create/input.json` and `create/output.json`
- `update/input.json` and `update/output.json`, or `update/NN/` for a set with more than one update
- `resolve/input.json` and `resolve/output.json`
- `other.json`

`update/input.json` keeps `signingMaterial`: an implementation needs the key to produce its own signed update from the same input. Other implementations depend on this layout. New coverage goes into new vector sets or numbered sub-directories that follow the same pattern. No file moves, no file is renamed, and no state file leaves the submodule.

**Vectors must verify. They do not match byte for byte.** The pipeline signs with the shipped random-aux path. An implementation takes the inputs and must produce outputs that verify and resolve. The `proofValue` of a committed vector differs from one build to the next. Because every signed byte changes per run, the pipeline runs generation, artifacts, delivery, publication, funding, and anchoring as one pass per network.

**The resolve output is the DID Resolution result.** `resolve/output.json` on every network holds three members:

- `didResolutionMetadata` with `contentType: application/did`, or `error` with the code of a negative case
- `didDocumentMetadata` with `versionId` as a string, `confirmations`, `updated`, and `deactivated`
- `didDocument`

The generator writes the raw result of the api resolve operation. The README of each network states the comparison rule: `confirmations` compares as "at least the recorded value", because the value grows with the chain.

**One recipe directory per network.** The recipes live in `lib/scenarios/<network>/` with the `cohorts.json` of that network. Every script takes `--network` (default `mutinynet`). Each network directory gets its own secrets, so every published key belongs to one chain. Reason: the test networks share the `tb` address prefix, and one secret on several chains caused a fund recovery in June 2026.

**Four networks.** The pipeline regenerates regtest and mutinynet and adds testnet4 and signet, each with the full scenario set. On regtest, funding and anchoring go over the Bitcoin Core RPC of the Polar stack (`sendtoaddress`, `generatetoaddress`). The Polar export stays in the regtest directory of the test suite.

**Negative vectors are on chain.** Each read-path negative case of ADR 112 is its own DID with one anchored invalid update. The resolve output records the expected error. The negative cases before the first signal need no chain data. Those cases are `INVALID_DID`, `INVALID_OPTIONS`, `NOT_FOUND`, `MISSING_UPDATE_DATA`, a genesis hash mismatch, and a CAS content hash mismatch.

**CAS-delivered content is pinned on a node that Danubetech operates.** Danubetech gave permission for the test-vector publication. The script reads the endpoint from `IPFS_RPC_URL`. This repository records no endpoint. Retrieval goes through a public gateway.

**SMT vectors wait for the specification.** The SMT scenarios, the SMT non-inclusion cases, the signal-level negatives, and the `current_block_height` case wait for specification pull request 365 (open on 2026-09-11). That pull request changes the SMT leaf and bit-order rules. The duplicate-update and `versionTime` cases wait for specification pull request 364. The Singleton and CAS scenarios, deactivation, multi-update sets, the resolution options, and the negatives build on specification commit `8591478a` and ADRs 109 to 112.

## Scope boundary

- No shipped package changes. The `files` lists of the api and the method packages exclude `lib/`.
- The `.gitmodules` section keeps the name `packages/method/lib/data`. Git keys the local clone of a submodule by that name, and a rename would move `.git/modules/` for no gain.
- The single-party CAS and SMT creation helpers of the api facade stay deferred. The pipeline uses the method and smt packages for those steps.
- The Danubetech vectors under `lib/debug` are an external corpus. They regenerate on the Danubetech side.

## Consequences

**Positive.** A fresh clone fetches the submodule. One generator writes one output shape. Every user-facing artifact sits next to the entry-point package, and the generator writes the same resolve result that a user gets from the api. Other implementations get vectors for four networks, with negative cases and resolution options, in the layout they consume today.

**Negative.** Every committed vector is regenerated. The identifier hashes of the regenerated sets change, because each network gets new secrets. Consumers of the old sets re-sync from the test-suite repository. A regeneration changes every signed byte, so a review of a vector diff compares structure and results, not bytes. The submodule friction of ADR 011 stays: commit inside the submodule, push, then record the new commit here.

**Unchanged.** The shipped packages. The vector layout and the field set of the input files. The signing path. The external submodule choice, the `{network}/{type}/{hash}` layout, and the committed-vectors trade-off of ADR 011.

**Superseded.** From ADR 011: the generator location, the stepped `generate-vector` tool and its subcommands, the byte-for-byte reproducibility goal, and the submodule path `packages/method/lib/data`. The rest of ADR 011 stands.

## Implementation

- This change:
  - `.gitmodules` records the path `packages/api/lib/data`.
  - The recorded submodule commit is `19f8d424`.
  - The `DATA_DIR` constants of nine method scripts point at the new path.
  - `packages/method/docs/test-vectors.md` names the new path.
- Next change, in the api package:
  - The script move, the `--network` option, and the per-network recipes.
  - The regtest RPC path and the DID Resolution output.
  - The recipe options for the negative cases.
  - The deletion of the stepped tool and a clean type check of the api `lib/` directory.
- Then one regeneration per network: regtest, mutinynet, testnet4, signet. Each network lands as one test-suite pull request and one submodule pointer commit here. The SMT scenarios land as a second pull request per network after the specification change.

## References

- [ADR 006](006-api-package-boundary.md): the api package boundary.
- [ADR 011](011-test-vector-generation-methodology.md): the test-vector methodology that this decision changes.
- [ADR 036](036-zero-hash-smt-model.md): the SMT model that the pending specification change revises.
- [ADR 109](109-btcr2-update-carries-the-pinned-context-array.md): the `@context` pin that invalidates the committed updates.
- [ADR 110](110-resolution-metadata-and-did-resolution-error-codes.md): the resolution metadata and the error codes of the resolve output.
- [ADR 111](111-resolver-processes-one-update-per-pass-and-validates-the-resolution-options.md): the resolution options.
- [ADR 112](112-update-paths-check-the-proof-fields-and-apply-the-patch-strictly.md): the read-path checks behind the negative cases.
- [did-btcr2-test-suite](https://github.com/dcdpr/did-btcr2-test-suite): the vector corpus.
- Specification pull requests 364 and 365 (open on 2026-09-11).
