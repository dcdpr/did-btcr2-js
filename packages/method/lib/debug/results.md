# Danubetech Vector Resolution Report

- **Generated:** `2026-05-26T12:13:43-04:00`
- **btcr2 version:** `btcr2 0.8.0`
- **Per-vector timeout:** 60s
- **Vectors run:** 16

## Summary

| Result | Count |
|---|---|
| PASS | 9 |
| FAIL | 4 |
| XFAIL | 3 |
| TIMEOUT | 0 |
| **Total** | **16** |

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
| 01 | PASS | n/a | 809ms | Public Key-based, Mutinynet, no Update |
| 02 | PASS | n/a | 588ms | Public Key-based, Mutinynet, 1 Update (Sidecar) |
| 03 | PASS | n/a | 235ms | Genesis document-based (Sidecar), Mutinynet, no Update |
| 04 | FAIL | unknown | 572ms | Genesis document-based (Sidecar), Mutinynet, 1 Update (Sidecar) |
| 05 | PASS | n/a | 833ms | Genesis document-based (CAS), Mutinynet, no Update |
| 06 | FAIL | unknown | 999ms | Genesis document-based (CAS), Mutinynet, 3 Updates (CAS) |
| 07 | PASS | n/a | 600ms | Public Key-based, Mutinynet, Deactivate (Sidecar) |
| 08 | FAIL | unknown | 974ms | Genesis document-based (CAS), Mutinynet, 1 Update (CAS) + Deactivate (CAS) |
| 09a | PASS | n/a | 1021ms | Genesis document-based (CAS), Mutinynet, 1 Update (CAS), CAS Announcement Map (CAS) |
| 09b | PASS | n/a | 989ms | Genesis document-based (CAS), Mutinynet, 1 Update (CAS), CAS Announcement Map (CAS) |
| 10a | PASS | n/a | 631ms | Genesis document-based (Sidecar), Mutinynet, 1 Update (Sidecar), CAS Announcement Map (Sidecar) |
| 10b | PASS | n/a | 609ms | Genesis document-based (Sidecar), Mutinynet, 1 Update (Sidecar), CAS Announcement Map (Sidecar) |
| 11a | XFAIL | their-impl | 812ms | Genesis document-based (CAS), Mutinynet, 1 Update (CAS), SMT Proof (Sidecar) |
| 11b | XFAIL | their-impl | 863ms | Genesis document-based (CAS), Mutinynet, 1 Update (CAS), SMT Proof (Sidecar) |
| 12a | XFAIL | their-impl | 778ms | Genesis document-based (Sidecar), Mutinynet, 1 Update (Sidecar), SMT Proof (Sidecar) |
| 12b | FAIL | unknown | 676ms | Genesis document-based (Sidecar), Mutinynet, 1 Update (Sidecar), SMT Proof (Sidecar) |


---

## Vector 01 - PASS

- **DID:** `did:btcr2:k1q5ppmnfjqp0qe5klmnll9tazz9jd5ds43x5xfsr3hu9jdgaldu0d3jgs0vj4r`
- **Description:** Public Key-based, Mutinynet, no Update
- **Method:** GET
- **Fault attribution:** n/a
- **Duration:** 809ms
- **Exit code:** 0

**Command:**

```bash
btcr2 resolve -i did:btcr2:k1q5ppmnfjqp0qe5klmnll9tazz9jd5ds43x5xfsr3hu9jdgaldu0d3jgs0vj4r
```

<details><summary>Captured output (stdout + stderr)</summary>

```
{
  "didResolutionMetadata": {},
  "didDocument": {
    "id": "did:btcr2:k1q5ppmnfjqp0qe5klmnll9tazz9jd5ds43x5xfsr3hu9jdgaldu0d3jgs0vj4r",
    "@context": [
      "https://www.w3.org/ns/did/v1.1",
      "https://btcr2.dev/context/v1"
    ],
    "verificationMethod": [
      {
        "id": "did:btcr2:k1q5ppmnfjqp0qe5klmnll9tazz9jd5ds43x5xfsr3hu9jdgaldu0d3jgs0vj4r#initialKey",
        "type": "Multikey",
        "controller": "did:btcr2:k1q5ppmnfjqp0qe5klmnll9tazz9jd5ds43x5xfsr3hu9jdgaldu0d3jgs0vj4r",
        "publicKeyMultibase": "zQ3shPR84BcKSnymCiDRT471eDQTLqVwHtqnPDYKEWspGyxqW"
      }
    ],
    "authentication": [
      "did:btcr2:k1q5ppmnfjqp0qe5klmnll9tazz9jd5ds43x5xfsr3hu9jdgaldu0d3jgs0vj4r#initialKey"
    ],
    "assertionMethod": [
      "did:btcr2:k1q5ppmnfjqp0qe5klmnll9tazz9jd5ds43x5xfsr3hu9jdgaldu0d3jgs0vj4r#initialKey"
    ],
    "capabilityInvocation": [
      "did:btcr2:k1q5ppmnfjqp0qe5klmnll9tazz9jd5ds43x5xfsr3hu9jdgaldu0d3jgs0vj4r#initialKey"
    ],
    "capabilityDelegation": [
      "did:btcr2:k1q5ppmnfjqp0qe5klmnll9tazz9jd5ds43x5xfsr3hu9jdgaldu0d3jgs0vj4r#initialKey"
    ],
    "service": [
      {
        "id": "did:btcr2:k1q5ppmnfjqp0qe5klmnll9tazz9jd5ds43x5xfsr3hu9jdgaldu0d3jgs0vj4r#initialP2PKH",
        "type": "SingletonBeacon",
        "serviceEndpoint": "bitcoin:mhfw2gFKNU1YB8dpaqokbyrgMfLErrFvVH"
      },
      {
        "id": "did:btcr2:k1q5ppmnfjqp0qe5klmnll9tazz9jd5ds43x5xfsr3hu9jdgaldu0d3jgs0vj4r#initialP2WPKH",
        "type": "SingletonBeacon",
        "serviceEndpoint": "bitcoin:tb1qz730qmxhvys7he2jqlzxt2tldqh93v40qdv55s"
      },
      {
        "id": "did:btcr2:k1q5ppmnfjqp0qe5klmnll9tazz9jd5ds43x5xfsr3hu9jdgaldu0d3jgs0vj4r#initialP2TR",
        "type": "SingletonBeacon",
        "serviceEndpoint": "bitcoin:tb1ps9rmdxfjdfqmyd8k3w45nxchr0akxgt3y6x5u5u0ras75uhytsvsjs8fxq"
      }
    ]
  },
  "didDocumentMetadata": {
    "versionId": "1",
    "deactivated": false
  }
}
```

</details>

---

## Vector 02 - PASS

- **DID:** `did:btcr2:k1q5p7drc8y5hhmvs2nncyuq73ts98arnqv5ce446vwydafuu2mp9rp6szethjk`
- **Description:** Public Key-based, Mutinynet, 1 Update (Sidecar)
- **Method:** POST
- **Fault attribution:** n/a
- **Duration:** 588ms
- **Exit code:** 0

**Command:**

```bash
btcr2 resolve -i did:btcr2:k1q5p7drc8y5hhmvs2nncyuq73ts98arnqv5ce446vwydafuu2mp9rp6szethjk -p /tmp/btcr2-danubetech-hij5q7/vector-02.json
```

<details><summary>Sidecar (resolutionOptions sent via -p)</summary>

```json
{
  "sidecar": {
    "updates": [
      {
        "@context": [
          "https://btcr2.dev/context/v1",
          "https://w3id.org/json-ld-patch/v1",
          "https://w3id.org/zcap/v1",
          "https://w3id.org/security/data-integrity/v2"
        ],
        "patch": [
          {
            "op": "add",
            "path": "/service/3",
            "value": {
              "id": "#didcomm",
              "type": "DIDCommMessaging",
              "serviceEndpoint": "http://example.com/didcomm/"
            }
          }
        ],
        "sourceHash": "osaUrsl3XhLlm-J4hKrqmxP6G0y9sfqseaF4HPPUe_8",
        "targetHash": "eS9wA7p1qiQHGEuyz4swjnZNnFz9VkBSPff6i6XeP_M",
        "targetVersionId": 2,
        "proof": {
          "type": "DataIntegrityProof",
          "cryptosuite": "bip340-jcs-2025",
          "verificationMethod": "did:btcr2:k1q5p7drc8y5hhmvs2nncyuq73ts98arnqv5ce446vwydafuu2mp9rp6szethjk#initialKey",
          "proofPurpose": "capabilityInvocation",
          "capability": "urn:zcap:root:did%3Abtcr2%3Ak1q5p7drc8y5hhmvs2nncyuq73ts98arnqv5ce446vwydafuu2mp9rp6szethjk",
          "capabilityAction": "Write",
          "proofValue": "z5DhhjMk8gXULWNKRwqJqGbqZF94ov7zjKS6YkaCGxoDa2f3WT3zprMUc1p62w2cRRdkNAhR4rfGJpxZZFfHsdrJB"
        }
      }
    ]
  }
}
```

