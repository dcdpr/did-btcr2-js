# Class: BitcoinAddress

Defined in: [packages/bitcoin/src/rest-client.ts:344](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L344)

Implements a strongly-typed BitcoinRest to connect to remote bitcoin node via REST API for address-related operations.
 BitcoinAddress

## Constructors

### Constructor

> **new BitcoinAddress**(`api`): `BitcoinAddress`

Defined in: [packages/bitcoin/src/rest-client.ts:347](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L347)

#### Parameters

##### api

(`params`) => `Promise`&lt;`any`&gt;

#### Returns

`BitcoinAddress`

## Methods

### getConfirmedTxs()

> **getConfirmedTxs**(`addressOrScripthash`, `lastSeenTxId?`): `Promise`&lt;[`RawTransactionRest`](../interfaces/RawTransactionRest.md)[]&gt;

Defined in: [packages/bitcoin/src/rest-client.ts:403](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L403)

Get confirmed transaction history for the specified address/scripthash, sorted with newest first.
Returns 25 transactions per page. More can be requested by specifying the last txid seen by the previous query.

#### Parameters

##### addressOrScripthash

`string`

The address or scripthash to check.

##### lastSeenTxId?

`string`

The last transaction id seen by the previous query (optional).

#### Returns

`Promise`&lt;[`RawTransactionRest`](../interfaces/RawTransactionRest.md)[]&gt;

A promise resolving to an array of [RawTransactionRest](../interfaces/RawTransactionRest.md) objects.

***

### getInfo()

> **getInfo**(`addressOrScripthash`): `Promise`&lt;[`AddressInfo`](../interfaces/AddressInfo.md)&gt;

Defined in: [packages/bitcoin/src/rest-client.ts:392](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L392)

Get information about an address/scripthash.
Available fields: address/scripthash, chain_stats and mempool_stats.
\{chain,mempool\}_stats each contain an object with tx_count, funded_txo_count, funded_txo_sum, spent_txo_count and spent_txo_sum.
Elements-based chains don't have the \{funded,spent\}_txo_sum fields.

#### Parameters

##### addressOrScripthash

`string`

The address or scripthash to check.

#### Returns

`Promise`&lt;[`AddressInfo`](../interfaces/AddressInfo.md)&gt;

A promise resolving to an [AddressInfo](../interfaces/AddressInfo.md) object.

***

### getTxs()

> **getTxs**(`addressOrScripthash`): `Promise`&lt;[`RawTransactionRest`](../interfaces/RawTransactionRest.md)[]&gt;

Defined in: [packages/bitcoin/src/rest-client.ts:358](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L358)

Get transaction history for the specified address/scripthash, sorted with newest first.
Returns up to 50 mempool transactions plus the first 25 confirmed transactions.
See [Esplora GET /address/:address/txs](https://github.com/blockstream/esplora/blob/master/API.md#get-addressaddresstxs) for details.

#### Parameters

##### addressOrScripthash

`string`

The address or scripthash to check.

#### Returns

`Promise`&lt;[`RawTransactionRest`](../interfaces/RawTransactionRest.md)[]&gt;

A promise resolving to an array of [RawTransactionRest](../interfaces/RawTransactionRest.md) objects.

***

### getTxsMempool()

> **getTxsMempool**(`addressOrScripthash`): `Promise`&lt;[`RawTransactionRest`](../interfaces/RawTransactionRest.md)[]&gt;

Defined in: [packages/bitcoin/src/rest-client.ts:380](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L380)

Get unconfirmed transaction history for the specified address/scripthash.
Returns up to 50 transactions (no paging).

#### Parameters

##### addressOrScripthash

`string`

The address or scripthash to check.

#### Returns

`Promise`&lt;[`RawTransactionRest`](../interfaces/RawTransactionRest.md)[]&gt;

A promise resolving to an array of [RawTransactionRest](../interfaces/RawTransactionRest.md) objects.

***

### getUtxos()

> **getUtxos**(`addressOrScripthash`): `Promise`&lt;[`AddressUtxo`](../interfaces/AddressUtxo.md)[]&gt;

Defined in: [packages/bitcoin/src/rest-client.ts:417](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L417)

Get the list of unspent transaction outputs associated with the address/scripthash.
See [Esplora GET /address/:address/utxo](https://github.com/Blockstream/esplora/blob/master/API.md#get-addressaddressutxo) for details.

#### Parameters

##### addressOrScripthash

`string`

The address or scripthash to check.

#### Returns

`Promise`&lt;[`AddressUtxo`](../interfaces/AddressUtxo.md)[]&gt;

A promise resolving to an array of [RawTransactionRest](../interfaces/RawTransactionRest.md) objects.

***

### isFundedAddress()

> **isFundedAddress**(`addressOrScripthash`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/bitcoin/src/rest-client.ts:368](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L368)

Calls getAddressTxs and checks if any funds come back.
Toggle if those funds are confirmed.

#### Parameters

##### addressOrScripthash

`string`

The address or scripthash to check.

#### Returns

`Promise`&lt;`boolean`&gt;

True if the address has any funds, false otherwise.
