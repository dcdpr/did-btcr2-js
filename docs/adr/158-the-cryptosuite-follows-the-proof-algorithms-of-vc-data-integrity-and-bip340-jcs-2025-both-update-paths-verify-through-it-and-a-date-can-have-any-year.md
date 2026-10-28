# ADR 158: The Cryptosuite Follows the Proof Algorithms of VC Data Integrity and bip340-jcs-2025, Both Update Paths Verify Through It, and a Date Can Have Any Year

- **Status:** Accepted
- **Date:** 2026-10-27
- **Packages:** `@did-btcr2/common` (MAJOR: the error type `PROOF_PARSING_ERROR` is removed; the new error types `PARSING_ERROR` and `INVALID_CHALLENGE_ERROR`, the named export `INVALID_DOMAIN_ERROR`, and the type `ProblemDetails`; `DateUtils.isValidXsdDateTime` applies the XML Schema 1.1 grammar; the new functions `isValidXsdDateTimeStamp`, `xsdDateTimeToEpochMs`, and `compareXsdDateTime`); `@did-btcr2/cryptosuite` (MAJOR: `addProof` and `createProof` return new objects; `VerificationResult` has the items of VC Data Integrity, section 4.4, and `Cryptosuite.verifyProof` returns the new type `CryptosuiteVerificationResult`; `BIP340DataIntegrityProof.verifyProof` returns a failed result in place of a throw; create and verify refuse a proof that breaks a rule of VC Data Integrity; `SchnorrMultikey.fromVerificationMethod` and the `proofValue` decoder refuse other text for the same bytes); `@did-btcr2/method` (MINOR: the resolver refuses an update proof with a member that breaks a rule, a `previousProof`, or other `proofValue` text; the resolver reads each year of `created`, `expires`, and `versionTime`, and refuses a block time outside the range of a block header; `Updater.sign` refuses a signature that is not 64 bytes before the verification; the browser bundle holds the common and cryptosuite packages); `@did-btcr2/api` (MINOR: `crypto.cryptosuite.verifyProof` and `crypto.verifyDocument` return `CryptosuiteVerificationResult`; `crypto.proof.verifyProof` returns the result of section 4.4; `crypto.cryptosuite.createFromKms` signs through the KMS signer; the new type exports `ProblemDetails` and `CryptosuiteVerificationResult`; `btcr2.verifyMessage` refuses other key text; the browser bundle holds method, cryptosuite, and common); `@did-btcr2/aggregation` (PATCH: dependency uptake; the browser bundle holds the common package); `@did-btcr2/cli` (PATCH: `message sign` and `message verify` go through the new cryptosuite, and `message verify` and `resolve` refuse the inputs that the api refuses; dependency uptake through api and key-manager); `@did-btcr2/keypair`, `@did-btcr2/bitcoin`, and `@did-btcr2/key-manager` (PATCH: dependency uptake)

## Context

### The proof functions changed their input

VC Data Integrity 1.0, section 4.2 "Add Proof", step 5 says: "Let securedDataDocument be a copy of inputDocument." Step 1 of "Create Proof (bip340-jcs-2025)" makes the proof a clone of the proof options. `BIP340DataIntegrityProof.addProof` wrote `proof` into the document of the caller and returned that object. `BIP340Cryptosuite.createProof` wrote `@context`, `type`, `cryptosuite`, and `proofValue` into the options and returned the options object. Thus `Updater.sign` gave `addProof` a copy of the update (ADR 147), and `signMessage` of the api made new objects.

### Verify Proof threw, and its result had other items

Section 4.4 says: "When a step says "an error MUST be raised", it means that a verification result MUST be returned with a verified value of false and a non-empty errors list." The result has the items `verified`, `verifiedDocument`, `mediaType`, `warnings`, and `errors`. `BIP340DataIntegrityProof.verifyProof` threw a `DataIntegrityProofError` for each failed check. A document that is not a map gave a raw `TypeError`, and text that is not JSON gave a raw `SyntaxError`. A domain mismatch had the type `PROOF_VERIFICATION_ERROR`, not `INVALID_DOMAIN_ERROR`. The result had no `warnings` and no `errors`, and `verifiedDocument` was the secured document with its proof.

### The algorithms skipped checks

The table gives the results of `BIP340Cryptosuite.verifyProof` and, in the last row, of the resolver.

| Input | Before | After |
|---|---|---|
| A proof with `id: 'not a url'`, `nonce: 7`, or `domain: 5` | Verifies | `CryptosuiteError` of type `PROOF_VERIFICATION_ERROR` |
| A proof with `created: ''` | Verifies | `CryptosuiteError` of type `PROOF_GENERATION_ERROR` |
| A proof with `created: 5` | Raw `TypeError` | `CryptosuiteError` of type `PROOF_GENERATION_ERROR` |
| A document with `@context: ['x:a', 'x:c']` and a proof with `@context: ['x:a']` | `verified: false` | `verified: true` |
| A document with no `@context` and a proof with `@context: ['x:b']` | `verified: true` | `verified: false` |
| An update that the controller signs, with `previousProof: 'urn:uuid:none'` | The resolver applies it | `INVALID_DID_UPDATE` |

