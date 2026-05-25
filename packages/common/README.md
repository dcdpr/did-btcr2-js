# @did-btcr2/common

Common utilities, types, and errors shared across the `did-btcr2-js` monorepo.

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

This package is the foundational layer that every other `@did-btcr2/*` package depends on. It has no workspace dependencies of its own. Its responsibilities:

- **Canonicalization + hashing.** JCS (JSON Canonicalization Scheme, RFC 8785) plus SHA-256, with three encodings: hex, base58, and base64urlnopad (default). Used everywhere document hashes are produced or compared.
- **JSON Patch helpers.** RFC 6902 operations and the typed `PatchOperation` interface used by the DID update path.
- **Shared types.** Byte-aliases (`KeyBytes`, `HashBytes`, `SignatureBytes`, etc.), DID-related enums (`IdentifierTypes`, `IdentifierHrp`, `BitcoinNetworkNames`), and the `JSONObject` family used by canonical signing.
- **Error hierarchy.** A single `DidMethodError` base with one subclass per failure domain (`MethodError`, `IdentifierError`, `UpdateError`, `ResolveError`, `KeyManagerError`, `KeyPairError`, `MultikeyError`, `CryptosuiteError`, etc.) Every typed error carries a `type` string tag and a structured `data` payload.
- **Small utilities.** Date, JSON, and string helpers used by multiple packages.

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
| Build JSON Patch ops | `JSONPatch`, `PatchOperation` |
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

// Apply a JSON Patch operation to a document (returns a new document, does not mutate).
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
- **Browser-compatible.** Pure TypeScript, no Node.js-only APIs. Runtime dependencies: `@noble/hashes`, `@scure/base`, `fast-json-patch`, and `json-canonicalize`. `@scure/bip32` is an optional peer dependency for HD-key consumers.
- **Stable encoding contracts.** `base64urlnopad` is the default for hash encoding; byte comparisons use `equalBytes()` to handle interop with hex-encoded protocol fields.

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
- **Source reference** See JSDoc on `canonicalize`, `canonicalHash`, `JSONPatch`, and the error classes in `errors.ts`.

## License

[MPL-2.0](https://github.com/dcdpr/did-btcr2-js/blob/main/LICENSE)
