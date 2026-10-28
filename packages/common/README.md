# @did-btcr2/common

Common utilities, types, and errors shared across the `did-btcr2-js` monorepo.

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

This package is the foundational layer that every other `@did-btcr2/*` package depends on. It has no workspace dependencies of its own. Its responsibilities:

- **Canonicalization + hashing.** JCS (JSON Canonicalization Scheme, RFC 8785) plus SHA-256, with three encodings: hex, base58, and base64urlnopad (default). Used everywhere document hashes are produced or compared. `canonicalize` sorts the members of each object, also of an object with a data member named `toJSON`. It refuses a value with no JCS form with a `CanonicalizationError`. The types are `NON_FINITE_NUMBER` (NaN, Infinity, or -Infinity), `LONE_SURROGATE` (a string or a member name), and `NOT_JSON_DATA` (a BigInt or a cycle). `data.path` gives the location of the value (ADR 154).
- **JSON Patch.** `JSONPatch.apply` applies a JSON Patch (RFC 6902) with the JSON Pointer rules of RFC 6901, and `PatchOperation` is the type of an operation. The DID update paths use it. Each member name is data, also `constructor` and `__proto__` (ADR 155).
- **Shared types.** Byte-aliases (`KeyBytes`, `HashBytes`, `SignatureBytes`, etc.), DID-related enums (`IdentifierTypes`, `IdentifierHrp`, `BitcoinNetworkNames`), and the `JSONObject` family used by canonical signing. `ProblemDetails` (RFC 9457) is the type of an error in a proof verification result.
- **Error hierarchy.** A single `DidMethodError` base with one subclass per failure domain (`MethodError`, `IdentifierError`, `UpdateError`, `ResolveError`, `KeyManagerError`, `KeyPairError`, `MultikeyError`, `CryptosuiteError`, etc.) Every typed error carries a `type` string tag and a structured `data` payload.
- **Small utilities.** Date, JSON, and string helpers used by multiple packages. `DateUtils.isValidXsdDateTime` and `DateUtils.isValidXsdDateTimeStamp` check a value with the `dateTime` rules of XML Schema 1.1. `DateUtils.xsdDateTimeToEpochMs` and `DateUtils.compareXsdDateTime` accept each year, also a year above 9999 (ADR 158).

## Install

```bash
npm install @did-btcr2/common
```

Or with pnpm:

```bash
pnpm add @did-btcr2/common
```

Ships both ESM and CommonJS. Requires Node >= 22.

## Key Exports

| Concern | Entry point |
|---|---|
| Canonicalize an object | `canonicalize(obj)` |
| Hash canonical bytes | `hash(string)`, `canonicalHashBytes(obj)` |
| Hash and encode in one call | `canonicalHash(obj, { encoding })` |
| Encode/decode hash bytes | `encode(bytes, encoding)`, `decode(string, encoding)` |
| Apply a JSON Patch | `JSONPatch.apply`, `PatchOperation` |
| Base error class | `DidMethodError` |
| Subclassed errors | `MethodError`, `IdentifierError`, `UpdateError`, `ResolveError`, `KeyPairError`, `KeyManagerError`, `MultikeyError`, ... |
| Byte type aliases | `Bytes`, `KeyBytes`, `HashBytes`, `SignatureBytes`, `DocumentBytes` |
| DID enums | `IdentifierTypes`, `IdentifierHrp`, `BitcoinNetworkNames` |
| Cryptosuite names | `CryptosuiteName` (`'bip340-jcs-2025'` or `'bip340-rdfc-2025'`) |

## Quick Start

```typescript
import { canonicalHash, JSONPatch, MethodError } from '@did-btcr2/common';

// Hash a DID document canonically (JCS + SHA-256, base64urlnopad).
const docHash = canonicalHash({ id: 'did:btcr2:k1q5p...', verificationMethod: [] });

// Apply a JSON Patch to a document. The result is a new document; the source document
// and the operations do not change. The apply uses the rules of RFC 6902 and RFC 6901:
// the first operation that fails, a failed test included, fails the whole patch. For
// example, an array index with a leading zero, a remove of a location that does not
// exist, and a move into a child of its own location fail (ADR 155).
const patched = JSONPatch.apply(
  { id: 'did:btcr2:k1q5p...', service: [] },
  [{ op: 'add', path: '/service/-', value: { id: '#dwn' } }],
);

// Throw a structured error with type tag + data payload.
throw new MethodError('beacon address mismatch', 'BEACON_VALIDATION', {
  address : 'tb1q...',
  kind    : 'P2WPKH',
});
```

## Architecture Principles

- **Zero workspace dependencies.** This package is the root of the dependency graph; everything else can depend on it without cycles.
- **Browser-compatible.** Pure TypeScript, no Node.js-only APIs. Runtime dependencies: `@noble/hashes` and `@scure/base`. `@scure/bip32` is an optional peer dependency for HD-key consumers.
- **Stable encoding contracts.** `base64urlnopad` is the default for hash encoding; protocol fields that carry raw bytes are hex-encoded, so downstream callers normalize to a common encoding before comparing.

## Build & Test

```bash
# From packages/common/
pnpm build              # Compile ESM + CJS + type declarations
pnpm build:tests        # Compile tests to tests/compiled/
pnpm test               # Run the test suite with coverage
pnpm lint               # ESLint (zero warnings tolerated)
```

## Documentation

- **Package docs on btcr2.dev** [btcr2.dev/impls/ts](https://btcr2.dev/impls/ts)
- **JCS specification** [RFC 8785](https://datatracker.ietf.org/doc/html/rfc8785)
- **JSON Patch specification** [RFC 6902](https://datatracker.ietf.org/doc/html/rfc6902)
- **JSON Pointer specification** [RFC 6901](https://datatracker.ietf.org/doc/html/rfc6901)
- **Source reference** See JSDoc on `canonicalize`, `canonicalHash`, `JSONPatch`, and the error classes in `errors.ts`.

## License

[MPL-2.0](https://github.com/dcdpr/did-btcr2-js/blob/main/LICENSE)
