# @did-btcr2/cli

## 0.13.0

### Minor Changes

- **Breaking output change:** `update` and `deactivate` now print the api's enriched `DidUpdateResult` instead of the bare signed update. The old payload moves under `data.signedUpdate`; new fields are `data.txid`, `data.announcement` (CAS beacons), `data.proof` (SMT beacons), and `data.publishedToCas`. Note that `data.proof` changes meaning: it was the signed update's Data Integrity proof (now at `data.signedUpdate.proof`) and is now the optional SMT inclusion proof. Scripts parsing this output must be updated.

  The enriched output surfaces the artifacts required for manual sidecar distribution (txid, announcement, SMT proof). The cli passes `publishToCas: 'never'` explicitly (its CAS configuration is read-only gateway-only for now); a follow-up exposes writable-CAS configuration and a `--publish-to-cas` flag.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.15.0
  - @did-btcr2/method@0.54.0

## 0.12.18

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.14.0

## 0.12.17

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.53.0
  - @did-btcr2/api@0.13.12

## 0.12.16

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.52.0
  - @did-btcr2/api@0.13.11

## 0.12.15

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.51.0
  - @did-btcr2/api@0.13.10