</details>

<details><summary>Captured output (stdout + stderr)</summary>

```
{
  "didResolutionMetadata": {},
  "didDocument": {
    "id": "did:btcr2:k1q5p7drc8y5hhmvs2nncyuq73ts98arnqv5ce446vwydafuu2mp9rp6szethjk",
    "@context": [
      "https://www.w3.org/ns/did/v1.1",
      "https://btcr2.dev/context/v1"
    ],
    "verificationMethod": [
      {
        "id": "did:btcr2:k1q5p7drc8y5hhmvs2nncyuq73ts98arnqv5ce446vwydafuu2mp9rp6szethjk#initialKey",
        "type": "Multikey",
        "controller": "did:btcr2:k1q5p7drc8y5hhmvs2nncyuq73ts98arnqv5ce446vwydafuu2mp9rp6szethjk",
        "publicKeyMultibase": "zQ3shvA7PiHuFCk1b3TeQ7Qu8YYjw4r7i5r2jVaXZLVkMjniV"
      }
    ],
    "authentication": [
      "did:btcr2:k1q5p7drc8y5hhmvs2nncyuq73ts98arnqv5ce446vwydafuu2mp9rp6szethjk#initialKey"
    ],
    "assertionMethod": [
      "did:btcr2:k1q5p7drc8y5hhmvs2nncyuq73ts98arnqv5ce446vwydafuu2mp9rp6szethjk#initialKey"
    ],
    "capabilityInvocation": [
      "did:btcr2:k1q5p7drc8y5hhmvs2nncyuq73ts98arnqv5ce446vwydafuu2mp9rp6szethjk#initialKey"
    ],
    "capabilityDelegation": [
      "did:btcr2:k1q5p7drc8y5hhmvs2nncyuq73ts98arnqv5ce446vwydafuu2mp9rp6szethjk#initialKey"
    ],
    "service": [
      {
        "id": "did:btcr2:k1q5p7drc8y5hhmvs2nncyuq73ts98arnqv5ce446vwydafuu2mp9rp6szethjk#initialP2PKH",
        "type": "SingletonBeacon",
        "serviceEndpoint": "bitcoin:mkdx3RWmFBKegVDMmQDsJUxQNsU4A71wqB"
      },
      {
        "id": "did:btcr2:k1q5p7drc8y5hhmvs2nncyuq73ts98arnqv5ce446vwydafuu2mp9rp6szethjk#initialP2WPKH",
        "type": "SingletonBeacon",
        "serviceEndpoint": "bitcoin:tb1q8q44fqzwd93eq86hsjrk49shs80uyvwcyjxz39"
      },
      {
        "id": "did:btcr2:k1q5p7drc8y5hhmvs2nncyuq73ts98arnqv5ce446vwydafuu2mp9rp6szethjk#initialP2TR",
        "type": "SingletonBeacon",
        "serviceEndpoint": "bitcoin:tb1pg982ehtkxwgs8d2jkypmy2cpcxns5lykdaa7munctvp9p8tfufsqxtf9fa"
      },
      {
        "id": "#didcomm",
        "type": "DIDCommMessaging",
        "serviceEndpoint": "http://example.com/didcomm/"
      }
    ]
  },
  "didDocumentMetadata": {
    "versionId": "2",
    "confirmations": 110274,
    "updated": "2026-04-15T00:18:39Z",
    "deactivated": false
  }
}
```

</details>

---

## Vector 03 - PASS

- **DID:** `did:btcr2:x1qhcxze0km2e883qex8vr45u8d4v04lmmx2zkjm3mvmtj8a9wtnny5cc2l2q`
- **Description:** Genesis document-based (Sidecar), Mutinynet, no Update
- **Method:** POST
- **Fault attribution:** n/a
- **Duration:** 235ms
- **Exit code:** 0

**Command:**

```bash
btcr2 resolve -i did:btcr2:x1qhcxze0km2e883qex8vr45u8d4v04lmmx2zkjm3mvmtj8a9wtnny5cc2l2q -p /tmp/btcr2-danubetech-hij5q7/vector-03.json
```

<details><summary>Sidecar (resolutionOptions sent via -p)</summary>

```json
{
  "sidecar": {
    "genesisDocument": {
      "verificationMethod": [
        {
          "type": "Multikey",
          "id": "#initialKey",
          "publicKeyMultibase": "zQ3shqQAyNAMywkPs8xs3boi3GgzaDs7YV5PcK67faeKn7fJJ",
          "controller": "did:btcr2:_"
        }
      ],
      "service": [
        {
          "id": "#didcomm",
          "type": "DIDCommMessaging",
          "serviceEndpoint": "http://example.com/didcomm"
        }
      ],
      "assertionMethod": [
        "#initialKey"
      ],
      "capabilityDelegation": [
        "#initialKey"
      ],
      "capabilityInvocation": [
        "#initialKey"
      ],
      "authentication": [
        "#initialKey"
      ],
      "id": "did:btcr2:_",
      "@context": [
        "https://www.w3.org/ns/did/v1.1",
        "https://btcr2.dev/context/v1"
      ]
    }
  }
}
```

</details>

<details><summary>Captured output (stdout + stderr)</summary>

```
{
  "didResolutionMetadata": {},
  "didDocument": {
    "id": "did:btcr2:x1qhcxze0km2e883qex8vr45u8d4v04lmmx2zkjm3mvmtj8a9wtnny5cc2l2q",
    "@context": [
      "https://www.w3.org/ns/did/v1.1",
      "https://btcr2.dev/context/v1"
    ],
    "verificationMethod": [
      {
        "type": "Multikey",
        "id": "#initialKey",
        "publicKeyMultibase": "zQ3shqQAyNAMywkPs8xs3boi3GgzaDs7YV5PcK67faeKn7fJJ",
        "controller": "did:btcr2:x1qhcxze0km2e883qex8vr45u8d4v04lmmx2zkjm3mvmtj8a9wtnny5cc2l2q"
      }
    ],
    "authentication": [
      "#initialKey"
    ],
    "assertionMethod": [
      "#initialKey"
    ],
    "capabilityInvocation": [
      "#initialKey"
    ],
    "capabilityDelegation": [
      "#initialKey"
    ],
    "service": [
      {
        "id": "#didcomm",
        "type": "DIDCommMessaging",
        "serviceEndpoint": "http://example.com/didcomm"
      }
    ]
  },
  "didDocumentMetadata": {
    "versionId": "1",
    "deactivated": false
  }
}
```

</details>

---

## Vector 04 - FAIL

- **DID:** `did:btcr2:x1qkel9rl0ltz6w5m3rypnsa4tncu5yst45qdsmwtms94zx6wm7cc2q8nnfh7`
- **Description:** Genesis document-based (Sidecar), Mutinynet, 1 Update (Sidecar)
- **Method:** POST
- **Fault attribution:** unknown
- **Duration:** 572ms
- **Exit code:** 1

**Command:**

```bash
btcr2 resolve -i did:btcr2:x1qkel9rl0ltz6w5m3rypnsa4tncu5yst45qdsmwtms94zx6wm7cc2q8nnfh7 -p /tmp/btcr2-danubetech-hij5q7/vector-04.json
```

<details><summary>Sidecar (resolutionOptions sent via -p)</summary>

