# @did-btcr2/cryptosuite

## 10.0.0

### Major Changes

- Correct the inverted domain check and stop serializing secret keys out of a multikey.

  - **BREAKING:** `SchnorrMultikey.toJSON()` serializes public material only. `keyPair` is now `SchnorrKeyPair.toJSON()` (public key alone) rather than the secret-bearing `exportJSON()` shape, and `MultikeyObject.keyPair` narrows to match. `toJSON` is called implicitly by `JSON.stringify`, so anything that logged, posted, or stringified a multikey (or an object holding one) emitted the raw secret key. Serialize secret material deliberately with `multikey.keyPair.exportJSON()`.
  - **BREAKING:** `toJSON()` reports `signer: false` for a public-key-only keypair instead of letting the `secretKey` getter's throw escape out of serialization. `JSON.stringify` of a watch-only multikey previously crashed.
  - **BREAKING:** the `verifyProof` domain check was inverted: a proof whose domain list contained every expected domain was rejected, and one whose contents differed was accepted whenever the lengths matched, which allowed cross-domain replay of a Data Integrity proof. Both sides are normalized to lists and compared for set equality, per W3C Data Integrity. Callers that passed `expectedDomain` will see results flip.
  - **BREAKING:** thrown `PROOF_*` errors carry `data.suite` (`{ type, cryptosuite, verificationMethod }`) in place of `data.this`, which was the live cryptosuite instance and reached the multikey's secret key through any error logger or telemetry sink. These throws fire on routine failures such as a type or verificationMethod mismatch, so they are exactly the payloads most likely to be serialized.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@9.3.0