Proof Configuration skipped a `created` value of `''`, `0`, `null`, or `false`. Verify Proof had no step 4, the `@context` check. The cryptosuite did not check the other proof members of section 2.1, for example `id`, `domain`, `challenge`, and `nonce`. Section 2.1 says about `previousProof`: "Each value identifies another data integrity proof, all of which MUST also verify for the current proof to be considered verified." An update has one proof, so no did:btcr2 path can verify a named proof.

### The decoder accepted other text for one value

The base58btc decoder of `multiformats` ignores a code unit above U+00FF after the `z` header (ADR 147). Thus `z`, then U+0100, then the rest of a `proofValue` decoded to the same 64 bytes, and the proof verified. ADR 147 refused such key text only in `signingMethodProblem` of the method package, so `api.btcr2.verifyMessage` accepted it. A `proofValue` of 63 or 65 bytes gave a raw `Error`.

### `createFromKms` gave a suite that cannot sign

`api.crypto.cryptosuite.createFromKms(id, controller, keyId, kms)` made a multikey from the public key only. Its `createProof` then threw a `KeyPairError` of type `SECRET_KEY_ERROR`.

### The update paths verified through the JSON text layer

The resolver and `Updater.sign` serialized the signed update with `canonicalize`. They gave the text to `BIP340DataIntegrityProof.verifyProof` with the purpose `capabilityInvocation`. The did:btcr2 "Check update.proof" step verifies `update` with a BIP340 Cryptosuite instance and the `"bip340-jcs-2025"` cryptosuite. It then says: "Raise [`INVALID_DID_UPDATE`] if verification fails."

### A date with a year above 9999 failed

`DateUtils.isValidXsdDateTime` refused the year `0000` and accepted `01000` and `24:00:00.5`. XML Schema 1.1 accepts the first value and refuses the other two. The leap-year rule read the year as a number, which loses digits above `Number.MAX_SAFE_INTEGER`. The resolver read `proof.created`, `proof.expires`, and `versionTime` with `Date.parse`, which gives `NaN` for a year above 9999. Thus `expires: '10000-01-01T00:00:00Z'` gave `INVALID_DID_UPDATE`, and `versionTime: '10000-01-01T00:00:00Z'` gave `INVALID_OPTIONS`. The proof time window compared milliseconds, so a digit after the third digit of a fraction had no effect.

### A block time had no range check

A Bitcoin block header stores its time as a 32-bit unsigned integer (`uint32_t nTime` in `CBlockHeader` of Bitcoin Core). The block `mediantime` is the median of such values. The resolver accepted each finite value. A `mediantime` of `1e20` gave a `MethodError` of type `INVALID_DATE`. A `mediantime` of `1.5` applied, with `updated` set to `1970-01-01T00:00:01Z`.

### The BIP340 Cryptosuites specification gives two encodings for `proofValue`

The "DataIntegrityProof" section of the BIP340 Cryptosuites says that the `proofValue` is "encoded using the base-64-url header and alphabet". Step 7 of "Create Proof (bip340-jcs-2025)" makes "a base58-btc-encoded Multibase value". Step 3 of "Verify Proof (bip340-jcs-2025)" reads "the Multibase decoded base58-btc value". The example of the "DataIntegrityProof" section has a `z` value. The did:btcr2 "Data Integrity Proof" data structure gives the `proofValue` "as a Multibase `"base-58-btc"`" string.

## Decision

### 1. Add Proof follows section 4.2 and returns a copy

`BIP340DataIntegrityProof.addProof(document, options)` does these steps in this order:

1. It refuses a document with a `proof` member, with a `DataIntegrityProofError` of type `PROOF_GENERATION_ERROR`. The message names section 4.3, "Add Proof Set/Chain".
2. It refuses options with a `previousProof`, with the same error type (decision 9).
3. It calls `createProof` (step 1). An error of the cryptosuite propagates.
4. It checks steps 2 to 4. A member is "not set" if it is `undefined`. A "non-null" `domain` or `challenge` is a value that is not `undefined` and not `null`. The `domain` comparison uses the JSON text of each value.
5. It returns `{ ...document, proof }` (steps 5 to 7).

Thus `addProof` does not change the document or the options. Section 4 permits the two refusals: "Implementers MAY implement reasonable defaults and safeguards in addition to the algorithms below, to help mitigate developer error". Section 4 also says: "An input document is an map that has not yet had the current proof added to it, but it MAY contain a proof value that was added to it by a previous process." Refusal 1 refuses such an input. Before, the new proof signed the old proof and replaced it, so the output never verified.

