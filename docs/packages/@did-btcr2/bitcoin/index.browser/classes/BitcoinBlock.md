# Class: BitcoinBlock

Defined in: [packages/bitcoin/src/rest-client.ts:289](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L289)

Implements a strongly-typed BitcoinRest to connect to remote bitcoin node via REST API for block-related operations.
 BitcoinBlock

## Constructors

### Constructor

> **new BitcoinBlock**(`api`): `BitcoinBlock`

Defined in: [packages/bitcoin/src/rest-client.ts:292](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L292)

#### Parameters

##### api

(`params`) => `Promise`&lt;`any`&gt;

#### Returns

`BitcoinBlock`

## Methods

### count()

> **count**(): `Promise`&lt;`number`&gt;

Defined in: [packages/bitcoin/src/rest-client.ts:300](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L300)

Returns the blockheight of the most-work fully-validated chain. The genesis block has height 0.

#### Returns

`Promise`&lt;`number`&gt;

The number of the blockheight with the most-work of the fully-validated chain.

***

### get()

> **get**(`params`): `Promise`&lt;`undefined` \| [`BlockResponse`](../type-aliases/BlockResponse.md)&gt;

Defined in: [packages/bitcoin/src/rest-client.ts:312](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L312)

Returns the block data associated with a `blockhash` of a valid block.

#### Parameters

##### params

[`GetBlockParams`](../interfaces/GetBlockParams.md)

See [GetBlockParams](../interfaces/GetBlockParams.md) for details.

#### Returns

`Promise`&lt;`undefined` \| [`BlockResponse`](../type-aliases/BlockResponse.md)&gt;

A promise resolving to a [BlockResponse](../type-aliases/BlockResponse.md) formatted depending on `verbosity` level.

#### Throws

If neither `blockhash` nor `height` is provided.

***

### getHash()

> **getHash**(`height`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/rest-client.ts:334](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L334)

Get the block hash for a given block height.
See [Esplora GET /block-height/:height](https://github.com/blockstream/esplora/blob/master/API.md#get-block-heightheight) for details.

#### Parameters

##### height

`number`

The block height (required).

#### Returns

`Promise`&lt;`string`&gt;

The hash of the block currently at height..