```json
{
  "sidecar": {
    "genesisDocument": {
      "verificationMethod": [
        {
          "type": "Multikey",
          "id": "#initialKey",
          "publicKeyMultibase": "zQ3shQvp7YmdxSZMHYWvfD5GvoavZz4REJ5P4Snw6Qy2PVN1o",
          "controller": "did:btcr2:_"
        }
      ],
      "service": [
        {
          "id": "#didcomm",
          "type": "DIDCommMessaging",
          "serviceEndpoint": "http://example.com/didcomm"
        },
        {
          "type": "SingletonBeacon",
          "id": "#initialP2PKH",
          "serviceEndpoint": "bitcoin:mwSrpBnrNZp1uWat1hf2dynpWKs7JWF518"
        },
        {
          "type": "SingletonBeacon",
          "id": "#initialP2WPKH",
          "serviceEndpoint": "bitcoin:tb1q46auvxdypkjt75ny4n99v97j95hz592g675nyq"
        },
        {
          "type": "SingletonBeacon",
          "id": "#initialP2TR",
          "serviceEndpoint": "bitcoin:tb1pj70k34zj0fnf7wlqdvpm93aesyg496kjaws9cyemaqhnggp8cp9qx7c4je"
        }
      ],
      "assertionMethod": [
        "#initialKey"
      ],
      "capabilityDelegation": [
        "#initialKey"
      ],
      "capabilityInvocation": [
        "#initialKey"
      ],
      "authentication": [
        "#initialKey"
      ],
      "id": "did:btcr2:_",
      "@context": [
        "https://www.w3.org/ns/did/v1.1",
        "https://btcr2.dev/context/v1"
      ]
    },
    "updates": [
      {
        "@context": [
          "https://btcr2.dev/context/v1",
          "https://w3id.org/json-ld-patch/v1",
          "https://w3id.org/zcap/v1",
          "https://w3id.org/security/data-integrity/v2"
        ],
        "patch": [
          {
            "op": "add",
            "path": "/service/4",
            "value": {
              "id": "#dwn",
              "type": "DecentralizedWebNode",
              "serviceEndpoint": "http://example.com/dwn"
            }
          }
        ],
        "sourceHash": "AC_466VA2q_trSzux771a0a1a9ynBc2LT7Nf8m0Zido",
        "targetHash": "jqdZFDnOP9Ftu4lOhBRwPINoneKy7p6vLnhwlLjHQmI",
        "targetVersionId": 2,
        "proof": {
          "type": "DataIntegrityProof",
          "cryptosuite": "bip340-jcs-2025",
          "verificationMethod": "did:btcr2:x1qkel9rl0ltz6w5m3rypnsa4tncu5yst45qdsmwtms94zx6wm7cc2q8nnfh7#initialKey",
          "proofPurpose": "capabilityInvocation",
          "capability": "urn:zcap:root:did%3Abtcr2%3Ax1qkel9rl0ltz6w5m3rypnsa4tncu5yst45qdsmwtms94zx6wm7cc2q8nnfh7",
          "capabilityAction": "Write",
          "proofValue": "z3XzDFYWd3jNgVGPf1Hk2JXJZA1JE4aBE5GHrurgsAisp5AgLapXPdLvmXok7YJrXWEaCLe9TTyYNrnimGkUPoqU9"
        }
      }
    ]
  }
}
```

</details>

<details><summary>Captured output (stdout + stderr)</summary>

```
Error: Failed to resolve DID: did:btcr2:x1qkel9rl0ltz6w5m3rypnsa4tncu5yst45qdsmwtms94zx6wm7cc2q8nnfh7
    at DidMethodApi.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/method.js:181:19)
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    ... 3 lines matching cause stack trace ...
    at async DidBtcr2Cli.run (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/cli.js:49:13)
    at async file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/bin/btcr2.js:4:1 {
  [cause]: DidError: internalError: A verification method intended for signing could not be determined from the DID Document
      at DidBtcr2.getSigningMethod (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/did-btcr2.js:172:19)
      at Resolver.applyUpdate (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/resolver.js:317:29)
      at Resolver.updates (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/resolver.js:230:45)
      at Resolver.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/resolver.js:432:59)
      at DidMethodApi.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/method.js:170:34)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
      at async DidBtcr2Api.resolveDid (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/api.js:121:16)
      at async Command.<anonymous> (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/commands/resolve.js:18:22)
      at async Command.parseAsync (/home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/command.js:1104:5)
      at async DidBtcr2Cli.run (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/cli.js:49:13) {
    code: 'internalError'
  }
}
```

</details>

---

## Vector 05 - PASS

- **DID:** `did:btcr2:x1q4n7jq922q0s3cejckmjyxlx9z8mtl3x6fusgz8xlu7jc69sqefn79wmhrc`
- **Description:** Genesis document-based (CAS), Mutinynet, no Update
- **Method:** GET
- **Fault attribution:** n/a
- **Duration:** 833ms
- **Exit code:** 0

**Command:**

```bash
btcr2 resolve -i did:btcr2:x1q4n7jq922q0s3cejckmjyxlx9z8mtl3x6fusgz8xlu7jc69sqefn79wmhrc
```

<details><summary>Captured output (stdout + stderr)</summary>

```
{
  "didResolutionMetadata": {},
  "didDocument": {
    "id": "did:btcr2:x1q4n7jq922q0s3cejckmjyxlx9z8mtl3x6fusgz8xlu7jc69sqefn79wmhrc",
    "@context": [
      "https://www.w3.org/ns/did/v1.1",
      "https://btcr2.dev/context/v1"
    ],
    "verificationMethod": [
      {
        "controller": "did:btcr2:x1q4n7jq922q0s3cejckmjyxlx9z8mtl3x6fusgz8xlu7jc69sqefn79wmhrc",
        "id": "#initialKey",
        "publicKeyMultibase": "zQ3shugdsN3SN1ZPHhRtvxBfcHGtEboAdWmnv5WZC6nsbmQ1V",
        "type": "Multikey"
      }
    ],
    "authentication": [
      "#initialKey"
    ],
    "assertionMethod": [
      "#initialKey"
    ],
    "capabilityInvocation": [
      "#initialKey"
    ],
    "capabilityDelegation": [
      "#initialKey"
    ],
    "service": [
      {
        "id": "#didcomm",
        "serviceEndpoint": "http://example.com/didcomm",
        "type": "DIDCommMessaging"
      },
      {
        "id": "#initialP2PKH",
        "serviceEndpoint": "bitcoin:mrvx2BJZuKnaj8C2pysWv7seMxhBUh6hPD",
        "type": "SingletonBeacon"
      },
      {
        "id": "#initialP2WPKH",
        "serviceEndpoint": "bitcoin:tb1q05ejxc34jpmg5hp4eck7wgyrsraucf7aua7ywc",
        "type": "SingletonBeacon"
      },
      {
        "id": "#initialP2TR",
        "serviceEndpoint": "bitcoin:tb1p4na2x65g00up3mjf7jaxjaerw0w4tg4xavtwrjshkyfvg7ml4ttqk4ht5x",
        "type": "SingletonBeacon"
      }
    ]
  },
  "didDocumentMetadata": {
    "versionId": "1",
    "deactivated": false
  }
}
```

</details>

---

## Vector 06 - FAIL

- **DID:** `did:btcr2:x1q4tpl8hpeyr2et0lzeqsr0pakjmh796ry98vgvms9gw7fsk7eg302llx8ne`
- **Description:** Genesis document-based (CAS), Mutinynet, 3 Updates (CAS)
- **Method:** GET
- **Fault attribution:** unknown
- **Duration:** 999ms
- **Exit code:** 1

**Command:**

```bash
btcr2 resolve -i did:btcr2:x1q4tpl8hpeyr2et0lzeqsr0pakjmh796ry98vgvms9gw7fsk7eg302llx8ne
```

<details><summary>Captured output (stdout + stderr)</summary>

```
Error: Failed to resolve DID: did:btcr2:x1q4tpl8hpeyr2et0lzeqsr0pakjmh796ry98vgvms9gw7fsk7eg302llx8ne
    at DidMethodApi.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/method.js:181:19)
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    ... 3 lines matching cause stack trace ...
    at async DidBtcr2Cli.run (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/cli.js:49:13)
    at async file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/bin/btcr2.js:4:1 {
  [cause]: DidError: internalError: A verification method intended for signing could not be determined from the DID Document
      at DidBtcr2.getSigningMethod (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/did-btcr2.js:172:19)
      at Resolver.applyUpdate (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/resolver.js:317:29)
      at Resolver.updates (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/resolver.js:230:45)
      at Resolver.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/resolver.js:432:59)
      at DidMethodApi.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/method.js:170:34)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
      at async DidBtcr2Api.resolveDid (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/api.js:121:16)
      at async Command.<anonymous> (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/commands/resolve.js:18:22)
      at async Command.parseAsync (/home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/command.js:1104:5)
      at async DidBtcr2Cli.run (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/cli.js:49:13) {
    code: 'internalError'
  }
}
```

</details>

---

## Vector 07 - PASS

- **DID:** `did:btcr2:k1q5plamr904xqqdh96hnxjrcmuhyg2a466dggcvzmmpwgnl28r25dwmspg7d8h`
- **Description:** Public Key-based, Mutinynet, Deactivate (Sidecar)
- **Method:** POST
- **Fault attribution:** n/a
- **Duration:** 600ms
- **Exit code:** 0

**Command:**

