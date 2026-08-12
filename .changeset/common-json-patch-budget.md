---
'@did-btcr2/common': minor
---

Bound JSON Patch validation for untrusted patches.

Added:

- `JSONPatch.validateOperations` now enforces an application budget on patches carried by untrusted DID updates: at most 1024 operations (`MAX_PATCH_OPERATIONS`), pointer paths (and `from` pointers) at most 2048 characters (`MAX_PATCH_PATH_LENGTH`), per-operation values at most 256 KiB serialized (`MAX_PATCH_VALUE_BYTES`), and a 1 MiB aggregate budget per patch (`MAX_PATCH_TOTAL_BYTES`). Oversized or unserializable patches are rejected with a `JSON_PATCH_VALIDATION_ERROR` instead of forcing unbounded patch work.
