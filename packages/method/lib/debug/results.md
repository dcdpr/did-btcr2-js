# Danubetech Vector Resolution Report

- **Generated:** `2026-05-27T08:47:58-04:00`
- **btcr2 version:** `btcr2 0.8.0`
- **Per-vector timeout:** 60s
- **Vectors run:** 2

## Summary

| Result | Count |
|---|---|
| PASS | 0 |
| FAIL | 0 |
| XFAIL | 2 |
| TIMEOUT | 0 |
| **Total** | **2** |

**Status legend:**

- `PASS` - resolved successfully
- `FAIL` - resolution errored; fault attribution may be `unknown` pending spec analysis
- `XFAIL` - expected failure; vector has a `knownFault` annotation in `danubetech-vectors.json`
- `TIMEOUT` - killed after 60s (treat as a bug to investigate)

**Fault attribution:**

- `our-impl` - did-btcr2-js violates the spec; fix in this repo
- `their-impl` - the other implementation (e.g., danubetech java) violates the spec; file upstream
- `spec-ambiguity` - spec is silent or ambiguous; needs user decision before action
- `unknown` - fault not yet determined; requires manual spec analysis to reclassify
- `n/a` - vector passed, no fault to attribute

See memory: `project-cross-impl-validation.md` for the full framework.

| # | Status | Fault | Duration | Description |
|---|---|---|---|---|
| 11a | XFAIL | their-impl | 826ms | Genesis document-based (CAS), Mutinynet, 1 Update (CAS), SMT Proof (Sidecar) |
| 11b | XFAIL | their-impl | 896ms | Genesis document-based (CAS), Mutinynet, 1 Update (CAS), SMT Proof (Sidecar) |


---

## Vector 11a - XFAIL

- **DID:** `did:btcr2:x1q4cytk3ae3y74w2q0k2ukf5hqdjvn7c33ajdu5dwmvk76h3k4sqrqmvw4hp`
- **Description:** Genesis document-based (CAS), Mutinynet, 1 Update (CAS), SMT Proof (Sidecar)
- **Method:** POST
- **Notes:** Same block/tx/SMT as 11b
- **Fault attribution:** their-impl
- **Known fail reason:** 33-byte SMT nonce (leading 0x00); spec requires 256-bit = 32 bytes
- **Duration:** 826ms
- **Exit code:** 1

**Command:**

```bash
btcr2 resolve -i did:btcr2:x1q4cytk3ae3y74w2q0k2ukf5hqdjvn7c33ajdu5dwmvk76h3k4sqrqmvw4hp -p /tmp/btcr2-danubetech-qfqAJ7/vector-11a.json
```

<details><summary>Sidecar (resolutionOptions sent via -p)</summary>

```json
{
  "sidecar": {
    "smtProofs": [
      {
        "id": "q1H_iaYG0Oq6gbrycYL-r7FjUsJLnIpHDn49TLeONNA",
        "nonce": "PfY53QgVh6WX5jm15SL0Rh2jzIKEClyBE3Q-B_l6q8h",
        "updateId": "njYNViJq2OmhSw1fLfARPCj12RY3VXKGWdS3-7OQ2BE",
        "collapsed": "AL__________________________________________",
        "hashes": [
          "8JWXL7chPKJXwg-i9O1EFTHan_oOO_RmglDpu_ugax0"
        ]
      }
    ]
  }
}
```

</details>

<details><summary>Captured output (stdout + stderr)</summary>

