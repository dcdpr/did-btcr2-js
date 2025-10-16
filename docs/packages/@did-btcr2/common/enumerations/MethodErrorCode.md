# Enumeration: MethodErrorCode

Defined in: [packages/common/src/errors.ts:4](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L4)

An enumeration of possible DID error codes.

## Enumeration Members

### INTERNAL\_ERROR

> **INTERNAL\_ERROR**: `"INTERNAL_ERROR"`

Defined in: [packages/common/src/errors.ts:12](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L12)

An unexpected error occurred during the requested DID operation.

***

### INVALID\_CHALLENGE\_ERROR

> **INVALID\_CHALLENGE\_ERROR**: `"INVALID_CHALLENGE_ERROR"`

Defined in: [packages/common/src/errors.ts:79](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L79)

The proof is missing or has a malformed challenge field.

***

### INVALID\_DID

> **INVALID\_DID**: `"INVALID_DID"`

Defined in: [packages/common/src/errors.ts:6](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L6)

The DID supplied does not conform to valid syntax.

***

### INVALID\_DID\_DOCUMENT

> **INVALID\_DID\_DOCUMENT**: `"INVALID_DID_DOCUMENT"`

Defined in: [packages/common/src/errors.ts:15](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L15)

The DID document supplied does not conform to valid syntax.

***

### INVALID\_DID\_DOCUMENT\_LENGTH

> **INVALID\_DID\_DOCUMENT\_LENGTH**: `"INVALID_DID_DOCUMENT_LENGTH"`

Defined in: [packages/common/src/errors.ts:21](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L21)

The byte length of a DID document does not match the expected value.

***

### INVALID\_DID\_UPDATE

> **INVALID\_DID\_UPDATE**: `"INVALID_DID_UPDATE"`

Defined in: [packages/common/src/errors.ts:18](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L18)

The DID Update supplied does not conform to valid syntax.

***

### INVALID\_DID\_URL

> **INVALID\_DID\_URL**: `"INVALID_DID_URL"`

Defined in: [packages/common/src/errors.ts:24](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L24)

The DID URL supplied to the dereferencing function does not conform to valid syntax.

***

### INVALID\_DOMAIN\_ERROR

> **INVALID\_DOMAIN\_ERROR**: `"INVALID_DOMAIN_ERROR"`

Defined in: [packages/common/src/errors.ts:82](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L82)

The proof is missing or has a malformed domain field.

***

### INVALID\_PREVIOUS\_DID\_PROOF

> **INVALID\_PREVIOUS\_DID\_PROOF**: `"INVALID_PREVIOUS_DID_PROOF"`

Defined in: [packages/common/src/errors.ts:27](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L27)

The given proof of a previous DID is invalid

***

### INVALID\_PUBLIC\_KEY

> **INVALID\_PUBLIC\_KEY**: `"INVALID_PUBLIC_KEY"`

Defined in: [packages/common/src/errors.ts:30](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L30)

An invalid public key is detected during a DID operation.

***

### INVALID\_PUBLIC\_KEY\_LENGTH

> **INVALID\_PUBLIC\_KEY\_LENGTH**: `"INVALID_PUBLIC_KEY_LENGTH"`

Defined in: [packages/common/src/errors.ts:36](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L36)

The byte length of a public key does not match the expected value.

***

### INVALID\_PUBLIC\_KEY\_MULTIBASE

> **INVALID\_PUBLIC\_KEY\_MULTIBASE**: `"INVALID_PUBLIC_KEY_MULTIBASE"`

Defined in: [packages/common/src/errors.ts:33](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L33)

An invalid multibase format is detected on the public key during a DID operation.

***

### INVALID\_PUBLIC\_KEY\_TYPE

> **INVALID\_PUBLIC\_KEY\_TYPE**: `"INVALID_PUBLIC_KEY_TYPE"`

Defined in: [packages/common/src/errors.ts:39](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L39)

An invalid public key type was detected during a DID operation.

***

### INVALID\_SIDECAR\_DATA

> **INVALID\_SIDECAR\_DATA**: `"INVALID_SIDECAR_DATA"`

Defined in: [packages/common/src/errors.ts:76](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L76)

The sidecar data in the DID Update Payload was invalid.

***

### INVALID\_SIGNATURE

> **INVALID\_SIGNATURE**: `"INVALID_SIGNATURE"`

Defined in: [packages/common/src/errors.ts:42](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L42)

Verification of a signature failed during a DID operation.

***

### LATE\_PUBLISHING\_ERROR

> **LATE\_PUBLISHING\_ERROR**: `"LATE_PUBLISHING_ERROR"`

Defined in: [packages/common/src/errors.ts:73](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L73)

Something about the DID Update Payload indicates the potential for late publishing.

***

### METHOD\_NOT\_SUPPORTED

> **METHOD\_NOT\_SUPPORTED**: `"METHOD_NOT_SUPPORTED"`

Defined in: [packages/common/src/errors.ts:9](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L9)

The supplied method name is not supported by the DID method and/or DID resolver implementation.

***

### NOT\_FOUND

> **NOT\_FOUND**: `"NOT_FOUND"`

Defined in: [packages/common/src/errors.ts:46](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L46)

DID Resolution: The DID resolver was unable to find the DID document resulting from the resolution request.

***

### PROOF\_GENERATION\_ERROR

> **PROOF\_GENERATION\_ERROR**: `"PROOF_GENERATION_ERROR"`

Defined in: [packages/common/src/errors.ts:61](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L61)

The proof generation operation failed.

***

### PROOF\_PARSING\_ERROR

> **PROOF\_PARSING\_ERROR**: `"PROOF_PARSING_ERROR"`

Defined in: [packages/common/src/errors.ts:67](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L67)

The proof could not be parsed properly.

***

### PROOF\_SERIALIZATION\_ERROR

> **PROOF\_SERIALIZATION\_ERROR**: `"PROOF_SERIALIZATION_ERROR"`

Defined in: [packages/common/src/errors.ts:64](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L64)

The proof serialization operation failed.

***

### PROOF\_VERIFICATION\_ERROR

> **PROOF\_VERIFICATION\_ERROR**: `"PROOF_VERIFICATION_ERROR"`

Defined in: [packages/common/src/errors.ts:58](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L58)

The proof verification operation failed.

***

### REPRESENTATION\_NOT\_SUPPORTED

> **REPRESENTATION\_NOT\_SUPPORTED**: `"REPRESENTATION_NOT_SUPPORTED"`

Defined in: [packages/common/src/errors.ts:52](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L52)

The representation requested via the `accept` input metadata property is not supported by the
DID method and/or DID resolver implementation.

***

### UNSUPPORTED\_PUBLIC\_KEY\_TYPE

> **UNSUPPORTED\_PUBLIC\_KEY\_TYPE**: `"UNSUPPORTED_PUBLIC_KEY_TYPE"`

Defined in: [packages/common/src/errors.ts:55](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L55)

The type of a public key is not supported by the DID method and/or DID resolver implementation.

***

### VERIFICATION\_METHOD\_ERROR

> **VERIFICATION\_METHOD\_ERROR**: `"VERIFICATION_METHOD_ERROR"`

Defined in: [packages/common/src/errors.ts:70](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/errors.ts#L70)

The verification method was formed improperly.