### 2. Create Proof follows bip340-jcs-2025 and returns a copy

`BIP340Cryptosuite.createProof(document, options)` does these steps in this order:

1. The document must be a map. Another value gives a `CryptosuiteError` of type `PROOF_GENERATION_ERROR`.
2. The proof is a copy of the options (step 1). Options with a `proofValue` give `PROOF_GENERATION_ERROR`. Verify Proof removes the `proofValue` before Proof Configuration, so such a proof never verifies.
3. Step 2: "If `unsecuredDocument`.@context is present, set `proof`.@context to `unsecuredDocument`.@context." Options with an `@context` for a document with no `@context` give `PROOF_GENERATION_ERROR`. Step 4 of Verify Proof fails for such a proof.
4. The rules of a proof creator apply (decision 3).
5. Steps 3 to 6 run. A signature that is not 64 bytes gives `PROOF_GENERATION_ERROR`. Proof Serialization, step 2, says: "`proofBytes` will be exactly 64 bytes in size."
6. The proof gets the base58btc text of the signature (steps 7 and 8).

### 3. The proof members follow section 2.1

The internal module `proof-checks.ts` holds the rules. The package index does not export it. The first member that breaks a rule gives the error, with the member name and the rule in the message.

| Member | Rule of a proof creator (`createProof`) | Rule of a proof verifier (`verifyProof`) |
|---|---|---|
| `type`, `cryptosuite`, `verificationMethod`, `proofPurpose` | Required, a string | Required, a string |
| `id` | A valid URL string (decision 4) | A valid URL string |
| `created` | An XML Schema `dateTimeStamp` | Proof Configuration checks it (decision 5) |
| `expires` | An XML Schema `dateTimeStamp` | An XML Schema `dateTime` |
| `domain` | A string, or an array of strings with no repeated string | A string or an array of strings |
| `challenge`, `nonce` | A string | A string |
| `previousProof` | A string or an array of strings | A string or an array of strings |

The required members `type`, `verificationMethod`, and `proofPurpose` follow section 4.2, step 2, and section 4.4, step 4. The required member `cryptosuite` follows section 2.1: "If the proof type is DataIntegrityProof, cryptosuite MUST be specified". A creator error has the type `PROOF_GENERATION_ERROR`, and a verifier error has the type `PROOF_VERIFICATION_ERROR`. For `expires`, section 2.1 says: "A conforming processor MAY chose to consume time values that were incorrectly serialized without an offset."

### 4. A proof `id` is a valid URL string of the URL Standard

Section 2.1 says that `id` is "An optional identifier for the proof, which MUST be a URL [URL]". [URL] is the URL Standard. It says: "A valid URL string must be either a relative-URL-with-fragment string or an absolute-URL-with-fragment string." The internal function `isValidUrlString` applies this grammar on create and on verify. The URL code points include "code points in the range U+00A0 to U+10FFFD, inclusive, excluding surrogates and noncharacters". A relative string is valid if it is valid for one kind of base URL: special, `file`, or other.

Thus `urn:uuid:6a1676b8-b51f-11ed-937b-d76685a20ff5`, `#key-0`, `#schlüssel`, `proof-1`, `https://example.com/café`, and the empty string are valid. `not a url`, `https://a"b/`, and the number `42` are not valid. For the host of a special scheme, the check uses the URL parser and not the IDNA rules of a valid domain string.

### 5. Verify Proof of the cryptosuite follows bip340-jcs-2025

`BIP340Cryptosuite.verifyProof(securedDocument)` does these steps in this order:

1. The document and its proof must be maps. Another value gives a `CryptosuiteError` of type `PARSING_ERROR`.
2. Steps 1 and 2 make copies with no `proof` and with no `proofValue`. The input does not change.
3. The rules of a proof verifier apply (decision 3).
4. Step 3: the `proofValue` must be the base58btc text of 64 bytes (decision 8). Another value gives `PROOF_VERIFICATION_ERROR`.
5. Step 4: if the proof has an `@context`, the document `@context` must start with its values in the same order. Else the result is `verified: false`. The unsecured document then gets the proof `@context`.
6. Steps 5 to 8 run. Proof Configuration refuses a `created` value that is set and is not an XML Schema `dateTime`, with `PROOF_GENERATION_ERROR`.
7. The result is `{ verified, verifiedDocument }`. `verifiedDocument` is the unsecured document if `verified` is true, else `null`.

The return type is the new `CryptosuiteVerificationResult`. Section 3 says that verifyProof "produces a cryptosuite verification result or an error". Thus only a failed `@context` check (step 4) and a signature that does not verify (step 8) give `verified: false`. Each other failure is an error. This layer does not verify the proofs that a `previousProof` names. It checks only the type of the value.