```bash
btcr2 resolve -i did:btcr2:k1q5plamr904xqqdh96hnxjrcmuhyg2a466dggcvzmmpwgnl28r25dwmspg7d8h -p /tmp/btcr2-danubetech-hij5q7/vector-07.json
```

<details><summary>Sidecar (resolutionOptions sent via -p)</summary>

```json
{
  "sidecar": {
    "updates": [
      {
        "@context": [
          "https://btcr2.dev/context/v1",
          "https://w3id.org/json-ld-patch/v1",
          "https://w3id.org/zcap/v1",
          "https://w3id.org/security/data-integrity/v2"
        ],
        "patch": [
          {
            "op": "add",
            "path": "/deactivated",
            "value": true
          }
        ],
        "sourceHash": "-EN6_rl8XRZzAhpbFRDowUWuMe_tQXNclIg7KhovxGw",
        "targetHash": "TFXmM2sA5O-tGh-1fgVT9HBVG4aCh635ei8vQZnznxQ",
        "targetVersionId": 2,
        "proof": {
          "type": "DataIntegrityProof",
          "cryptosuite": "bip340-jcs-2025",
          "verificationMethod": "did:btcr2:k1q5plamr904xqqdh96hnxjrcmuhyg2a466dggcvzmmpwgnl28r25dwmspg7d8h#initialKey",
          "proofPurpose": "capabilityInvocation",
          "capability": "urn:zcap:root:did%3Abtcr2%3Ak1q5plamr904xqqdh96hnxjrcmuhyg2a466dggcvzmmpwgnl28r25dwmspg7d8h",
          "capabilityAction": "Write",
          "proofValue": "z3LGpf1RpP8HeVEFfX7PWuUmmVusn48yoDjZnDKGsmyb9xz4PScVTSVbhaZxRcaP8FKHmiAPtFY7jc6nYFLj92vth"
        }
      }
    ]
  }
}
```

</details>

<details><summary>Captured output (stdout + stderr)</summary>

```
{
  "didResolutionMetadata": {},
  "didDocument": {
    "id": "did:btcr2:k1q5plamr904xqqdh96hnxjrcmuhyg2a466dggcvzmmpwgnl28r25dwmspg7d8h",
    "@context": [
      "https://www.w3.org/ns/did/v1.1",
      "https://btcr2.dev/context/v1"
    ],
    "verificationMethod": [
      {
        "id": "did:btcr2:k1q5plamr904xqqdh96hnxjrcmuhyg2a466dggcvzmmpwgnl28r25dwmspg7d8h#initialKey",
        "type": "Multikey",
        "controller": "did:btcr2:k1q5plamr904xqqdh96hnxjrcmuhyg2a466dggcvzmmpwgnl28r25dwmspg7d8h",
        "publicKeyMultibase": "zQ3shwoDkcWNHb1YR8wbE3oRQtPPG4EzuzKn6bN1sm8MPryUh"
      }
    ],
    "authentication": [
      "did:btcr2:k1q5plamr904xqqdh96hnxjrcmuhyg2a466dggcvzmmpwgnl28r25dwmspg7d8h#initialKey"
    ],
    "assertionMethod": [
      "did:btcr2:k1q5plamr904xqqdh96hnxjrcmuhyg2a466dggcvzmmpwgnl28r25dwmspg7d8h#initialKey"
    ],
    "capabilityInvocation": [
      "did:btcr2:k1q5plamr904xqqdh96hnxjrcmuhyg2a466dggcvzmmpwgnl28r25dwmspg7d8h#initialKey"
    ],
    "capabilityDelegation": [
      "did:btcr2:k1q5plamr904xqqdh96hnxjrcmuhyg2a466dggcvzmmpwgnl28r25dwmspg7d8h#initialKey"
    ],
    "service": [
      {
        "id": "did:btcr2:k1q5plamr904xqqdh96hnxjrcmuhyg2a466dggcvzmmpwgnl28r25dwmspg7d8h#initialP2PKH",
        "type": "SingletonBeacon",
        "serviceEndpoint": "bitcoin:mjvhwFcRCpycs47qRSKHJjr7vDpQKQZEe2"
      },
      {
        "id": "did:btcr2:k1q5plamr904xqqdh96hnxjrcmuhyg2a466dggcvzmmpwgnl28r25dwmspg7d8h#initialP2WPKH",
        "type": "SingletonBeacon",
        "serviceEndpoint": "bitcoin:tb1qxp0gqrkh9y9c5zw9shss7pcpus4ced4keutjju"
      },
      {
        "id": "did:btcr2:k1q5plamr904xqqdh96hnxjrcmuhyg2a466dggcvzmmpwgnl28r25dwmspg7d8h#initialP2TR",
        "type": "SingletonBeacon",
        "serviceEndpoint": "bitcoin:tb1pxyucvr2phdmpyhz8c89v64zuvlzre2d8r928ehguxdss76ppupns5ycf5g"
      }
    ],
    "deactivated": true
  },
  "didDocumentMetadata": {
    "versionId": "2",
    "confirmations": 53183,
    "updated": "2026-05-06T13:27:53Z",
    "deactivated": true
  }
}
```

</details>

---

## Vector 08 - FAIL

- **DID:** `did:btcr2:x1q465l26md3gu8y8fzxcae3wzx9q9qntrrzsu6p9elx68e2wu03flzemt2zq`
- **Description:** Genesis document-based (CAS), Mutinynet, 1 Update (CAS) + Deactivate (CAS)
- **Method:** GET
- **Fault attribution:** unknown
- **Duration:** 974ms
- **Exit code:** 1

**Command:**

```bash
btcr2 resolve -i did:btcr2:x1q465l26md3gu8y8fzxcae3wzx9q9qntrrzsu6p9elx68e2wu03flzemt2zq
```

<details><summary>Captured output (stdout + stderr)</summary>

```
Error: Failed to resolve DID: did:btcr2:x1q465l26md3gu8y8fzxcae3wzx9q9qntrrzsu6p9elx68e2wu03flzemt2zq
    at DidMethodApi.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/method.js:181:19)
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    ... 3 lines matching cause stack trace ...
    at async DidBtcr2Cli.run (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/cli.js:49:13)
    at async file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/bin/btcr2.js:4:1 {
  [cause]: DidError: internalError: A verification method intended for signing could not be determined from the DID Document
      at DidBtcr2.getSigningMethod (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/did-btcr2.js:172:19)
      at Resolver.applyUpdate (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/resolver.js:317:29)
      at Resolver.updates (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/resolver.js:230:45)
      at Resolver.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/resolver.js:432:59)
      at DidMethodApi.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/method.js:170:34)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
      at async DidBtcr2Api.resolveDid (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/api.js:121:16)
      at async Command.<anonymous> (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/commands/resolve.js:18:22)
      at async Command.parseAsync (/home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/command.js:1104:5)
      at async DidBtcr2Cli.run (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/cli.js:49:13) {
    code: 'internalError'
  }
}
```

</details>

---

## Vector 09a - PASS

- **DID:** `did:btcr2:x1q5pxp24p923v36m8kfzfd3cwtpsgpl5ackq23uvph2qsrzjhsrq57gnv5yk`
- **Description:** Genesis document-based (CAS), Mutinynet, 1 Update (CAS), CAS Announcement Map (CAS)
- **Method:** GET
- **Notes:** Same block/tx/CAS Announcement Map as 09b
- **Fault attribution:** n/a
- **Duration:** 1021ms
- **Exit code:** 0

**Command:**

```bash
btcr2 resolve -i did:btcr2:x1q5pxp24p923v36m8kfzfd3cwtpsgpl5ackq23uvph2qsrzjhsrq57gnv5yk
```

<details><summary>Captured output (stdout + stderr)</summary>

