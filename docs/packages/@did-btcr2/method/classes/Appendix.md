# Class: Appendix

Defined in: [packages/method/src/utils/appendix.ts:30](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/appendix.ts#L30)

Implements [9. Appendix](https://dcdpr.github.io/did-btcr2/#appendix) methods.

 Appendix

## Constructors

### Constructor

> **new Appendix**(): `Appendix`

#### Returns

`Appendix`

## Methods

### derefernceRootCapabilityIdentifier()

> `static` **derefernceRootCapabilityIdentifier**(`capabilityId`): [`Btc1RootCapability`](../interfaces/Btc1RootCapability.md)

Defined in: [packages/method/src/utils/appendix.ts:184](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/appendix.ts#L184)

Implements [9.4.2 Dereference Root Capability Identifier](https://dcdpr.github.io/did-btcr2/#dereference-root-capability-identifier).

This algorithm takes in capabilityId, a root capability identifier, and dereferences it to rootCapability, the root
capability object.

#### Parameters

##### capabilityId

`string`

The root capability identifier to dereference.

#### Returns

[`Btc1RootCapability`](../interfaces/Btc1RootCapability.md)

The root capability object.

#### Example

for did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u SHOULD be mutated.
```
\{
 "@context": [
  "https://w3id.org/zcap/v1",
  "https://w3id.org/security/data-integrity/v2",
  "https://w3id.org/json-ld-patch/v1"
 ],
 "patch": [
  \{
   "op": "add",
   "path": "/service/4",
   "value": \{
      "id": "#linked-domain",
      "type": "LinkedDomains",
      "serviceEndpoint": "https://contact-me.com"
     \}
   \}
 ],
 "proof": \{
   "type": "DataIntegrityProof",
   "cryptosuite": "schnorr-secp256k1-jcs-2025",
   "verificationMethod": "did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u#initialKey",
   "invocationTarget": "did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u",
   "capability": "urn:zcap:root:did%3Abtc1%3Ak1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u",
   "capabilityAction": "Write",
   "proofPurpose": "assertionMethod",
   "proofValue": "z381yXYmxU8NudZ4HXY56DfMN6zfD8syvWcRXzT9xD9uYoQToo8QsXD7ahM3gXTzuay5WJbqTswt2BKaGWYn2hHhVFKJLXaDz"
  \}
\}

***

### deriveRootCapability()

> `static` **deriveRootCapability**(`identifier`): [`Btc1RootCapability`](../interfaces/Btc1RootCapability.md)

Defined in: [packages/method/src/utils/appendix.ts:120](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/appendix.ts#L120)

Implements [9.4.1 Derive Root Capability from did:btcr2 Identifier](https://dcdpr.github.io/did-btcr2/#derive-root-capability-from-didbtc1-identifier).

The Derive Root Capability algorithm deterministically generates a ZCAP-LD root capability from a given did:btcr2
identifier. Each root capability is unique to the identifier. This root capability is defined and understood by the
did:btcr2 specification as the root capability to authorize updates to the specific did:btcr2 identifiers DID
document. It takes in a did:btcr2 identifier and returns a rootCapability object. It returns the root capability.

#### Parameters

##### identifier

`string`

The did-btcr2 identifier to derive the root capability from

#### Returns

[`Btc1RootCapability`](../interfaces/Btc1RootCapability.md)

The root capability object

#### Example

did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u
```
{
 "@context": "https://w3id.org/zcap/v1",
 "id": "urn:zcap:root:did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u",
 "controller": "did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u",
 "invocationTarget": "did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u"
}
```

***

### extractDidFragment()

> `static` **extractDidFragment**(`input`): `undefined` \| `string`

Defined in: [packages/method/src/utils/appendix.ts:36](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/appendix.ts#L36)

Extracts a DID fragment from a given input

#### Parameters

##### input

`unknown`

The input to extract the DID fragment from

#### Returns

`undefined` \| `string`

The extracted DID fragment or undefined if not found

***

### fetchFromCas()

> `static` **fetchFromCas**(`hashBytes`): `Promise`&lt;`undefined` \| `string`&gt;

Defined in: [packages/method/src/utils/appendix.ts:241](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/appendix.ts#L241)

Implements [9.3. Fetch Content from Addressable Storage](https://dcdpr.github.io/did-btcr2/#fetch-content-from-addressable-storage).

The Fetch Content from Addressable Storage function takes in SHA256 hash of some content, hashBytes, converts these
bytes to a IPFS v1 Content Identifier and attempts to retrieve the identified content from Content Addressable
Storage (CAS). It returns the retrieved content or null.

#### Parameters

##### hashBytes

[`Bytes`](../../common/type-aliases/Bytes.md)

The SHA256 hash of the content to be fetched.

#### Returns

`Promise`&lt;`undefined` \| `string`&gt;

The fetched content or null if not found.

***

### getVerificationMethods()

> `static` **getVerificationMethods**(`didDocument`): [`DidVerificationMethod`](DidVerificationMethod.md)[]

Defined in: [packages/method/src/utils/appendix.ts:83](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/appendix.ts#L83)

Extracts the verification methods from a given DID Document

#### Parameters

##### didDocument

`DidDocument`

#### Returns

[`DidVerificationMethod`](DidVerificationMethod.md)[]

An array of DidVerificationMethod objects

#### Throws

if the didDocument is not provided

***

### isDidService()

> `static` **isDidService**(`obj`): `obj is DidService`

Defined in: [packages/method/src/utils/appendix.ts:66](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/appendix.ts#L66)

Validates that the given object is a DidService

#### Parameters

##### obj

`unknown`

The object to validate

#### Returns

`obj is DidService`

A boolean indicating whether the object is a DidService

***

### isDidVerificationMethod()

> `static` **isDidVerificationMethod**(`obj`): `obj is DidVerificationMethod`

Defined in: [packages/method/src/utils/appendix.ts:47](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/appendix.ts#L47)

Validates that the given object is a DidVerificationMethod

#### Parameters

##### obj

`unknown`

The object to validate

#### Returns

`obj is DidVerificationMethod`

A boolean indicating whether the object is a DidVerificationMethod