### 6. Verify Proof of section 4.4 returns a result with errors

`BIP340DataIntegrityProof.verifyProof(document, expectedPurpose?, mediaType?, expectedDomain?, expectedChallenge?)` does these steps:

- Step 1: for text that is not JSON, the function throws a `DataIntegrityProofError` of type `PARSING_ERROR`.
- Steps 2, 4, 5, 6, and 7 return a failed result: `verified: false`, `verifiedDocument: null`, `mediaType: null`, an empty `warnings` list, and one entry in `errors`.
- After step 4, the function returns a failed result with `PROOF_VERIFICATION_ERROR` for a proof with a `previousProof`.
- Step 8: an error of the cryptosuite propagates.
- Step 9: the result takes `verified` and `verifiedDocument` from the cryptosuite. `mediaType` is the input value if `verified` is true, else `null`.

Each entry of `errors` is a ProblemDetails map of RFC 9457. Its `type` is `https://w3id.org/security#<TYPE>`, its `title` is a fixed text of the type, and its `detail` is the message. Section 4.7 says: "The type value of the error object MUST be a URL that starts with the value https://w3id.org/security# and ends with the value in the section listed below." The list of section 4.7 has no `PARSING_ERROR`. Only step 2 of section 4.4 names it. Thus `https://w3id.org/security#PARSING_ERROR` is an extension by analogy, not a URL that section 4.7 defines.

Step 1 runs the Infra algorithm "parse JSON bytes to an Infra value", which lets the error of `JSON.parse` propagate. Section 3 says: "If an error is produced, the verification process failed to complete." Steps 1 and 8 do not say "an error MUST be raised", so they throw. Step 6 compares two sets: a string is a set of one string. `expectedDomain` is a string or an array, and `expectedPurpose` is optional.

### 7. The error types and `ProblemDetails`

- The common package adds the error types `PARSING_ERROR` and `INVALID_CHALLENGE_ERROR`, and the named export `INVALID_DOMAIN_ERROR`.
- The common package removes `PROOF_PARSING_ERROR`. No specification defines it (ADR 151).
- The common package adds the type `ProblemDetails`: `type`, the optional `title`, `status`, `detail`, and `instance`, and extension members.
- `transformDocument` throws a `CryptosuiteError` for a wrong `type` or `cryptosuite`, not a `MethodError`. The type stays `PROOF_VERIFICATION_ERROR`.

### 8. The key text and the `proofValue` text must be the base58btc text of the bytes

`SchnorrMultikey.fromVerificationMethod` compares the base58btc text of the decoded bytes with `publicKeyMultibase`. Other text gives a `MultikeyError` of type `VERIFICATION_METHOD_ERROR`, with the message `Invalid publicKeyMultibase: not the base58btc encoding of the key`. The comparison runs last, after the length, prefix, and point checks. Thus each earlier failure keeps its error. A decoder error is now a `MultikeyError` of type `VERIFICATION_METHOD_ERROR`, not a raw `Error`.

The internal function `decodeProofValue` accepts a string with the `z` header that decodes to 64 bytes and whose base58btc text equals the input. It refuses each other value, also a `u` (base64url) value.

### 9. Both update paths verify through the cryptosuite

- The resolver verifies with `new BIP340Cryptosuite(multikey).verifyProof(update)`. It no longer serializes the update to JSON text. Its proof field checks keep the `proofPurpose` check.
- A cryptosuite error gives `Invalid update: proof verification failed: ` and the message of the error, with `data.cause`.
- The resolver refuses a `previousProof` with `INVALID_DID_UPDATE` and the message `Invalid update: proof.previousProof must not be present: an update has one proof`. A `previousProof` of `null` also fails.
- `Updater.sign` gives `addProof` the unsigned update. `addProof` returns a new object, so the update of the caller keeps no proof.
- `Updater.sign` verifies with `verifier.toCryptosuite().verifyProof(signedUpdate)`. The config of `Updater.sign` sets the purpose `capabilityInvocation`.
- `signingMethodProblem` no longer compares the key text. The multikey error is the cause, with the same type and message as before.

The Update operation says: "Implementations SHOULD verify `update.proof` before they announce the update." Each path calls the cryptosuite layer, because the specification names a BIP340 Cryptosuite instance.

### 10. `createFromKms` signs through the KMS

`createFromKms(id, controller, keyId, kms)` returns a cryptosuite for `SchnorrMultikey.fromSigner(id, controller, kms.signer(keyId))`. The secret key stays in the KMS. Proof Serialization, step 1, permits this: "(or a signing interface enabling the use of the private key bytes)". For a watch-only key, `createProof` throws `KEY_NOT_SIGNER`, and `verifyProof` works.

### 11. The date checks follow XML Schema 1.1