```
{
  "didResolutionMetadata": {},
  "didDocument": {
    "id": "did:btcr2:x1q5pxp24p923v36m8kfzfd3cwtpsgpl5ackq23uvph2qsrzjhsrq57gnv5yk",
    "@context": [
      "https://www.w3.org/ns/did/v1.1",
      "https://btcr2.dev/context/v1"
    ],
    "verificationMethod": [
      {
        "controller": "did:btcr2:x1q5pxp24p923v36m8kfzfd3cwtpsgpl5ackq23uvph2qsrzjhsrq57gnv5yk",
        "id": "#initialKey",
        "publicKeyMultibase": "zQ3shvWZVQPJzeeEHnAdVF4RPfd8p4moENuNdJjDe5SqKK5pb",
        "type": "Multikey"
      }
    ],
    "authentication": [
      "#initialKey"
    ],
    "assertionMethod": [
      "#initialKey"
    ],
    "capabilityInvocation": [
      "#initialKey"
    ],
    "capabilityDelegation": [
      "#initialKey"
    ],
    "service": [
      {
        "id": "#initialP2PKH",
        "serviceEndpoint": "bitcoin:mvV4VMMrNr424HxUQ4MRqfxiM88EyPqZPo",
        "type": "SingletonBeacon"
      },
      {
        "id": "#initialP2WPKH",
        "serviceEndpoint": "bitcoin:tb1q5shrnksvprr8wvldultdx0pqrspd93xl0uzupw",
        "type": "SingletonBeacon"
      },
      {
        "id": "#initialP2TR",
        "serviceEndpoint": "bitcoin:tb1pqx2kqp7q0wvlram5axyx8z20pwj393qev9p40ece4nev6zwxfhaq5x2crs",
        "type": "SingletonBeacon"
      },
      {
        "id": "#cohort-mutinynet-cas-2",
        "serviceEndpoint": "bitcoin:tb1ps8x2wuqs93azj3q3xxeddt7mxyfp82cx5fhcg8y9py8sckavgduq9s69ej",
        "type": "CASBeacon"
      }
    ]
  },
  "didDocumentMetadata": {
    "versionId": "1",
    "deactivated": false
  }
}
```

</details>

---

## Vector 09b - PASS

- **DID:** `did:btcr2:x1q587lk56v2rfnlpzerknx5tlht03c3j2gd27mvj7gqthjym9fn425rc9ygv`
- **Description:** Genesis document-based (CAS), Mutinynet, 1 Update (CAS), CAS Announcement Map (CAS)
- **Method:** GET
- **Notes:** Same block/tx/CAS Announcement Map as 09a
- **Fault attribution:** n/a
- **Duration:** 989ms
- **Exit code:** 0

**Command:**

```bash
btcr2 resolve -i did:btcr2:x1q587lk56v2rfnlpzerknx5tlht03c3j2gd27mvj7gqthjym9fn425rc9ygv
```

<details><summary>Captured output (stdout + stderr)</summary>

```
{
  "didResolutionMetadata": {},
  "didDocument": {
    "id": "did:btcr2:x1q587lk56v2rfnlpzerknx5tlht03c3j2gd27mvj7gqthjym9fn425rc9ygv",
    "@context": [
      "https://www.w3.org/ns/did/v1.1",
      "https://btcr2.dev/context/v1"
    ],
    "verificationMethod": [
      {
        "controller": "did:btcr2:x1q587lk56v2rfnlpzerknx5tlht03c3j2gd27mvj7gqthjym9fn425rc9ygv",
        "id": "#initialKey",
        "publicKeyMultibase": "zQ3shujatybesRvcaXif2NWyYjM4s7GQ3bGE7jfddNpRWGhSq",
        "type": "Multikey"
      }
    ],
    "authentication": [
      "#initialKey"
    ],
    "assertionMethod": [
      "#initialKey"
    ],
    "capabilityInvocation": [
      "#initialKey"
    ],
    "capabilityDelegation": [
      "#initialKey"
    ],
    "service": [
      {
        "id": "#initialP2PKH",
        "serviceEndpoint": "bitcoin:n2covR89MGTbZn5ErEjXfAngG9oTuMFPCf",
        "type": "SingletonBeacon"
      },
      {
        "id": "#initialP2WPKH",
        "serviceEndpoint": "bitcoin:tb1quamzt5e6vr7ntskuzamu7cqqvela4p7qcrhxsa",
        "type": "SingletonBeacon"
      },
      {
        "id": "#initialP2TR",
        "serviceEndpoint": "bitcoin:tb1ps76vm5yzjfewkmu4qdpqde5ukwl0ew2fkmqczp6nu6ufjff88fmsfqahyv",
        "type": "SingletonBeacon"
      },
      {
        "id": "#cohort-mutinynet-cas-2",
        "serviceEndpoint": "bitcoin:tb1ps8x2wuqs93azj3q3xxeddt7mxyfp82cx5fhcg8y9py8sckavgduq9s69ej",
        "type": "CASBeacon"
      }
    ]
  },
  "didDocumentMetadata": {
    "versionId": "1",
    "deactivated": false
  }
}
```

</details>

---

## Vector 10a - PASS

- **DID:** `did:btcr2:x1qhn7xvy3lhau0jy3e9n5klayh2vcyv07txu553eckw6gezn8vfrayduehz8`
- **Description:** Genesis document-based (Sidecar), Mutinynet, 1 Update (Sidecar), CAS Announcement Map (Sidecar)
- **Method:** POST
- **Notes:** Same block/tx/CAS Announcement Map as 10b
- **Fault attribution:** n/a
- **Duration:** 631ms
- **Exit code:** 0

**Command:**

```bash
btcr2 resolve -i did:btcr2:x1qhn7xvy3lhau0jy3e9n5klayh2vcyv07txu553eckw6gezn8vfrayduehz8 -p /tmp/btcr2-danubetech-hij5q7/vector-10a.json
```

<details><summary>Sidecar (resolutionOptions sent via -p)</summary>

```json
{
  "sidecar": {
    "genesisDocument": {
      "verificationMethod": [
        {
          "type": "Multikey",
          "id": "#initialKey",
          "publicKeyMultibase": "zQ3shaL4Nxb1u7ri88ba27o9jSknJV91Gbe6Cbebpyc87B635",
          "controller": "did:btcr2:_"
        }
      ],
      "assertionMethod": [
        "#initialKey"
      ],
      "capabilityDelegation": [
        "#initialKey"
      ],
      "capabilityInvocation": [
        "#initialKey"
      ],
      "authentication": [
        "#initialKey"
      ],
      "id": "did:btcr2:_",
      "@context": [
        "https://www.w3.org/ns/did/v1.1",
        "https://btcr2.dev/context/v1"
      ],
      "service": [
        {
          "type": "SingletonBeacon",
          "id": "#initialP2PKH",
          "serviceEndpoint": "bitcoin:mkiWTfbehzMpv7BvEb6ar64wEzo1ic3RKH"
        },
        {
          "type": "SingletonBeacon",
          "id": "#initialP2WPKH",
          "serviceEndpoint": "bitcoin:tb1q8yyquxkj90zmjpqu9wjmzwvx5ea709dkkgjzqg"
        },
        {
          "type": "SingletonBeacon",
          "id": "#initialP2TR",
          "serviceEndpoint": "bitcoin:tb1ph0z3j7k380hrm90x0z5afgz9yv79mmgs5ljel068c9dcrujdvensn2n6qz"
        },
        {
          "type": "CASBeacon",
          "id": "#cohort-mutinynet-cas-2",
          "serviceEndpoint": "bitcoin:tb1pd79gln669alnp86d3tcffqa77effk83v0exja368sa02fyxglxcqhwcj9l"
        }
      ]
    },
    "updates": [
      {
        "@context": [
          "https://btcr2.dev/context/v1",
          "https://w3id.org/json-ld-patch/v1",
          "https://w3id.org/zcap/v1",
          "https://w3id.org/security/data-integrity/v2"
        ],
        "patch": [
          {
            "op": "add",
            "path": "/service/4",
            "value": {
              "id": "#dwn",
              "type": "DecentralizedWebNode",
              "serviceEndpoint": "http://example.com/dwn"
            }
          }
        ],
        "sourceHash": "gVAhXy63r_pYljv7ahQkNymdZW_Q1sQQ8UvNqTWEAKU",
        "targetHash": "DRTduk6nIdcyEdmoVnPp_zN7tqTgeH6lPWRanYzcK9s",
        "targetVersionId": 2,
        "proof": {
          "type": "DataIntegrityProof",
          "cryptosuite": "bip340-jcs-2025",
          "verificationMethod": "did:btcr2:x1qhn7xvy3lhau0jy3e9n5klayh2vcyv07txu553eckw6gezn8vfrayduehz8#initialKey",
          "proofPurpose": "capabilityInvocation",
          "capability": "urn:zcap:root:did%3Abtcr2%3Ax1qhn7xvy3lhau0jy3e9n5klayh2vcyv07txu553eckw6gezn8vfrayduehz8",
          "capabilityAction": "Write",
          "proofValue": "zoYWD1syitvDRcbjT4UcAKyw6QJJ8DMkzDdAnt6CfcjyVsvp9A6r8kHKiPNaqFPe3iHxtQRDrQfS8wsAVja5qvGd"
        }
      }
    ],
    "casUpdates": [
      {
        "did:btcr2:x1qkvj2tupjlsntl5c6he47h2gjhwr6c5ndvp3u92s4a6hs7qec5s97run2aw": "vfRTPYVzLD8CRnadTEMXkkagbrxIrmHZT3DKAvFruFA",
        "did:btcr2:x1qhn7xvy3lhau0jy3e9n5klayh2vcyv07txu553eckw6gezn8vfrayduehz8": "RvFuBbfT57Y3xy4GbtWpSfJMfQ03IBs2Ksjdcxy1a0g"
      }
    ]
  }
}
```

