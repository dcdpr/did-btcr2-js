# Class: BitcoinRest

Defined in: [packages/bitcoin/src/rest-client.ts:105](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L105)

Implements a strongly-typed BitcoinRest to connect to remote bitcoin node via REST API.
 BitcoinRest

## Constructors

### Constructor

> **new BitcoinRest**(`config`): `BitcoinRest`

Defined in: [packages/bitcoin/src/rest-client.ts:137](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L137)

#### Parameters

##### config

[`RestClientConfig`](RestClientConfig.md)

#### Returns

`BitcoinRest`

## Properties

### address

> **address**: [`BitcoinAddress`](BitcoinAddress.md)

Defined in: [packages/bitcoin/src/rest-client.ts:129](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L129)

The api calls related to bitcoin addresses.

***

### api()

> **api**: (`params`) => `Promise`&lt;`any`&gt;

Defined in: [packages/bitcoin/src/rest-client.ts:135](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L135)

The API call method that can be used to make requests to the REST API.

#### Parameters

##### params

[`RestApiCallParams`](../interfaces/RestApiCallParams.md)

#### Returns

`Promise`&lt;`any`&gt;

A promise resolving to the response data.

***

### block

> **block**: [`BitcoinBlock`](BitcoinBlock.md)

Defined in: [packages/bitcoin/src/rest-client.ts:123](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L123)

The api calls related to bitcoin blocks.

***

### transaction

> **transaction**: [`BitcoinTransaction`](BitcoinTransaction.md)

Defined in: [packages/bitcoin/src/rest-client.ts:117](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L117)

The api calls related to bitcoin transactions.

## Methods

### connect()

> `static` **connect**(`config?`): `BitcoinRest`

Defined in: [packages/bitcoin/src/rest-client.ts:164](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L164)

Static method connects to a bitcoin node running a esplora REST API.

#### Parameters

##### config?

[`RestClientConfig`](RestClientConfig.md)

The configuration object for the client (optional).

#### Returns

`BitcoinRest`

A new BitcoinRest instance.

#### Example

```
const rest = BitcoinRest.connect();
```
