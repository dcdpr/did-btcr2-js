# Class: Bitcoin

Defined in: [packages/bitcoin/src/bitcoin.browser.ts:24](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.browser.ts#L24)

General class to house the Bitcoin client connections, client config and various utility methods.

## Name

Bitcoin

## Constructors

### Constructor

> **new Bitcoin**(`configs?`): `Bitcoin`

Defined in: [packages/bitcoin/src/bitcoin.browser.ts:38](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.browser.ts#L38)

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

Defined in: [packages/bitcoin/src/bitcoin.browser.ts:26](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.browser.ts#L26)

***

### mutinynet?

> `optional` **mutinynet**: [`BitcoinNetworkConfig`](../type-aliases/BitcoinNetworkConfig.md)

Defined in: [packages/bitcoin/src/bitcoin.browser.ts:29](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.browser.ts#L29)

***

### network

> **network**: [`BitcoinNetworkConfig`](../type-aliases/BitcoinNetworkConfig.md)

Defined in: [packages/bitcoin/src/bitcoin.browser.ts:25](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.browser.ts#L25)

***

### regtest?

> `optional` **regtest**: [`BitcoinNetworkConfig`](../type-aliases/BitcoinNetworkConfig.md)

Defined in: [packages/bitcoin/src/bitcoin.browser.ts:30](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.browser.ts#L30)

***

### signet?

> `optional` **signet**: [`BitcoinNetworkConfig`](../type-aliases/BitcoinNetworkConfig.md)

Defined in: [packages/bitcoin/src/bitcoin.browser.ts:28](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.browser.ts#L28)

***

### testnet?

> `optional` **testnet**: [`BitcoinNetworkConfig`](../type-aliases/BitcoinNetworkConfig.md)

Defined in: [packages/bitcoin/src/bitcoin.browser.ts:27](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.browser.ts#L27)

## Methods

### btcToSats()

> `static` **btcToSats**(`btc`): `number`

Defined in: [packages/bitcoin/src/bitcoin.browser.ts:103](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.browser.ts#L103)

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

Defined in: [packages/bitcoin/src/bitcoin.browser.ts:112](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/bitcoin.browser.ts#L112)

Converts satoshis (SAT) to Bitcoin (BTC).

#### Parameters

##### sats

`number`

The amount in SAT.

#### Returns

`number`

The amount in BTC.