</details>

<details><summary>Captured output (stdout + stderr)</summary>

```
{
  "didResolutionMetadata": {},
  "didDocument": {
    "id": "did:btcr2:x1qhn7xvy3lhau0jy3e9n5klayh2vcyv07txu553eckw6gezn8vfrayduehz8",
    "@context": [
      "https://www.w3.org/ns/did/v1.1",
      "https://btcr2.dev/context/v1"
    ],
    "verificationMethod": [
      {
        "type": "Multikey",
        "id": "#initialKey",
        "publicKeyMultibase": "zQ3shaL4Nxb1u7ri88ba27o9jSknJV91Gbe6Cbebpyc87B635",
        "controller": "did:btcr2:x1qhn7xvy3lhau0jy3e9n5klayh2vcyv07txu553eckw6gezn8vfrayduehz8"
      }
    ],
    "authentication": [
      "#initialKey"
    ],
    "assertionMethod": [
      "#initialKey"
    ],
    "capabilityInvocation": [
      "#initialKey"
    ],
    "capabilityDelegation": [
      "#initialKey"
    ],
    "service": [
      {
        "type": "SingletonBeacon",
        "id": "#initialP2PKH",
        "serviceEndpoint": "bitcoin:mkiWTfbehzMpv7BvEb6ar64wEzo1ic3RKH"
      },
      {
        "type": "SingletonBeacon",
        "id": "#initialP2WPKH",
        "serviceEndpoint": "bitcoin:tb1q8yyquxkj90zmjpqu9wjmzwvx5ea709dkkgjzqg"
      },
      {
        "type": "SingletonBeacon",
        "id": "#initialP2TR",
        "serviceEndpoint": "bitcoin:tb1ph0z3j7k380hrm90x0z5afgz9yv79mmgs5ljel068c9dcrujdvensn2n6qz"
      },
      {
        "type": "CASBeacon",
        "id": "#cohort-mutinynet-cas-2",
        "serviceEndpoint": "bitcoin:tb1pd79gln669alnp86d3tcffqa77effk83v0exja368sa02fyxglxcqhwcj9l"
      }
    ]
  },
  "didDocumentMetadata": {
    "versionId": "1",
    "deactivated": false
  }
}
```

</details>

---

## Vector 10b - PASS

- **DID:** `did:btcr2:x1qkvj2tupjlsntl5c6he47h2gjhwr6c5ndvp3u92s4a6hs7qec5s97run2aw`
- **Description:** Genesis document-based (Sidecar), Mutinynet, 1 Update (Sidecar), CAS Announcement Map (Sidecar)
- **Method:** POST
- **Notes:** Same block/tx/CAS Announcement Map as 10a
- **Fault attribution:** n/a
- **Duration:** 609ms
- **Exit code:** 0

**Command:**

```bash
btcr2 resolve -i did:btcr2:x1qkvj2tupjlsntl5c6he47h2gjhwr6c5ndvp3u92s4a6hs7qec5s97run2aw -p /tmp/btcr2-danubetech-hij5q7/vector-10b.json
```

<details><summary>Sidecar (resolutionOptions sent via -p)</summary>

```json
{
  "sidecar": {
    "genesisDocument": {
      "verificationMethod": [
        {
          "type": "Multikey",
          "id": "#initialKey",
          "publicKeyMultibase": "zQ3shsMVg4SAQNb561q2wLhuhQe3yv1WZXWx7zsm1k56iUsSB",
          "controller": "did:btcr2:_"
        }
      ],
      "assertionMethod": [
        "#initialKey"
      ],
      "capabilityDelegation": [
        "#initialKey"
      ],
      "capabilityInvocation": [
        "#initialKey"
      ],
      "authentication": [
        "#initialKey"
      ],
      "id": "did:btcr2:_",
      "@context": [
        "https://www.w3.org/ns/did/v1.1",
        "https://btcr2.dev/context/v1"
      ],
      "service": [
        {
          "type": "SingletonBeacon",
          "id": "#initialP2PKH",
          "serviceEndpoint": "bitcoin:my9vSV2TjCLhKGLLpXzYAfHexP5x51Kjdd"
        },
        {
          "type": "SingletonBeacon",
          "id": "#initialP2WPKH",
          "serviceEndpoint": "bitcoin:tb1qc9mlkyy6gtye4fxsrqts2m2erg0mpg0yxvc00j"
        },
        {
          "type": "SingletonBeacon",
          "id": "#initialP2TR",
          "serviceEndpoint": "bitcoin:tb1ps3g7sys25a443cx76cs4t6ekedzazt33f6qt25m965xskg3cwezqzyhu80"
        },
        {
          "type": "CASBeacon",
          "id": "#cohort-mutinynet-cas-2",
          "serviceEndpoint": "bitcoin:tb1pd79gln669alnp86d3tcffqa77effk83v0exja368sa02fyxglxcqhwcj9l"
        }
      ]
    },
    "updates": [
      {
        "@context": [
          "https://btcr2.dev/context/v1",
          "https://w3id.org/json-ld-patch/v1",
          "https://w3id.org/zcap/v1",
          "https://w3id.org/security/data-integrity/v2"
        ],
        "patch": [
          {
            "op": "add",
            "path": "/service/4",
            "value": {
              "id": "#didcomm",
              "type": "DIDCommMessaging",
              "serviceEndpoint": "http://example.com/didcomm"
            }
          }
        ],
        "sourceHash": "5a5xJPNsPT7KEWu5mWEw8dAISSCdMFOwylrbIfTUL94",
        "targetHash": "QtUyma1MgFeHMRerJDejRQ2PrzK2IFYYAwGNC8sDvlE",
        "targetVersionId": 2,
        "proof": {
          "type": "DataIntegrityProof",
          "cryptosuite": "bip340-jcs-2025",
          "verificationMethod": "did:btcr2:x1qkvj2tupjlsntl5c6he47h2gjhwr6c5ndvp3u92s4a6hs7qec5s97run2aw#initialKey",
          "proofPurpose": "capabilityInvocation",
          "capability": "urn:zcap:root:did%3Abtcr2%3Ax1qkvj2tupjlsntl5c6he47h2gjhwr6c5ndvp3u92s4a6hs7qec5s97run2aw",
          "capabilityAction": "Write",
          "proofValue": "z21oPYfxPK92FDFjLimot8AVPrrACVWcVPYABFhVWxmxxg6nUNmqresnqVdBQHjL9dVLt9eQL6XYdh9net9rVbP3N"
        }
      }
    ],
    "casUpdates": [
      {
        "did:btcr2:x1qkvj2tupjlsntl5c6he47h2gjhwr6c5ndvp3u92s4a6hs7qec5s97run2aw": "vfRTPYVzLD8CRnadTEMXkkagbrxIrmHZT3DKAvFruFA",
        "did:btcr2:x1qhn7xvy3lhau0jy3e9n5klayh2vcyv07txu553eckw6gezn8vfrayduehz8": "RvFuBbfT57Y3xy4GbtWpSfJMfQ03IBs2Ksjdcxy1a0g"
      }
    ]
  }
}
```

</details>

<details><summary>Captured output (stdout + stderr)</summary>

```
{
  "didResolutionMetadata": {},
  "didDocument": {
    "id": "did:btcr2:x1qkvj2tupjlsntl5c6he47h2gjhwr6c5ndvp3u92s4a6hs7qec5s97run2aw",
    "@context": [
      "https://www.w3.org/ns/did/v1.1",
      "https://btcr2.dev/context/v1"
    ],
    "verificationMethod": [
      {
        "type": "Multikey",
        "id": "#initialKey",
        "publicKeyMultibase": "zQ3shsMVg4SAQNb561q2wLhuhQe3yv1WZXWx7zsm1k56iUsSB",
        "controller": "did:btcr2:x1qkvj2tupjlsntl5c6he47h2gjhwr6c5ndvp3u92s4a6hs7qec5s97run2aw"
      }
    ],
    "authentication": [
      "#initialKey"
    ],
    "assertionMethod": [
      "#initialKey"
    ],
    "capabilityInvocation": [
      "#initialKey"
    ],
    "capabilityDelegation": [
      "#initialKey"
    ],
    "service": [
      {
        "type": "SingletonBeacon",
        "id": "#initialP2PKH",
        "serviceEndpoint": "bitcoin:my9vSV2TjCLhKGLLpXzYAfHexP5x51Kjdd"
      },
      {
        "type": "SingletonBeacon",
        "id": "#initialP2WPKH",
        "serviceEndpoint": "bitcoin:tb1qc9mlkyy6gtye4fxsrqts2m2erg0mpg0yxvc00j"
      },
      {
        "type": "SingletonBeacon",
        "id": "#initialP2TR",
        "serviceEndpoint": "bitcoin:tb1ps3g7sys25a443cx76cs4t6ekedzazt33f6qt25m965xskg3cwezqzyhu80"
      },
      {
        "type": "CASBeacon",
        "id": "#cohort-mutinynet-cas-2",
        "serviceEndpoint": "bitcoin:tb1pd79gln669alnp86d3tcffqa77effk83v0exja368sa02fyxglxcqhwcj9l"
      }
    ]
  },
  "didDocumentMetadata": {
    "versionId": "1",
    "deactivated": false
  }
}
```

