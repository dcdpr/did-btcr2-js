---
'@did-btcr2/smt': minor
'@did-btcr2/api': minor
'@did-btcr2/method': patch
'@did-btcr2/aggregation': patch
'@did-btcr2/cli': patch
---

`BTCR2MerkleTree` refuses a nonce that is not 256 bits, and the SMT proof verifier accepts a nonce of any length (ADR 166).

- smt: Breaking: `BTCR2MerkleTree.addEntries` refuses a `nonce` that is not 32 bytes, also a longer `nonce`, with a `RangeError`. The message is `Invalid nonce: expected 32 bytes, got <n>`. An entry without a `nonce` does not change. `leafValue`, `verifyProof`, `verifySerializedProof`, `deserializeProof`, and `serializeProof` accept a `nonce` of any length, as before.
- api: Breaking: `SmtApi.build` refuses an entry `nonce` that decodes to a length other than 32 bytes, also `''`, with the same `RangeError`. The browser bundle holds the smt package.
- method: the JSDoc of `SMTProof` and `SMTProof.nonce`; dependency uptake. The browser bundle holds the smt package.
- aggregation: dependency uptake. The browser bundle holds the smt package.
- cli: dependency uptake.
