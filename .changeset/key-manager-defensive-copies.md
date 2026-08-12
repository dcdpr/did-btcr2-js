---
'@did-btcr2/key-manager': patch
---

Defensive copies on the key store boundary.

Fixed:

- Caller-supplied tags are cloned on key import and generation, and `getPublicKey`/`getEntry` return copies of the stored bytes and tags, so store state can no longer be mutated through returned references.
- Secret material is read at the bytes level when storing a key, avoiding the `Secp256k1SecretKey` wrapper's eager (unwipeable) multibase encoding per read.