</details>

---

## Vector 11a - XFAIL

- **DID:** `did:btcr2:x1q4cytk3ae3y74w2q0k2ukf5hqdjvn7c33ajdu5dwmvk76h3k4sqrqmvw4hp`
- **Description:** Genesis document-based (CAS), Mutinynet, 1 Update (CAS), SMT Proof (Sidecar)
- **Method:** POST
- **Notes:** Same block/tx/SMT as 11b
- **Fault attribution:** their-impl
- **Known fail reason:** 33-byte SMT nonce (leading 0x00); spec requires 256-bit = 32 bytes
- **Duration:** 812ms
- **Exit code:** 1

**Command:**

```bash
btcr2 resolve -i did:btcr2:x1q4cytk3ae3y74w2q0k2ukf5hqdjvn7c33ajdu5dwmvk76h3k4sqrqmvw4hp -p /tmp/btcr2-danubetech-hij5q7/vector-11a.json
```

<details><summary>Sidecar (resolutionOptions sent via -p)</summary>

```json
{
  "sidecar": {
    "smtProofs": [
      {
        "id": "q1H_iaYG0Oq6gbrycYL-r7FjUsJLnIpHDn49TLeONNA",
        "nonce": "APfY53QgVh6WX5jm15SL0Rh2jzIKEClyBE3Q-B_l6q8h",
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
    ... 4 lines matching cause stack trace ...
    at async file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/bin/btcr2.js:4:1 {
  [cause]: RangeError: Invalid base64url hash: expected 32 decoded bytes, got 33
      at base64UrlToHash (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/smt/dist/esm/hash.js:171:15)
      at SMTBeacon.processSignals (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/beacon/smt-beacon.js:67:55)
      at Resolver.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/resolver.js:410:47)
      at DidMethodApi.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/method.js:170:34)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
      at async DidBtcr2Api.resolveDid (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/api.js:121:16)
      at async Command.<anonymous> (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/commands/resolve.js:18:22)
      at async Command.parseAsync (/home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/command.js:1104:5)
      at async DidBtcr2Cli.run (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/cli.js:49:13)
      at async file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/bin/btcr2.js:4:1
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
- **Duration:** 863ms
- **Exit code:** 1

**Command:**

```bash
btcr2 resolve -i did:btcr2:x1q4plmrumnc5638xr74w59zg6yavk5laevq8r0jzm0xr7v2v0au655gn9xr0 -p /tmp/btcr2-danubetech-hij5q7/vector-11b.json
```

<details><summary>Sidecar (resolutionOptions sent via -p)</summary>

```json
{
  "sidecar": {
    "smtProofs": [
      {
        "id": "q1H_iaYG0Oq6gbrycYL-r7FjUsJLnIpHDn49TLeONNA",
        "nonce": "AKiwPzZ5-HVp5MjJRABFqKGUmv2uvfIv3p4QVYxoCdU7",
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
    ... 4 lines matching cause stack trace ...
    at async file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/bin/btcr2.js:4:1 {
  [cause]: RangeError: Invalid base64url hash: expected 32 decoded bytes, got 33
      at base64UrlToHash (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/smt/dist/esm/hash.js:171:15)
      at SMTBeacon.processSignals (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/beacon/smt-beacon.js:67:55)
      at Resolver.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/resolver.js:410:47)
      at DidMethodApi.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/method.js:170:34)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
      at async DidBtcr2Api.resolveDid (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/api.js:121:16)
      at async Command.<anonymous> (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/commands/resolve.js:18:22)
      at async Command.parseAsync (/home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/command.js:1104:5)
      at async DidBtcr2Cli.run (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/cli.js:49:13)
      at async file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/bin/btcr2.js:4:1
}
```

</details>

---

## Vector 12a - XFAIL

- **DID:** `did:btcr2:x1q5h2tzafcundemvxuaxl9y0z922cwv8suev6c3un9xyvc3yuyxmjz3yadsd`
- **Description:** Genesis document-based (Sidecar), Mutinynet, 1 Update (Sidecar), SMT Proof (Sidecar)
- **Method:** POST
- **Notes:** Same block/tx/SMT as 12b
- **Fault attribution:** their-impl
- **Known fail reason:** 33-byte SMT nonce (leading 0x00); spec requires 256-bit = 32 bytes
- **Duration:** 778ms
- **Exit code:** 1

**Command:**

```bash
btcr2 resolve -i did:btcr2:x1q5h2tzafcundemvxuaxl9y0z922cwv8suev6c3un9xyvc3yuyxmjz3yadsd -p /tmp/btcr2-danubetech-hij5q7/vector-12a.json
```

<details><summary>Sidecar (resolutionOptions sent via -p)</summary>

```json
{
  "sidecar": {
    "genesisDocument": {
      "verificationMethod": [
        {
          "type": "Multikey",
          "id": "#initialKey",
          "publicKeyMultibase": "zQ3shQFEqFSmDc3tKXLMAVy1R5F3MoAtDbm3jpRGECTbvWnXu",
          "controller": "did:btcr2:_"
        }
      ],
      "assertionMethod": [
        "#initialKey"
      ],
      "capabilityDelegation": [
        "#initialKey"
      ],
      "capabilityInvocation": [
        "#initialKey"
      ],
      "authentication": [
        "#initialKey"
      ],
      "id": "did:btcr2:_",
      "@context": [
        "https://www.w3.org/ns/did/v1.1",
        "https://btcr2.dev/context/v1"
      ],
      "service": [
        {
          "type": "SingletonBeacon",
          "id": "#initialP2PKH",
          "serviceEndpoint": "bitcoin:mrYGmQRadJ7Qr1Co28hkiFBmnf8Wn6ASmy"
        },
        {
          "type": "SingletonBeacon",
          "id": "#initialP2WPKH",
          "serviceEndpoint": "bitcoin:tb1q0r5nspa4w2xal8mmst87w59n5t4428nluq455f"
        },
        {
          "type": "SingletonBeacon",
          "id": "#initialP2TR",
          "serviceEndpoint": "bitcoin:tb1pcna2pnxeq3m9a7dwsxyl0845qg76cdkyzur0w6678asknwmkqymq47eraq"
        },
        {
          "type": "SMTBeacon",
          "id": "#cohort-mutinynet-smt-2",
          "serviceEndpoint": "bitcoin:tb1pxhrv6jlmxjrh8hu80qfegkdwtsxg8n5ej3kzmag9zq0clz4nvqgqc8l7e7"
        }
      ]
    },
    "updates": [
      {
        "@context": [
          "https://btcr2.dev/context/v1",
          "https://w3id.org/json-ld-patch/v1",
          "https://w3id.org/zcap/v1",
          "https://w3id.org/security/data-integrity/v2"
        ],
        "patch": [
          {
            "op": "add",
            "path": "/service/4",
            "value": {
              "id": "#didcomm",
              "type": "DIDCommMessaging",
              "serviceEndpoint": "http://example.com/didcomm"
            }
          }
        ],
        "sourceHash": "oPS5ZrqJt0dLLK73-_jlWZFeE_vPFpUEip-loHcoIOc",
        "targetHash": "SGqaVFjpiKvkgFfPF2Xvtu0KupByjRYV3jtViAGhJ9o",
        "targetVersionId": 2,
        "proof": {
          "type": "DataIntegrityProof",
          "cryptosuite": "bip340-jcs-2025",
          "verificationMethod": "did:btcr2:x1q5h2tzafcundemvxuaxl9y0z922cwv8suev6c3un9xyvc3yuyxmjz3yadsd#initialKey",
          "proofPurpose": "capabilityInvocation",
          "capability": "urn:zcap:root:did%3Abtcr2%3Ax1q5h2tzafcundemvxuaxl9y0z922cwv8suev6c3un9xyvc3yuyxmjz3yadsd",
          "capabilityAction": "Write",
          "proofValue": "z4435aBTPk8tytyWSugtsTJnKowW1uvx1UGf3g53QKaRoJ78bAcvA3jkeLqkN9NWmh1rqmrZbWyZhxv4Nhzi55WGX"
        }
      }
    ],
    "smtProofs": [
      {
        "id": "Zeuswi8sMNygdfuKjh9YGaUQOK4zPcirIJRwzIA7ZGU",
        "nonce": "AODC1L3cjDCo8zqlORdM8jDSG0ddu_XnblSLA7KHf00K",
        "updateId": "QbPkfJIHH21IeMRyGiNg5NfKYt0TmCljg91evyo-MpU",
        "collapsed": "f_________________________________________8",
        "hashes": [
          "SAGvc3PNM_JeqGZ8QG2aJdExqHdvUnYL8UkIPm18a9I"
        ]
      }
    ]
  }
}
```

</details>

<details><summary>Captured output (stdout + stderr)</summary>

```
Error: Failed to resolve DID: did:btcr2:x1q5h2tzafcundemvxuaxl9y0z922cwv8suev6c3un9xyvc3yuyxmjz3yadsd
    at DidMethodApi.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/method.js:181:19)
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    ... 4 lines matching cause stack trace ...
    at async file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/bin/btcr2.js:4:1 {
  [cause]: RangeError: Invalid base64url hash: expected 32 decoded bytes, got 33
      at base64UrlToHash (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/smt/dist/esm/hash.js:171:15)
      at SMTBeacon.processSignals (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/beacon/smt-beacon.js:67:55)
      at Resolver.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/resolver.js:410:47)
      at DidMethodApi.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/method.js:170:34)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
      at async DidBtcr2Api.resolveDid (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/api.js:121:16)
      at async Command.<anonymous> (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/commands/resolve.js:18:22)
      at async Command.parseAsync (/home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/command.js:1104:5)
      at async DidBtcr2Cli.run (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/cli.js:49:13)
      at async file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/bin/btcr2.js:4:1
}
```

</details>

---

## Vector 12b - FAIL

- **DID:** `did:btcr2:x1qhqkzp82h5266cyup4mthjfyrv27yasr7kn7l47escnplmw3vamyww8jqy8`
- **Description:** Genesis document-based (Sidecar), Mutinynet, 1 Update (Sidecar), SMT Proof (Sidecar)
- **Method:** POST
- **Notes:** Same block/tx/SMT as 12a
- **Fault attribution:** unknown
- **Duration:** 676ms
- **Exit code:** 1

**Command:**

```bash
btcr2 resolve -i did:btcr2:x1qhqkzp82h5266cyup4mthjfyrv27yasr7kn7l47escnplmw3vamyww8jqy8 -p /tmp/btcr2-danubetech-hij5q7/vector-12b.json
```

<details><summary>Sidecar (resolutionOptions sent via -p)</summary>

```json
{
  "sidecar": {
    "genesisDocument": {
      "verificationMethod": [
        {
          "type": "Multikey",
          "id": "#initialKey",
          "publicKeyMultibase": "zQ3shnYBYKjtZABxhS9uqjB6bwA1cVFvWa2s14PHVDzs9xMvb",
          "controller": "did:btcr2:_"
        }
      ],
      "assertionMethod": [
        "#initialKey"
      ],
      "capabilityDelegation": [
        "#initialKey"
      ],
      "capabilityInvocation": [
        "#initialKey"
      ],
      "authentication": [
        "#initialKey"
      ],
      "id": "did:btcr2:_",
      "@context": [
        "https://www.w3.org/ns/did/v1.1",
        "https://btcr2.dev/context/v1"
      ],
      "service": [
        {
          "type": "SingletonBeacon",
          "id": "#initialP2PKH",
          "serviceEndpoint": "bitcoin:ms6T4tUcLRRvqpNF99s5NwEYyrdL33nEVf"
        },
        {
          "type": "SingletonBeacon",
          "id": "#initialP2WPKH",
          "serviceEndpoint": "bitcoin:tb1q0mljpl95qe7u8geje777ta3kze6uesjeyrpsh2"
        },
        {
          "type": "SingletonBeacon",
          "id": "#initialP2TR",
          "serviceEndpoint": "bitcoin:tb1p326w76c7v6hzzkq6dkl8u8vk67d7wry4vu92cgzcpwznu0hlefxqvmgt0v"
        },
        {
          "type": "SMTBeacon",
          "id": "#cohort-mutinynet-smt-2",
          "serviceEndpoint": "bitcoin:tb1pxhrv6jlmxjrh8hu80qfegkdwtsxg8n5ej3kzmag9zq0clz4nvqgqc8l7e7"
        }
      ]
    },
    "updates": [
      {
        "@context": [
          "https://btcr2.dev/context/v1",
          "https://w3id.org/json-ld-patch/v1",
          "https://w3id.org/zcap/v1",
          "https://w3id.org/security/data-integrity/v2"
        ],
        "patch": [
          {
            "op": "add",
            "path": "/service/4",
            "value": {
              "id": "#dwn",
              "type": "DecentralizedWebNode",
              "serviceEndpoint": "http://example.com/dwn"
            }
          }
        ],
        "sourceHash": "Ilmr4EGhB-eM0K2OHTrOwlkqAECfpnvxLCltMYIiNic",
        "targetHash": "2RyLIfzaJ3YQ9KX3OGUdCTTInWDfUj2ooqXWbFIuqaI",
        "targetVersionId": 2,
        "proof": {
          "type": "DataIntegrityProof",
          "cryptosuite": "bip340-jcs-2025",
          "verificationMethod": "did:btcr2:x1qhqkzp82h5266cyup4mthjfyrv27yasr7kn7l47escnplmw3vamyww8jqy8#initialKey",
          "proofPurpose": "capabilityInvocation",
          "capability": "urn:zcap:root:did%3Abtcr2%3Ax1qhqkzp82h5266cyup4mthjfyrv27yasr7kn7l47escnplmw3vamyww8jqy8",
          "capabilityAction": "Write",
          "proofValue": "z4cy7TZFu9cKR9mDHmHVMwNm4Xc8wVzmwRop8XZBswjquHRJtwuiTBHphvQwxkf1uZk9mbEUyArrJ8Bo1SS2qqwum"
        }
      }
    ],
    "smtProofs": [
      {
        "id": "Zeuswi8sMNygdfuKjh9YGaUQOK4zPcirIJRwzIA7ZGU",
        "nonce": "HZ6T_0Hrj463dlEhMPSJRzaZnFhOnNe0L-NFCeEidPk",
        "updateId": "SAGvc3PNM_JeqGZ8QG2aJdExqHdvUnYL8UkIPm18a9I",
        "collapsed": "f_________________________________________8",
        "hashes": [
          "QbPkfJIHH21IeMRyGiNg5NfKYt0TmCljg91evyo-MpU"
        ]
      }
    ]
  }
}
```

</details>

<details><summary>Captured output (stdout + stderr)</summary>

```
Error: Failed to resolve DID: did:btcr2:x1qhqkzp82h5266cyup4mthjfyrv27yasr7kn7l47escnplmw3vamyww8jqy8
    at DidMethodApi.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/method.js:181:19)
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    ... 3 lines matching cause stack trace ...
    at async DidBtcr2Cli.run (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/cli.js:49:13)
    at async file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/bin/btcr2.js:4:1 {
  [cause]: INVALID_SMT_PROOF: SMT proof verification failed.
      at new MethodError (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/common/dist/esm/errors.js:100:9)
      at new SMTBeaconError (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/beacon/error.js:24:9)
      at SMTBeacon.processSignals (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/beacon/smt-beacon.js:70:23)
      at Resolver.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/method/dist/esm/core/resolver.js:410:47)
      at DidMethodApi.resolve (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/method.js:170:34)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
      at async DidBtcr2Api.resolveDid (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/api/dist/esm/api.js:121:16)
      at async Command.<anonymous> (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/commands/resolve.js:18:22)
      at async Command.parseAsync (/home/jintek/projects/github/@dcdpr/did-btcr2-js/node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/command.js:1104:5)
      at async DidBtcr2Cli.run (file:///home/jintek/projects/github/@dcdpr/did-btcr2-js/packages/cli/dist/esm/src/cli.js:49:13) {
    type: 'INVALID_SMT_PROOF',
    data: { smtProof: [Object], did: '' }
  }
}
```

</details>