```
Error: Failed to resolve DID: did:btcr2:x1q4cytk3ae3y74w2q0k2ukf5hqdjvn7c33ajdu5dwmvk76h3k4sqrqmvw4hp
    at DidMethodApi.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/method.js:181:19)
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async DidBtcr2Api.resolveDid (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/api.js:121:16)
    at async Command.<anonymous> (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/commands/resolve.js:18:22)
    at async Command.parseAsync (/home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/command.js:1104:5)
    at async DidBtcr2Cli.run (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/cli.js:49:13)
    at async file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/bin/btcr2.js:4:1 {
  [cause]: Error: Non-zero padding: 64
      at convertRadix2 (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/@scure+base@1.2.6/node_modules/@scure/base/lib/esm/index.js:247:15)
      at decode (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/@scure+base@1.2.6/node_modules/@scure/base/lib/esm/index.js:289:36)
      at file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/@scure+base@1.2.6/node_modules/@scure/base/lib/esm/index.js:57:37
      at file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/@scure+base@1.2.6/node_modules/@scure/base/lib/esm/index.js:57:35
      at Object.decode (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/@scure+base@1.2.6/node_modules/@scure/base/lib/esm/index.js:57:35)
      at base64UrlToHash (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/smt/dist/esm/hash.js:169:33)
      at SMTBeacon.processSignals (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/beacon/smt-beacon.js:67:55)
      at Resolver.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/resolver.js:410:47)
      at DidMethodApi.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/method.js:170:34)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
}
```

</details>

---

## Vector 11b - XFAIL

- **DID:** `did:btcr2:x1q4plmrumnc5638xr74w59zg6yavk5laevq8r0jzm0xr7v2v0au655gn9xr0`
- **Description:** Genesis document-based (CAS), Mutinynet, 1 Update (CAS), SMT Proof (Sidecar)
- **Method:** POST
- **Notes:** Same block/tx/SMT as 11a
- **Fault attribution:** their-impl
- **Known fail reason:** 33-byte SMT nonce (leading 0x00); spec requires 256-bit = 32 bytes
- **Duration:** 896ms
- **Exit code:** 1

**Command:**

```bash
btcr2 resolve -i did:btcr2:x1q4plmrumnc5638xr74w59zg6yavk5laevq8r0jzm0xr7v2v0au655gn9xr0 -p /tmp/btcr2-danubetech-qfqAJ7/vector-11b.json
```

<details><summary>Sidecar (resolutionOptions sent via -p)</summary>

```json
{
  "sidecar": {
    "smtProofs": [
      {
        "id": "q1H_iaYG0Oq6gbrycYL-r7FjUsJLnIpHDn49TLeONNA",
        "nonce": "KiwPzZ5-HVp5MjJRABFqKGUmv2uvfIv3p4QVYxoCdU7",
        "updateId": "8JWXL7chPKJXwg-i9O1EFTHan_oOO_RmglDpu_ugax0",
        "collapsed": "AL__________________________________________",
        "hashes": [
          "njYNViJq2OmhSw1fLfARPCj12RY3VXKGWdS3-7OQ2BE"
        ]
      }
    ]
  }
}
```

</details>

<details><summary>Captured output (stdout + stderr)</summary>

```
Error: Failed to resolve DID: did:btcr2:x1q4plmrumnc5638xr74w59zg6yavk5laevq8r0jzm0xr7v2v0au655gn9xr0
    at DidMethodApi.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/method.js:181:19)
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async DidBtcr2Api.resolveDid (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/api.js:121:16)
    at async Command.<anonymous> (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/commands/resolve.js:18:22)
    at async Command.parseAsync (/home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/command.js:1104:5)
    at async DidBtcr2Cli.run (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/cli.js:49:13)
    at async file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/bin/btcr2.js:4:1 {
  [cause]: Error: Non-zero padding: 192
      at convertRadix2 (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/@scure+base@1.2.6/node_modules/@scure/base/lib/esm/index.js:247:15)
      at decode (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/@scure+base@1.2.6/node_modules/@scure/base/lib/esm/index.js:289:36)
      at file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/@scure+base@1.2.6/node_modules/@scure/base/lib/esm/index.js:57:37
      at file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/@scure+base@1.2.6/node_modules/@scure/base/lib/esm/index.js:57:35
      at Object.decode (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/@scure+base@1.2.6/node_modules/@scure/base/lib/esm/index.js:57:35)
      at base64UrlToHash (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/smt/dist/esm/hash.js:169:33)
      at SMTBeacon.processSignals (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/beacon/smt-beacon.js:67:55)
      at Resolver.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/resolver.js:410:47)
      at DidMethodApi.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/method.js:170:34)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
}
```

</details>

