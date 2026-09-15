# did:btcr2 Mutinynet Test Vectors

Live `did:btcr2` test vectors anchored on **Mutinynet** (a custom signet with 30 second blocks).

- **On-chain:** every update signal is an `OP_RETURN` on Mutinynet. Explorer: https://mutinynet.com. Esplora REST API: `https://mutinynet.com/api`.
- **CAS:** the genesis documents, signed updates, and CAS Announcement Maps that a vector delivers through the CAS are pinned on IPFS (CIDv1, raw codec, sha2-256) and retrievable from a public gateway.
- **Sidecar:** everything else, SMT proofs included, rides in the resolution options of `resolve/input.json`.
