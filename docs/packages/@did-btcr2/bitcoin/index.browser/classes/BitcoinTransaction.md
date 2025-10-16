# Class: BitcoinTransaction

Defined in: [packages/bitcoin/src/rest-client.ts:222](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L222)

## Constructors

### Constructor

> **new BitcoinTransaction**(`api`): `BitcoinTransaction`

Defined in: [packages/bitcoin/src/rest-client.ts:225](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L225)

#### Parameters

##### api

(`params`) => `Promise`&lt;`any`&gt;

#### Returns

`BitcoinTransaction`

## Methods

### get()

> **get**(`txid`): `Promise`&lt;[`RawTransactionRest`](../interfaces/RawTransactionRest.md)&gt;

Defined in: [packages/bitcoin/src/rest-client.ts:235](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L235)

Returns the transaction in JSON format.
See [Esplora GET /tx/:txid](https://github.com/blockstream/esplora/blob/master/API.md#get-txtxid) for details.

#### Parameters

##### txid

`string`

The transaction id (required).

#### Returns

`Promise`&lt;[`RawTransactionRest`](../interfaces/RawTransactionRest.md)&gt;

A promise resolving to data about a transaction in the form specified by verbosity.

***

### getHex()

> **getHex**(`txid`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/rest-client.ts:257](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L257)

Returns the raw transaction in hex or as binary data.
See [Esplora GET /tx/:txid/hex](https://github.com/blockstream/esplora/blob/master/API.md#get-txtxidhex) and
[Esplora GET /tx/:txid/raw](https://github.com/blockstream/esplora/blob/master/API.md#get-txtxidraw) for details.

#### Parameters

##### txid

`string`

The transaction id (required).

#### Returns

`Promise`&lt;`string`&gt;

A promise resolving to the raw transaction in the specified format.

***

### getRaw()

> **getRaw**(`txid`): `Promise`&lt;[`Bytes`](../../../common/type-aliases/Bytes.md)&gt;

Defined in: [packages/bitcoin/src/rest-client.ts:268](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L268)

Returns the raw transaction in hex or as binary data.
See [Esplora GET /tx/:txid/hex](https://github.com/blockstream/esplora/blob/master/API.md#get-txtxidhex) and
[Esplora GET /tx/:txid/raw](https://github.com/blockstream/esplora/blob/master/API.md#get-txtxidraw) for details.

#### Parameters

##### txid

`string`

The transaction id (required).

#### Returns

`Promise`&lt;[`Bytes`](../../../common/type-aliases/Bytes.md)&gt;

A promise resolving to the raw transaction in the specified format.

***

### isConfirmed()

> **isConfirmed**(`txid`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/bitcoin/src/rest-client.ts:245](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L245)

Returns the transaction in JSON format.
See [Esplora GET /tx/:txid](https://github.com/blockstream/esplora/blob/master/API.md#get-txtxid) for details.

#### Parameters

##### txid

`string`

The transaction id (required).

#### Returns

`Promise`&lt;`boolean`&gt;

A promise resolving to data about a transaction in the form specified by verbosity.

***

### send()

> **send**(`tx`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/rest-client.ts:279](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L279)

Broadcast a raw transaction to the network. The transaction should be provided as hex in the request body. The txid
will be returned on success.
See [Esplora POST /tx](https://github.com/blockstream/esplora/blob/master/API.md#post-tx) for details.

#### Parameters

##### tx

`string`

The raw transaction in hex format (required).

#### Returns

`Promise`&lt;`string`&gt;

The transaction id of the broadcasted transaction.
