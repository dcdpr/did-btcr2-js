---
'@did-btcr2/common': major
'@did-btcr2/method': minor
'@did-btcr2/api': minor
'@did-btcr2/aggregation': patch
'@did-btcr2/cli': patch
---

JSONPatch applies the rules of RFC 6901 and RFC 6902 with its own engine and accepts each member name (ADR 155).

- common: Breaking: `JSONPatch.apply` refuses a patch that breaks RFC 6901 or RFC 6902 with a `MethodError` of type `JSON_PATCH_APPLY_ERROR`. Examples: a pointer with `~2`, an array index with a leading zero (`/a/00`), and an empty array token (`/a/`). Other examples: an index past the end for the `add` of a `move` or a `copy`, and a `move` into a child of its `from`. A path to an inherited JavaScript member such as `/o/toString` and a `remove` at `''` also fail. Before, the apply accepted each of these patches, and a `remove` at `''` gave `null`.
- common: Breaking: `JSONPatch.apply` accepts each member name, also `constructor`, `prototype`, and `__proto__`. It writes such a member as an own data member and changes no prototype. A `test` with a value that has a member `hasOwnProperty` compares by RFC 6902 section 4.6. An `add` with a `from` member applies, because RFC 6902 ignores that member. Before, the apply refused each of these patches.
- common: Breaking: `JSONPatchApplyOptions` and the options parameter of `JSONPatch.apply` are removed. The rules always apply, and the patch always runs on a JSON copy. The `strict` parameter of `JSONPatch.validateOperations` is removed, and its `operations` parameter has the type `unknown`. `JSONPatch.diff`, `JSONPatch.joinPointer`, and `JSONPatch.escapeSegmentPath` are removed.
- common: operations or a source document with no JSON form, for example with a cycle or a BigInt, give `JSON_PATCH_APPLY_ERROR`. Before, they gave a `TypeError`. The error data holds `index`, `op`, `path`, and `from` for a `move` or a `copy`.
- common: the package no longer depends on `fast-json-patch`.
- method: Breaking: `Updater.construct`, `DidBtcr2.update`, and the resolver apply the patch of an update with the new rules. A patch that the new rules refuse gives `INVALID_DID_UPDATE` on both paths. A patch that names a member `constructor`, `prototype`, or `__proto__` now applies.
- api: Breaking: `applyPatch`, `constructUpdate`, `signUpdate`, the update functions, and the resolve functions apply the new rules through method. `applyPatch` refuses a `remove` at `''`.
- aggregation: the browser bundle no longer holds `fast-json-patch`.
- cli: `update` and `deactivate` apply the new rules through the api. The docs of `update` name the new refusals.
