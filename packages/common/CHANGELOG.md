# @did-btcr2/common

## 9.3.0

### Minor Changes

- Keep prototype machinery out of JSON Patch pointers and out of JSON walks.

  - `JSONPatch.validateOperations` rejects any `path` or `from` whose RFC 6901 segments, unescaped, include `__proto__`, `constructor`, or `prototype`, at any position. `fast-json-patch` bans `__proto__` and a trailing `constructor/prototype` pair, but it still traverses an intermediate `constructor` segment, at which point the cursor is the global `Object` or `Array` function and the operation writes a static member process-wide. Patches carried by untrusted DID updates reach this validator, so the segments are refused before any application.
  - **Semantic change:** a document key literally named `constructor`, `prototype`, or `__proto__` is no longer addressable by patch. No DID Core or btcr2 vocabulary defines such a property, and patching every other key of such a document still works.
  - `JSONUtils.clone`, `deleteKeys`, and `sanitize` define copied keys as own enumerable data properties instead of assigning them. A plain `result[key] = value` routes the key `__proto__` through the inherited `Object.prototype` setter, which discards the key and swaps the copy's prototype for the supplied value. `JSON.parse` produces `__proto__` as an own enumerable key, so a document carrying one previously lost it on every walk while the copy inherited attacker-supplied properties. Canonicalization and `canonicalHash` are byte-identical to before for every input without such a key.

## 9.2.0

### Minor Changes

- Typed errors for the utility surface (ADR 085): every error constructed in `src/` is now a `DidMethodError` subclass.

  - `DateUtils.toISOStringNonFractional` and `toUnixSeconds` throw `MethodError` with type `INVALID_DATE` (was bare `Error`).
  - The `JSONUtils.deepEqual`/`clone` guards throw `MethodError` with types `MAX_DEPTH_EXCEEDED` and `CIRCULAR_STRUCTURE` (was bare `Error`).
  - `JSONPatch.validateOperations` returns `MethodError` with type `JSON_PATCH_VALIDATION_ERROR` (was bare `Error`); its declared return type narrows from `Error | null` to `MethodError | null`.
  - `NotImplementedError` now extends `DidMethodError` and gains the standard `(message, type?, data?)` constructor. The legacy options-object second argument remains as a deprecated overload, slated for removal at the next major.

  Error messages are unchanged at every touched site; only the class, `name`, and `type` surfaces changed.
