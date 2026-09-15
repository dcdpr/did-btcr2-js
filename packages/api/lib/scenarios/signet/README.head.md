# did:btcr2 Signet Test Vectors

Live `did:btcr2` test vectors anchored on **signet** (about 10 minute blocks).

- **On-chain:** every update signal is an `OP_RETURN` on signet. Explorer: https://mempool.space/signet. Esplora REST API: `https://mempool.space/signet/api`.
- **CAS:** the genesis documents, signed updates, and CAS Announcement Maps that a vector delivers through the CAS are pinned on IPFS (CIDv1, raw codec, sha2-256) and retrievable from a public gateway.
- **Sidecar:** everything else, SMT proofs included, rides in the resolution options of `resolve/input.json`.
