---
'@did-btcr2/common': major
---

The common package removes `JSONUtils.deleteKeys` and 11 error types that no code uses (ADR 151).

- common: Breaking: `JSONUtils.deleteKeys` is removed. No package calls it. To remove a top-level key, use an object rest destructure, for example `const { proof: _, ...unsignedUpdate } = update;`.
- common: Breaking: `MethodErrorCode` no longer has the members `INVALID_DID_DOCUMENT_LENGTH`, `INVALID_PREVIOUS_DID_PROOF`, `INVALID_PUBLIC_KEY`, `INVALID_PUBLIC_KEY_MULTIBASE`, `INVALID_PUBLIC_KEY_LENGTH`, `INVALID_PUBLIC_KEY_TYPE`, `INVALID_SIGNATURE`, `UNSUPPORTED_PUBLIC_KEY_TYPE`, `INVALID_SIDECAR_DATA`, `INVALID_UPDATE`, and `MISSING_RESOLUTION_OPTIONS`. The named exports of 8 of them are also removed: all except `INVALID_DID_DOCUMENT_LENGTH`, `UNSUPPORTED_PUBLIC_KEY_TYPE`, and `INVALID_UPDATE`, which had no named export. No code raises these error types, and no cited specification defines them.