The common package changes `DateUtils`:

- `isValidXsdDateTime(value)` applies the `dateTimeLexicalRep` regular expression of XML Schema 1.1 Part 2, section 3.3.7.2. It also checks that the day exists in the month. A value that is not a string gives `false`.
- `isValidXsdDateTimeStamp(value)` also requires a timezone.
- `xsdDateTimeToEpochMs(value)` gives the milliseconds for each year. It calculates the exact BigInt value, then converts it to a number.
- `compareXsdDateTime(a, b)` compares two instants exactly, with each year and each digit of a fraction.
- The leap-year rule reads only the last 4 digits of the year. 10000 is a multiple of 400, so the result is the same as for the full year.

The method package uses these functions. `proofInstant` uses `isValidXsdDateTimeStamp`, and `checkProofWindow` uses `compareXsdDateTime` for its three comparisons. `validateVersionTime` uses `xsdDateTimeToEpochMs`. The DID Core checks of `expires` and `revoked` use `isValidXsdDateTimeStamp`, and the internal `isDateTimeStamp` is removed. XML Schema 1.1, section 5.4, says about a value over the capacity of a processor: "the literal or value must not be treated as invalid, and the unsupported value must not be quietly changed to a supported value."

### 12. A block time and a `mediantime` are integers from 0 to 2^32-1

The resolver accepts an eligible signal only if its block time and its `mediantime` are integers from 0 to 2^32-1. Another value gives the same `ResolveError` of type `INVALID_DID_UPDATE` as a value that is not finite. Each such value is in the range of a JavaScript `Date`, so `checkProofWindow` can make the text of the block instant. The "Check update.proof" step compares `created` with "the timestamp in the block header", and that timestamp is a 32-bit unsigned integer.

### 13. The `proofValue` is base58btc text

The cryptosuite writes and reads only the `z` header. A `u` value gives `PROOF_VERIFICATION_ERROR`. Before, it gave a raw `Error` of the decoder. Three texts give base58btc: the algorithms of the suite, the example of the "DataIntegrityProof" section, and the did:btcr2 data structure. Only one sentence gives base-64-url. A specification issue on the cryptosuite repository can remove the conflict.

### 14. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| `isValidXsdDateTime` applies the XML Schema 1.1 grammar. `0000` is a valid year. `01000` and `24:00:00.5` are not valid. | XML Schema 1.1 Part 2, section 3.3.7.1: "First, ·year· is permitted to have the value zero." Section 3.3.7.2: "leading '0' digits are prohibited except to bring the digit count up to four." Section D.2.2: `endOfDayFrag ::= '24:00:00' ('.' '0'+)?`. | Old rule: refused `0000`, accepted `01000` and `24:00:00.5`: does not conform. New code: conforms. |
| `createProof` refuses a document that is not a map, with `PROOF_GENERATION_ERROR`. | VC Data Integrity, section 3: createProof is "An algorithm that takes an input document (map inputDocument) and proof options (map options) as input, and produces a data integrity proof (map) or an error." | Old rule: a raw `TypeError`. New code: a typed error. Conforms. |
| The rules of a proof verifier leave `created` to Proof Configuration. They check only the type of `previousProof`. | Proof Configuration (bip340-jcs-2025), step 3, for a `created` value that is not a valid XML Schema datetime: "an error MUST be raised and SHOULD convey an error type of PROOF_GENERATION_ERROR." Section 2.1, `previousProof`: "If present, it MUST be a string value or an unordered list of string values." | Conforms. |
| The host of a special scheme must be URL units with no forbidden host code point, and the URL parser must accept it. `https://a"b/` fails. No IDNA rule applies. | URL Standard: "A valid host string must be a valid domain string, a valid IPv4-address string, or: U+005B ([), followed by a valid IPv6-address string, followed by U+005D (])." | Old rule: no check of `id`: does not conform. New code: refuses no valid URL string. It accepts a host that only the IDNA rules refuse, so it does not fully conform (Consequences). |
| Step 4 of Verify Proof compares the `@context` values as JSON values. It does not call `canonicalize`, so it has no JCS error. | Verify Proof (bip340-jcs-2025), step 4.1: the document `@context` "starts with all values contained in the" proof `@context` "in the same order." | Old rule: no step 4: does not conform. New code: conforms. |
| A purpose, a domain, or a challenge is "given" if it is not `undefined`. The empty string is given. | VC Data Integrity, section 4.4, step 5: "If expectedProofPurpose was given, and it does not match proof.proofPurpose, an error MUST be raised and SHOULD convey an error type of PROOF_VERIFICATION_ERROR." | Old rule: the empty string skipped the check: does not conform. New code: conforms. |
| In Add Proof, "non-null" means not `undefined` and not `null`. The `domain` comparison uses JSON values. | Section 4.2, step 3: "If options has a non-null domain item, it MUST be equal to proof.domain or an error MUST be raised and SHOULD convey an error type of PROOF_GENERATION_ERROR." | Old rule: an empty string `domain` or `challenge` skipped the check: does not conform. New code: conforms. |
| The `previousProof` refusal of the section 4.4 layer is a failed result, after step 4. | Section 4: "Implementers MAY implement reasonable defaults and safeguards in addition to the algorithms below, to help mitigate developer error". Section 2.1: "all of which MUST also verify for the current proof to be considered verified." | Conforms. |
| Each error type has one fixed `title`. The `detail` holds the message. | Section 4.7: "The title value SHOULD provide a short but specific human-readable string for the error." | Conforms. |
| The resolver refuses a `previousProof` after the proof field checks and before the method lookup. | did:btcr2, "Check update.proof": "Raise [`INVALID_DID_UPDATE`] if verification fails." Each failure of the step has this error type. | Conforms. The order changes only the message. |
| `Updater.sign` keeps the `try` block of the verification. Only a cryptosuite error reaches it. | did:btcr2, Update: "Implementations SHOULD verify `update.proof` before they announce the update." | Conforms. |
| `createProof` refuses a `domain` array with a repeated string. `verifyProof` accepts it. | Section 2.1, `domain`: "If specified, the associated value MUST be either a string, or an unordered set of strings." | Old rule: no check: does not conform. New code: conforms. |
| `compareXsdDateTime` compares each digit of a fraction. | XML Schema 1.1 Part 2, section 5.4: "the unsupported value must not be quietly changed to a supported value." did:btcr2, "Check update.proof": "`update.proof.created` is after the timestamp in the block header." | Old rule: a `created` 0.5 ms after the header time passed: does not conform. New code: conforms. |
| `createProof` refuses options with a `proofValue`. | Section 4: "Implementers MAY implement reasonable defaults and safeguards in addition to the algorithms below, to help mitigate developer error". | Old rule: the proof signed the `proofValue` of the options, and verification always failed. New code: conforms. |
| A block time and a `mediantime` must be integers from 0 to 2^32-1. | did:btcr2, "Check update.proof": "`update.proof.created` is after the timestamp in the block header." and "`update.proof.expires` is before the block `mediantime`". | Old rule: accepted values that no block header holds: does not conform. New code: conforms. |

