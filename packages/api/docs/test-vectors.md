# Test Vectors

The test-vector pipeline in `packages/api/lib/` produces the vectors of the [did-btcr2-test-suite](https://github.com/dcdpr/did-btcr2-test-suite) repository, embedded as the git submodule `packages/api/lib/data`. Other implementations of did:btcr2 take the inputs of a vector and check that their outputs verify and resolve. See [ADR 113](../../../docs/adr/113-test-vector-pipeline-and-submodule-live-in-the-api-package.md) for the decisions behind the pipeline.

## Quick start

All commands run from `packages/api/`. Every command takes `--network <name>` with `regtest`, `mutinynet` (the default), `signet`, or `testnet4`.

```bash
# 0. Assign a fixed secret to every recipe key of the network (once).
pnpm scenario:keys --network regtest

# 1. Generate every vector set of the network (offline).
pnpm generate:scenario --network regtest --clean

# 2. Build the shared cohort artifacts (CAS Announcement Maps, SMT trees).
pnpm scenario:artifacts --network regtest

# 3. Route the CAS-delivered items out of the sidecars into the publish manifest.
pnpm scenario:route --network regtest

# 4. Check the vectors offline, with synthetic beacon signals.
pnpm scenario:verify --network regtest

# 5. Publish the CAS objects (dry-run first; --publish pins to IPFS_RPC_URL).
pnpm scenario:publish --network regtest
IPFS_RPC_URL=http://host:5001 pnpm scenario:publish --network regtest --publish

# 6. Fund the beacon addresses, then anchor the signals.
pnpm scenario:fund --network regtest
pnpm scenario:anchor --network regtest

# 7. After six confirmations: resolve live through the api and record the outputs.
pnpm scenario:verify:live --network regtest --record

# 8. Write the README of the network.
pnpm scenario:readme --network regtest
```

Run the steps 1 to 6 as one pass. BIP340 signing uses random auxiliary data, so every generation produces different signed bytes, and the artifacts, the manifest, and the anchored signals belong to one generation.

## Recipes

A recipe is a JSON file in `lib/scenarios/<network>/`. One directory per network holds the recipes, the `cohorts.json` of the aggregate beacons, the head of the network README (`README.head.md`), and the build state of the last pass: `cohorts/`, `publish-manifest.json`, `cid-manifest.json`, `FUNDING.md`, and `state/<scenario-id>.json` (the DID, the anchors, and the beacon addresses of every generated scenario). The build state is committed with the pass of the network. Every network directory has its own secrets, so a published key belongs to one chain.

A recipe names:

- `idType`: `KEY` (k1) or `EXTERNAL` (x1).
- `keys`: the genesis key. `extraKeys`: named keys for a beacon rotation, an added verification method, or an unauthorized signer. `scenario:keys` fills every `generate` key with a fixed secret.
- `beacons`: the singleton beacons of the initial document (`P2PKH`, `P2WPKH`, `P2TR`).
- `genesis` (x1 only): `verificationMethods` (extra methods with their relationships), `embedInvocationKey` (the initial key is an embedded object in `capabilityInvocation`), `relativeIds` (every id is a relative DID URL), `tamper: hash-mismatch` (the sidecar genesis document does not hash to the identifier).
- `identifier.tamper`: `checksum`, `padding`, or `network-nibble` makes the identifier of the resolve input invalid.
- `delivery`: `genesis` and `announcement` as `sidecar` or `cas`.
- `updates`: each with `patches`, `verificationMethodId`, `beaconId`, and `delivery` (`sidecar`, `cas`, `smt`). Options: `signWith` (a named key), `fork` (a second update from the same source version), `tamper` (an invalid update, see the kinds in `lib/_scenario-helpers.ts`), `withhold` (the update is in neither the sidecar nor the CAS), `removedBeacon` (the update is announced at a beacon that an earlier update removed; a resolver ignores the signal, so the expected document does not advance).
- A duplicate entry in `updates`: `{ "duplicateOf": N, "beaconId": "#..." }` announces the signed update of entry N again, in a later block. The entry has no `update/NN/` directory and no sidecar entry. The update directories count the update entries only.
- Patch values take the forms `$did`, `$address(name,kind)`, and `$multibase(name)`.
- `resolves`: sub-vectors with resolution options (`versionId`, `versionTime`, `minConf`) and the expected version or error. A `versionTime` of the form `before:N`, `at:N`, or `after:N` names the `mediantime` of the block that anchors entry N of `updates` (a duplicate entry counts); the record step writes the timestamp.
- `expect.error`: the DID Resolution error code of a negative vector.
- `skip`: a reason to leave the recipe out of the pass (the SMT recipes wait for a specification change).

## Vector layout

```
lib/data/{network}/{k1|x1}/{hash}/
  create/input.json, create/output.json
  update/input.json, update/output.json       # update/NN/ for more than one update
  resolve/input.json, resolve/output.json     # resolve/NN/ for a sub-vector
  other.json                                  # keys and genesis document
  signals.json                                # the Beacon Signals on the chain (anchored sets)
```

The corpus holds the files a consumer needs and no pipeline state ([ADR 115](../../../docs/adr/115-vector-corpus-holds-no-pipeline-state-and-signals-json-records-the-anchored-signals.md)). `update/input.json` keeps `signingMaterial`: an implementation needs the key to produce its own signed update. `resolve/output.json` is the DID Resolution result that the api returns: `didResolutionMetadata` (`contentType: application/did`, or `error`), `didDocument`, and `didDocumentMetadata` (`versionId`, `confirmations`, `updated`, `deactivated`). The generator writes the result as far as it is known offline; `scenario:verify:live --record` writes the live result.

`signals.json` is written by `scenario:verify:live --record` for every set that has a Beacon Signal on the chain. It is an array with one entry per signal: `update` (the `update/NN/` number of the signed update the signal commits to), `duplicate` (set on a second signal of the same update, in a later block), `beaconId`, `address`, `txid`, `blockHeight`, `blockHash`, `blockTime`, `mediantime`, and `signalBytes`. A cohort member records the shared signal with `cohort: { id, members }`. A consumer checks its own signal discovery against the file, or takes the signals from it when it reads no chain.

## Networks

- **regtest:** the Polar stack (`localhost:18443` RPC with `polaruser` / `polarpass`, Esplora at `localhost:3000`). `scenario:fund` sends over RPC and mines a block. `scenario:anchor` mines a block after each anchor and six blocks at the end. Export the Polar network to `lib/data/regtest/did-btcr2.polar.zip` after the pass.
- **mutinynet, testnet4, signet:** the wallet funding key pays the beacons (`pnpm wallet init`, `pnpm wallet status`, faucet the P2WPKH address; see `lib/wallet/README.md`). Anchors chain in the mempool. `CAS_GATEWAY` selects the IPFS gateway of the live verify (default: the api gateway).

## Cross-implementation harness

The vectors above are ours. A second harness, in `lib/debug/`, resolves another implementation's vectors through our CLI. That is how the relative DID URL gap of [ADR 091](../../../docs/adr/091-inject-did-into-beacons-and-relative-did-urls.md) was found: a document shape we never generate is one no vector of ours could have covered.

`danubetech-vectors.json` is a committed snapshot of the 16 example DIDs published by the [danubetech `uni-resolver-driver-did-btcr2`](https://github.com/danubetech/uni-resolver-driver-did-btcr2), 6 resolved bare (`GET`) and 10 with sidecar resolution options (`POST`). The `description`, `notes`, `knownFault`, and `knownFailReason` fields on each entry are ours, not upstream's.

```bash
# From packages/api/lib/debug/

# Resolve all 16 through whatever `btcr2` is on PATH (the published binary)
./danubetech-run.sh

# Resolve a local build instead: the usual reason to run this
BTCR2_BIN="node $(git rev-parse --show-toplevel)/packages/cli/dist/esm/bin/btcr2.js" ./danubetech-run.sh

# A subset, a longer per-vector timeout, a custom report path
./danubetech-run.sh 04 07 12a
TIMEOUT=120 ./danubetech-run.sh
./danubetech-run.sh --out /tmp/report.md

# Refresh the snapshot from upstream (clones to a temp dir, or pass a checkout path)
./danubetech-sync.sh
./danubetech-sync.sh /path/to/uni-resolver-driver-did-btcr2
```

Each vector is wrapped in `timeout` so one hang does not block the run. Terminal output is a progress log; the full report, including the captured stdout and stderr per vector, is written to `results.md` beside the script (gitignored). Statuses are `PASS`, `FAIL`, `XFAIL` (a vector carrying a `knownFault` annotation), and `TIMEOUT`; the script exits non-zero only on `FAIL` or `TIMEOUT`, so an expected failure does not break a run.

A failure here is not automatically ours. Attributing one is a three-question exercise: what does the specification require, which implementation departs from it, and does a vector exist that would have caught it. Requires `jq`, GNU `timeout`, and a `btcr2` CLI.
