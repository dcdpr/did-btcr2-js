# @did-btcr2/api

## 0.16.0

### Minor Changes

- Make CAS publication opt-in: `publishToCas` now defaults to `'never'`, and `'auto'` no longer blocks an update.

  CAS publication is optional and never required: every update, for every beacon type, completes and is distributable via sidecar. The previous default of `'auto'` (from the prior release) was opt-out - it auto-published to any configured CAS and, for CAS beacons with no writable CAS, threw up-front - which effectively required CAS publication for that beacon type. This corrects that:

  - **Default is now `'never'`** on `DidMethodApi.update`, `DidBtcr2Api.updateDid`, and `UpdateBuilder`. Out of the box, nothing is published; a configured CAS never triggers publication on its own.
  - **`'auto'` is best-effort and never blocks:** it publishes when a writable CAS is configured, otherwise skips silently for every beacon type (CAS beacons included) and returns the artifacts for sidecar distribution. The CAS-beacon up-front throw is removed.
  - **`'always'` is unchanged:** it requires a writable CAS and throws up-front for every beacon type when none is available.

  Breaking for callers that relied on the implicit `'auto'` default: pass `publishToCas: 'auto'` explicitly to keep auto-publishing. See ADR 073 (supersedes ADR 071 §2).

## 0.15.0

### Minor Changes

- CAS publication policy on the update path, writable-CAS capability detection, and enriched update results (ADR 071).

  - `DidMethodApi.update`, `UpdateBuilder`, and `DidBtcr2Api.updateDid` gain `publishToCas: 'auto' | 'always' | 'never'` (default `'auto'`). Under `'auto'`/`'always'` with a writable CAS, the canonical signed update (all beacon types) and the CAS Announcement (CAS beacons) are published to the CAS **before** the on-chain broadcast, so any OP_RETURN update hash is fetchable from CAS at resolution time.
  - Policy guards fail fast, before signing: `'always'` throws when the CAS is read-only or absent; `'auto'` throws for CAS beacons in that case (a CAS-beacon signal whose announcement lands nowhere is unresolvable); set `'never'` for sidecar-only distribution. Singleton/SMT updates skip publication silently under `'auto'`.
  - **Privacy note:** `'auto'` publishes canonical signed updates to the configured (possibly public) CAS before anchoring. Privacy-conscious controllers should use `'never'` and distribute via sidecar.
  - `update()`/`updateDid()`/`UpdateBuilder.execute()` now return a `DidUpdateResult` (`{ signedUpdate, txid, announcement?, proof?, publishedToCas }`) instead of the bare `SignedBTCR2Update`; read `result.signedUpdate` for the old value.
  - `CasExecutor` gains optional `canPublish` (undefined means writable; `HttpGatewayCasExecutor` declares `false`); `CasApi` gains the `writable` getter.
  - `broadcastOptions` (fee estimator, change address) now pass through the api update path to the beacon transaction.
  - Fixed: `resolve()` no longer loops forever on an SMT beacon signal without a sidecar proof; it fails fast directing the caller to `options.sidecar.smtProofs` (SMT proofs are nonce-blinded and cannot be fetched from a CAS).

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.54.0

## 0.14.0

### Minor Changes

- Drop the `helia` production dependency in favor of fetch-based CAS executors (ADR 069). `BlockstoreCasExecutor` (structurally typed, accepts any in-process blockstore or blockstore provider, e.g. a Helia node) replaces `IpfsCasExecutor`; the new `IpfsRpcCasExecutor` publishes and retrieves raw blocks via the IPFS HTTP RPC API with local CID verification. `CasConfig` replaces `helia` with `blockstore` and adds `rpcUrl`; backend priority is `executor` > `blockstore` > `rpcUrl` > `gateway`. Consumers no longer install the libp2p subtree (436 lockfile packages removed).

## 0.13.12

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.53.0

## 0.13.11

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.52.0

## 0.13.10

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.51.0