## Alternatives

**Return a result for each failure, also for steps 1 and 8.** Rejected. Steps 1 and 8 do not say "an error MUST be raised". Only the safeguard sentence of section 4 supports this form, so it is a deviation.

**Return a result for steps 2 to 8, and throw only for step 1.** Rejected. Section 3 makes an error of the cryptosuite a verification that "failed to complete".

**Refuse `previousProof` in the generic cryptosuite too.** Rejected. Verify Proof (bip340-jcs-2025) has no such step. A later verifier of section 4.5 can call the generic suite for each proof of a chain (ADR 054).

**Refuse `previousProof` only in the section 4.4 layer and in `addProof`.** Rejected. The resolver verifies on the cryptosuite layer. It then applies an update whose named proof can never verify, against section 2.1.

**No refusal of `previousProof`, and a specification issue.** Rejected. Section 2.1 already makes such a proof unverified.

**`createFromKms` as a suite that only verifies, or no `createFromKms`.** Rejected. Proof Serialization permits a signing interface, and the KMS signer is the signing interface of the api.

**Accept a document with a proof and an options `@context` with no document `@context`.** Rejected. The outputs never verify, and the caller gets no error.

**An absolute URL as the only valid `id`.** Rejected. The URL Standard makes `#key-0` and `proof-1` valid URL strings, so the resolver refuses a conformant proof.

**An RFC 3986 URI-reference as the `id` grammar.** Rejected. RFC 3986 refuses `#schlüssel` and `https://example.com/café`, which are valid URL strings.

**A string as the only `id` rule of a verifier.** Rejected. VC Data Integrity says: "Conforming processors MUST produce errors when non-conforming documents are consumed."

**`PROOF_VERIFICATION_ERROR` for a bad `created` on verify.** Rejected. Step 6 of Verify Proof runs Proof Configuration, and its step 3 gives `PROOF_GENERATION_ERROR`.

**Accept a `u` `proofValue` too.** Rejected. No algorithm of the suite writes it, and the did:btcr2 data structure gives base58btc.

**Compare the key text before the length and prefix checks.** Rejected. Text with a wrong prefix, length, or point then gets the cause of the text comparison, and its cause changes.

**Keep `Date.parse` and document the year limit.** Rejected. XML Schema 1.1, section 5.4, says that such a value "must not be treated as invalid".

## Consequences

