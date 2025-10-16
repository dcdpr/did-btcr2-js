# Class: Create

Defined in: [packages/method/src/core/crud/create.ts:58](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/create.ts#L58)

Implements section [4.1 Create](https://dcdpr.github.io/did-btcr2/#create).

A did:btcr2 identifier and associated DID document can either be created deterministically from a cryptographic seed,
or it can be created from an arbitrary genesis intermediate DID document representation. In both cases, DID creation
can be undertaken in an offline manner, i.e., the DID controller does not need to interact with the Bitcoin network
to create their DID.

 Create

## Constructors

### Constructor

> **new Create**(): `Create`

#### Returns

`Create`

## Methods

### deterministic()

> `static` **deterministic**(`params`): [`CreateResponse`](../type-aliases/CreateResponse.md)

Defined in: [packages/method/src/core/crud/create.ts:72](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/create.ts#L72)

Implements [4.1.1 Deterministic Key-Based Creation](https://dcdpr.github.io/did-btcr2/#deterministic-key-based-creation).

For deterministic key-based creation, the did:btcr2 identifier encodes a secp256k1 public key. The key is then used
to deterministically generate the initial DID document.

#### Parameters

##### params

See [CreateKeyParams](../type-aliases/CreateKeyParams.md) for details.

###### options

[`DidCreateOptions`](../interfaces/DidCreateOptions.md)

###### pubKeyBytes

[`Bytes`](../../common/type-aliases/Bytes.md)

public key bytes for id creation.

#### Returns

[`CreateResponse`](../type-aliases/CreateResponse.md)

A response object of type [CreateResponse](../type-aliases/CreateResponse.md).

#### Throws

if the public key is missing or invalid.

***

### external()

> `static` **external**(`params`): `Promise`&lt;[`CreateResponse`](../type-aliases/CreateResponse.md)&gt;

Defined in: [packages/method/src/core/crud/create.ts:131](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/create.ts#L131)

Implements [4.1.2 External Initial Document Creation](https://dcdpr.github.io/did-btcr2/#external-initial-document-creation).

Creates a did:btcr2 identifier from some initiating arbitrary DID document. This allows for more complex
initial DID documents, including the ability to include Service Endpoints and Beacons that support aggregation.
Inputs include `intermediateDocument`, optional version and network returning initialDidDocument. The
intermediateDocument should be a valid DID document except all places where the DID document requires the use of
the identifier (e.g. the id field). These fields should use placeholder value
`did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`. The intermediateDocument should include at
least one verificationMethod and service of the type SingletonBeacon.

#### Parameters

##### params

See [CreateExternalParams](../type-aliases/CreateExternalParams.md) for details.

###### intermediateDocument

[`IntermediateDidDocument`](IntermediateDidDocument.md)

###### options

[`DidCreateOptions`](../interfaces/DidCreateOptions.md)

#### Returns

`Promise`&lt;[`CreateResponse`](../type-aliases/CreateResponse.md)&gt;

A Promise resolving to CreateResponses.

#### Throws

if the verificationMethod or service objects are missing required properties
