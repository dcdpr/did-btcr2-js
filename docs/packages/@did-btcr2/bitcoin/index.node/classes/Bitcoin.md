# Class: Bitcoin

Defined in: [packages/bitcoin/src/bitcoin.node.ts:26](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.node.ts#L26)

General class to house the Bitcoin client connections, client config and various utility methods.

## Name

Bitcoin

## Constructors

### Constructor

> **new Bitcoin**(`configs?`): `Bitcoin`

Defined in: [packages/bitcoin/src/bitcoin.node.ts:40](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.node.ts#L40)

Creates an instance of the Bitcoin class.

#### Parameters

##### configs?

[`BitcoinNetworkConfigMap`](../type-aliases/BitcoinNetworkConfigMap.md)

Optional configuration object for the Bitcoin client. If not provided, it will
be loaded from the BITCOIN_CLIENT_CONFIG environment variables.

#### Returns

`Bitcoin`

#### Throws

If no configs is passed and BITCOIN_NETWORK_CONFIG is missing or invalid.

## Properties

### mainnet?

> `optional` **mainnet**: [`BitcoinNetworkConfig`](../type-aliases/BitcoinNetworkConfig.md)

Defined in: [packages/bitcoin/src/bitcoin.node.ts:28](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.node.ts#L28)

***

### mutinynet?

> `optional` **mutinynet**: [`BitcoinNetworkConfig`](../type-aliases/BitcoinNetworkConfig.md)

Defined in: [packages/bitcoin/src/bitcoin.node.ts:31](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.node.ts#L31)

***

### network

> **network**: [`BitcoinNetworkConfig`](../type-aliases/BitcoinNetworkConfig.md)

Defined in: [packages/bitcoin/src/bitcoin.node.ts:27](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.node.ts#L27)

***

### regtest?

> `optional` **regtest**: [`BitcoinNetworkConfig`](../type-aliases/BitcoinNetworkConfig.md)

Defined in: [packages/bitcoin/src/bitcoin.node.ts:32](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.node.ts#L32)

***

### signet?

> `optional` **signet**: [`BitcoinNetworkConfig`](../type-aliases/BitcoinNetworkConfig.md)

Defined in: [packages/bitcoin/src/bitcoin.node.ts:30](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.node.ts#L30)

***

### testnet?

> `optional` **testnet**: [`BitcoinNetworkConfig`](../type-aliases/BitcoinNetworkConfig.md)

Defined in: [packages/bitcoin/src/bitcoin.node.ts:29](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.node.ts#L29)

## Methods

### btcToSats()

> `static` **btcToSats**(`btc`): `number`

Defined in: [packages/bitcoin/src/bitcoin.node.ts:107](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.node.ts#L107)

Converts Bitcoin (BTC) to satoshis (SAT).

#### Parameters

##### btc

`number`

The amount in BTC.

#### Returns

`number`

The amount in SAT.

***

### satsToBtc()

> `static` **satsToBtc**(`sats`): `number`

Defined in: [packages/bitcoin/src/bitcoin.node.ts:116](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.node.ts#L116)

Converts satoshis (SAT) to Bitcoin (BTC).

#### Parameters

##### sats

`number`

The amount in SAT.

#### Returns

`number`

The amount in BTC.