- The common and cryptosuite packages get a MAJOR release. The method and api packages get a MINOR release. The other released packages get a PATCH release.
- A caller of `BIP340DataIntegrityProof.verifyProof` must read `verified` and `errors` for steps 2 and 4 to 7. Code that reads `PROOF_PARSING_ERROR` must read `PARSING_ERROR`.
- `verifiedDocument` is the unsecured document, not the secured document. A failed result gives `null`, not `undefined`.
- The resolver refuses an update proof with a member that breaks a rule of section 2.1, a `previousProof`, or other `proofValue` text. This changes the read rules. The 603 proofs of the pinned test vectors hold no such value, and the vector results stay the same: 100 pass and 189 fail offline.
- `message verify` and `api.btcr2.verifyMessage` refuse key text that is not the base58btc text of the key. An outside verifier must compare the text too, or it accepts a key that the api refuses.
- The read path accepts a proof time with the year `0000` or a year above 9999. The DID Core checks of `expires` and `revoked` accept the year `0000`. Both refuse `01000`, and `24:00:00` with a fraction that is not zero.
- A `versionTime` with a year above 9999 resolves the last version. A year with more than about 300 digits gives `Infinity` or `-Infinity` milliseconds, and the comparison with `mediantime` stays correct.
- `xsdDateTimeToEpochMs` rounds a value above `Number.MAX_SAFE_INTEGER`, but it keeps the order of two instants. An exact comparison must use `compareXsdDateTime`.
- A signer that returns a signature that is not 64 bytes makes `Updater.sign` fail with `Invalid update: cannot make the proof with "<id>": Invalid signature: the signer returned <n> bytes; a BIP340 signature has 64 bytes.`
- Residual: the `id` check accepts a host that only the IDNA rules refuse, for example `https://a_b/`.
- Residual: the cryptosuite does not implement proof sets and proof chains (sections 4.3 and 4.5).
- This ADR records these deviations from the texts:
  1. `https://w3id.org/security#PARSING_ERROR` is a type URL by analogy, because section 4.7 does not list `PARSING_ERROR`.
  2. Section 4 allows an input document with a proof, but `addProof` refuses such a document. The safeguard sentence of section 4 permits the refusal.
  3. The generic cryptosuite verifies a proof with a `previousProof` of the right type and does not verify the named proofs, against section 2.1. The did:btcr2 paths, `addProof`, and the section 4.4 layer refuse such a proof.
  4. The `proofValue` encoding follows the algorithms, not the base-64-url sentence of the "DataIntegrityProof" section.

**Superseded.**

- ADR 147, decision 2: the sentences "A strict decoder in the cryptosuite is a later change.", "The comparison covers only `publicKeyMultibase`.", and "The decoder also accepts other text for a `proofValue`, and the resolver does not refuse it." `SchnorrMultikey.fromVerificationMethod` now compares the key text, and the cryptosuite decodes the `proofValue` strictly (decision 8).
- ADR 147, decision 7: the bullet "`Updater.sign` gives `addProof` a copy of the unsigned update." with the rest of its text. Also the alternative "Fix `addProof` in the cryptosuite now." `addProof` now returns a copy (decision 1), so `Updater.sign` gives it the unsigned update (decision 9).
- ADR 112, the decision "`Updater.sign` verifies the proof before it returns": the clause "and verifies the signed update with the `capabilityInvocation` purpose". `Updater.sign` now verifies with `BIP340Cryptosuite.verifyProof`, which has no purpose input. The config of `Updater.sign` sets the purpose (decision 9).
- ADR 112, the decision "The read path checks the proof time window against the block of the Beacon Signal": the sentence "Each comparison is in milliseconds with no tolerance." Each comparison is now exact, with each digit of a fraction (decision 11).
- ADR 149, decision 5: the sentences "The new internal function `isDateTimeStamp` makes this check. The resolver uses it also for the `created` and `expires` values of a proof." `DateUtils.isValidXsdDateTimeStamp` of the common package now makes the check (decision 11).
- ADR 157, the alternative "A `ProblemDetails` type in the common package.": the rejection, with the sentence "Only the api builds the object, so the type is in the api." The cryptosuite now makes the error objects of a verification result, so the common package holds the type `ProblemDetails` (decision 7).

**Unchanged.**

- ADR 147: the three conditions of the method that signs, the order of the checks, and the cause `Invalid publicKeyMultibase: not the base58btc encoding of the key` of type `VERIFICATION_METHOD_ERROR`. Decision 8 of this ADR makes a decoder error of the key a `MultikeyError`, so the cause type is `VERIFICATION_METHOD_ERROR`, not `Error`.
- ADR 112: the proof field checks of the read path, the proof time window, the verification before `NeedFunding`, and `INVALID_DID_UPDATE` for each failure. Decision 9 of this ADR adds the `previousProof` refusal.
- ADR 105: an eligible signal with no valid block metadata fails at intake with `INVALID_DID_UPDATE`. Decision 12 of this ADR adds the range of a block header time.
- ADR 151: the error types that ADR 151 kept for a later change of the proof verification. Decision 7 of this ADR is that change.
- ADR 154: the JCS errors of `transformDocument` and `proofConfiguration`. Decision 7 of this ADR changes only the class of the `type` and `cryptosuite` errors of `transformDocument`.
- ADR 157: `ResolutionError` stays an api type, and the api makes the error object of a failed resolution.
- ADR 054: the cryptosuite stays method-agnostic. The URL grammar and the member rules are internal to the cryptosuite and hold no did:btcr2 rule.

