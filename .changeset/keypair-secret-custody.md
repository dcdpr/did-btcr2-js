---
'@did-btcr2/keypair': minor
---

Tighten secret-key custody and pin the ECDSA signing contract.

BREAKING:

- `Secp256k1SecretKey.decode()` returns the 32-byte secret key with the multicodec prefix validated and stripped; it previously returned the 34-byte prefix-plus-key value.
- The `ecdsa` signing scheme is pinned to DER-encoded, low-S signatures over a caller-supplied 32-byte sighash (`prehash: false`), on both `Secp256k1SecretKey.sign`/`CompressedSecp256k1PublicKey.verify` and `signWithScheme`. Callers passing arbitrary-length messages must pre-hash.

Added:

- `SchnorrKeyPair.secretKeyBytes`: a copy of the raw 32-byte secret without constructing the `Secp256k1SecretKey` wrapper (whose eager multibase encoding cannot be wiped). The caller owns the returned copy and should `wipe` it when done.

Fixed:

- `SchnorrKeyPair.secretKey` returns a fresh copy per read, so a caller can no longer `destroy()` or otherwise affect the keypair's stored secret through the getter.
- Transient secret material (per-sign key copies, BIP341 tweaked keys) is wiped on all exit paths.
