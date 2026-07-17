# @did-btcr2/common

## 9.2.0

### Minor Changes

- Typed errors for the utility surface (ADR 085): every error constructed in `src/` is now a `DidMethodError` subclass.

  - `DateUtils.toISOStringNonFractional` and `toUnixSeconds` throw `MethodError` with type `INVALID_DATE` (was bare `Error`).
  - The `JSONUtils.deepEqual`/`clone` guards throw `MethodError` with types `MAX_DEPTH_EXCEEDED` and `CIRCULAR_STRUCTURE` (was bare `Error`).
  - `JSONPatch.validateOperations` returns `MethodError` with type `JSON_PATCH_VALIDATION_ERROR` (was bare `Error`); its declared return type narrows from `Error | null` to `MethodError | null`.
  - `NotImplementedError` now extends `DidMethodError` and gains the standard `(message, type?, data?)` constructor. The legacy options-object second argument remains as a deprecated overload, slated for removal at the next major.

  Error messages are unchanged at every touched site; only the class, `name`, and `type` surfaces changed.