## Implementation

- `packages/common/src/errors.ts`: `PARSING_ERROR`, `INVALID_CHALLENGE_ERROR`, the named export `INVALID_DOMAIN_ERROR`, and the removal of `PROOF_PARSING_ERROR`.
- `packages/common/src/types.ts`: `ProblemDetails`.
- `packages/common/src/utils/date.ts`: the XML Schema 1.1 regular expression, the BigInt day and millisecond helpers, `isValidXsdDateTime`, `isValidXsdDateTimeStamp`, `xsdDateTimeToEpochMs`, and `compareXsdDateTime`.
- `packages/cryptosuite/src/cryptosuite/proof-checks.ts` (new, internal): `isMap`, `isValidUrlString`, `contextStartsWith`, `proofOptionsProblem`, `securedProofProblem`, and `decodeProofValue`.
- `packages/cryptosuite/src/cryptosuite/index.ts`: `createProof`, `verifyProof`, the error class of `transformDocument`, and the `created` check of `proofConfiguration`. `interface.ts`: `CryptosuiteVerificationResult` and `VerificationResult`.
- `packages/cryptosuite/src/data-integrity-proof/index.ts` and `interface.ts`: `addProof`, `verifyProof`, and the titles of the error types.
- `packages/cryptosuite/src/multikey/index.ts`: the decoder error and the text comparison of `fromVerificationMethod`.
- `packages/method/src/core/resolver.ts`: `isBlockTime`, `validateVersionTime`, `proofInstant`, `checkProofWindow`, the `previousProof` refusal, and the cryptosuite verification.
- `packages/method/src/core/updater.ts`: `Updater.sign` with no copy, the cryptosuite verification, and the `@context` comment.
- `packages/method/src/utils/signing-method.ts`: the text comparison is removed. `did-core-conformance.ts`: `isDateTimeStamp` is removed.
- `packages/api/src/crypto.ts`: `createFromKms`, the return types, and the JSDoc. `message.ts`: the JSON round trip is removed. `index.ts`: the type exports.
- Tests: `packages/common/tests/errors.spec.ts` and `utils-date.spec.ts`. `packages/cryptosuite/tests/proof-checks.spec.ts` (new), `cryptosuite.spec.ts`, `data-integrity-proof.spec.ts`, and `multikey.spec.ts`. `packages/method/tests/resolver.spec.ts`, `updater.spec.ts`, `signing-method.spec.ts`, `did-core-conformance.spec.ts`, and `relative-did-url.spec.ts`. `packages/api/tests/crypto-api.spec.ts`, `cryptosuite-api.spec.ts`, `data-integrity-proof-api.spec.ts`, `did-method-api-message.spec.ts`, and `index-exports.spec.ts`.

## References

- [VC Data Integrity 1.0](https://www.w3.org/TR/vc-data-integrity/) (W3C Recommendation, 15 May 2025): sections 1.3, 2.1, 3, 4, 4.2 to 4.5, and 4.7.
- [Data Integrity BIP340 Cryptosuites v0.1](https://dcdpr.github.io/data-integrity-schnorr-secp256k1/): DataIntegrityProof, and Create Proof, Verify Proof, Transformation, Proof Configuration, and Proof Serialization of bip340-jcs-2025.
- [URL Standard](https://url.spec.whatwg.org/), section 3.4 (Host writing) and section 4.3 (URL writing).
- [XML Schema 1.1 Part 2: Datatypes](https://www.w3.org/TR/xmlschema11-2/): section 3.3.7 (dateTime), section 3.4.28 (dateTimeStamp), section 5.4 (Partial Implementation of Infinite Datatypes), and section D.2.2.
- [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457): Problem Details for HTTP APIs.
- did:btcr2 specification: [Data Structures](https://dcdpr.github.io/did-btcr2/data-structures.html) (Data Integrity Proof), [Update](https://dcdpr.github.io/did-btcr2/operations/update.html) (Construct BTCR2 Signed Update), and [Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html) (Check `update.proof`).
- Bitcoin Core: `CBlockHeader` in `src/primitives/block.h` (`uint32_t nTime`).
- ADRs 054, 105, 112, 147, 149, 151, 154, 157.
