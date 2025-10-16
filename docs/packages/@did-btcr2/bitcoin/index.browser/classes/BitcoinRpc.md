# Class: BitcoinRpc

Defined in: [packages/bitcoin/src/rpc-client.ts:73](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L73)

Encapsulates a RpcClient \| Client object from [\`bitcoin-core\`](https://www.npmjs.com/package/bitcoin-core).
Implements a strongly-typed [IBitcoinRpc interface](../interfaces/IBitcoinRpc.md) for added expresivity and developer support.
 BitcoinRpc

## Implements

- [`IBitcoinRpc`](../interfaces/IBitcoinRpc.md)

## Constructors

### Constructor

> **new BitcoinRpc**(`config`): `BitcoinRpc`

Defined in: [packages/bitcoin/src/rpc-client.ts:99](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L99)

Constructs a new BitcoinRpc instance from a new RpcClient \| RpcClient.

#### Parameters

##### config

[`RpcClientConfig`](RpcClientConfig.md)

The bitcoin-core client instance.

#### Returns

`BitcoinRpc`

#### Example

```
 import BitcoinRpc from '@did-btcr2/method';
 const bob = BitcoinRpc.connect(); // To use default polar config, pass no args. Polar must run locally.
```

## Accessors

### client

#### Get Signature

> **get** **client**(): `Client`

Defined in: [packages/bitcoin/src/rpc-client.ts:128](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L128)

Get the client for the current BitcoinRpc object.

##### Example

```
const alice = BitcoinRpc.connect();
const config = alice.client;
```

##### Returns

`Client`

The encapsulated RpcClient object.

***

### config

#### Get Signature

> **get** **config**(): [`RpcClientConfig`](RpcClientConfig.md)

Defined in: [packages/bitcoin/src/rpc-client.ts:114](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L114)

Get the config for the current BitcoinRpc object.

##### Example

```
 import BitcoinRpc from '@did-btcr2/method';
 const alice = BitcoinRpc.connect();
 const config = alice.config;
```

##### Returns

[`RpcClientConfig`](RpcClientConfig.md)

The encapsulated [RpcClientConfig](RpcClientConfig.md) object.

## Methods

### abandonTransaction()

> **abandonTransaction**(`txid`): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:288](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L288)

TODO: Comments

#### Parameters

##### txid

`string`

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`abandonTransaction`](../interfaces/IBitcoinRpc.md#abandontransaction)

***

### abortRescan()

> **abortRescan**(): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:295](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L295)

TODO: Comments

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`abortRescan`](../interfaces/IBitcoinRpc.md#abortrescan)

***

### addMultisigAddress()

> **addMultisigAddress**(): `Promise`&lt;`any`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:623](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L623)

TODO: Comments

#### Returns

`Promise`&lt;`any`&gt;

***

### addMultiSigAddress()

> **addMultiSigAddress**(`params`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:302](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L302)

TODO: Comments

#### Parameters

##### params

[`AddMultiSigAddressParams`](../type-aliases/AddMultiSigAddressParams.md)

#### Returns

`Promise`&lt;`string`&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`addMultiSigAddress`](../interfaces/IBitcoinRpc.md#addmultisigaddress)

***

### addWitnessAddress()

> **addWitnessAddress**(`address`): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:309](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L309)

TODO: Comments

#### Parameters

##### address

`string`

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`addWitnessAddress`](../interfaces/IBitcoinRpc.md#addwitnessaddress)

***

### backupWallet()

> **backupWallet**(`destination`): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:316](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L316)

TODO: Comments

#### Parameters

##### destination

`string`

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`backupWallet`](../interfaces/IBitcoinRpc.md#backupwallet)

***

### bumpFee()

> **bumpFee**(`txid`, `options?`): `Promise`&lt;[`BumpFeeResult`](../type-aliases/BumpFeeResult.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:323](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L323)

TODO: Comments

#### Parameters

##### txid

`string`

##### options?

[`BumpFeeOptions`](../type-aliases/BumpFeeOptions.md)

#### Returns

`Promise`&lt;[`BumpFeeResult`](../type-aliases/BumpFeeResult.md)&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`bumpFee`](../interfaces/IBitcoinRpc.md#bumpfee)

***

### clearBanned()

> **clearBanned**(): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:841](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L841)

Removes all banned nodes from the ban list.

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`clearBanned`](../interfaces/IBitcoinRpc.md#clearbanned)

***

### combineRawTransaction()

> **combineRawTransaction**(`txs`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:521](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L521)

TODO: Comments

#### Parameters

##### txs

`string`[]

#### Returns

`Promise`&lt;`string`&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`combineRawTransaction`](../interfaces/IBitcoinRpc.md#combinerawtransaction)

***

### createMultisig()

> **createMultisig**(`params`): `Promise`&lt;[`CreateMultiSigResult`](../type-aliases/CreateMultiSigResult-1.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:560](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L560)

Creates a multi-signature address with n signature of m keys required.

#### Parameters

##### params

[`CreateMultisigParams`](../type-aliases/CreateMultisigParams.md)

The parameters for the createMultisig command.

#### Returns

`Promise`&lt;[`CreateMultiSigResult`](../type-aliases/CreateMultiSigResult-1.md)&gt;

json object with the address and redeemScript.

#### Example

```
const bob = BitcoinRpc.connect();
const keys = [
 '03789ed0bb717d88f7d321a368d905e7430207ebbd82bd342cf11ae157a7ace5fd',
 '03dbc6764b8884a92e871274b87583e6d5c2a58819473e17e107ef3f6aa5a61626'
];
const multisig = await bob.createMultisig({ nrequired: 2, keys });
```

***

### createMultiSig()

> **createMultiSig**(`nrequired`, `keys`): `Promise`&lt;[`CreateMultiSigResult`](../type-aliases/CreateMultiSigResult-1.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:330](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L330)

TODO: Comments

#### Parameters

##### nrequired

`number`

##### keys

`string`[]

#### Returns

`Promise`&lt;[`CreateMultiSigResult`](../type-aliases/CreateMultiSigResult-1.md)&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`createMultiSig`](../interfaces/IBitcoinRpc.md#createmultisig)

***

### createRawTransaction()

> **createRawTransaction**(`inputs`, `outputs`, `locktime?`, `replacable?`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:537](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L537)

Create a transaction spending the given inputs and creating new outputs.
Outputs can be addresses or data.
Returns hex-encoded raw transaction.
Note that the transaction's inputs are not signed, and
it is not stored in the wallet or transmitted to the network.

#### Parameters

##### inputs

[`CreateRawTxInputs`](../type-aliases/CreateRawTxInputs.md)[]

The inputs to the transaction (required).

##### outputs

[`CreateRawTxOutputs`](../type-aliases/CreateRawTxOutputs.md)[]

The outputs of the transaction (required).

##### locktime?

`number`

The locktime of the transaction (optional).

##### replacable?

`boolean`

Whether the transaction is replaceable (optional).

#### Returns

`Promise`&lt;`string`&gt;

The hex-encoded raw transaction.

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`createRawTransaction`](../interfaces/IBitcoinRpc.md#createrawtransaction)

***

### createSignSendRawTransaction()

> **createSignSendRawTransaction**(`inputs`, `outputs`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:497](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L497)

Combines calls to `createRawTransaction`, `signRawTransaction` and `sendRawTransaction`.

#### Parameters

##### inputs

[`CreateRawTxInputs`](../type-aliases/CreateRawTxInputs.md)[]

The inputs to the transaction (required).

##### outputs

[`CreateRawTxOutputs`](../type-aliases/CreateRawTxOutputs.md)[]

The outputs of the transaction (required).

#### Returns

`Promise`&lt;`string`&gt;

A promise resolving to the transaction hash in hex.

***

### createWallet()

> **createWallet**(`params`): `Promise`&lt;[`CreateWalletResult`](../type-aliases/CreateWalletResult.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:337](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L337)

TODO: Comments

#### Parameters

##### params

[`CreateWalletParams`](../type-aliases/CreateWalletParams.md)

#### Returns

`Promise`&lt;[`CreateWalletResult`](../type-aliases/CreateWalletResult.md)&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`createWallet`](../interfaces/IBitcoinRpc.md#createwallet)

***

### createWalletDescriptor()

> **createWalletDescriptor**(`type`, `options`): `Promise`&lt;[`CreateWalletDescriptorsResult`](../type-aliases/CreateWalletDescriptorsResult.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:639](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L639)

Creates the wallet's descriptor for the given address type. The address type must be one that the
wallet does not already have a descriptor for. Requires wallet passphrase to be set with walletpassphrase call
if wallet is encrypted.

#### Parameters

##### type

`string`

The address type the descriptor will produce. Options are "legacy", "p2sh-segwit", "bech32", and "bech32m". (string, required)

##### options

[`CreateWalletDescriptorOptions`](../type-aliases/CreateWalletDescriptorOptions.md)

Options object that can be used to pass named arguments, listed below. (json object, optional)

#### Returns

`Promise`&lt;[`CreateWalletDescriptorsResult`](../type-aliases/CreateWalletDescriptorsResult.md)&gt;

A [CreateWalletDescriptorsResult](../type-aliases/CreateWalletDescriptorsResult.md) response object

***

### decodeRawTransaction()

> **decodeRawTransaction**(`hexstring`): `Promise`&lt;[`DecodedRawTransaction`](../type-aliases/DecodedRawTransaction.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:514](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L514)

TODO: Comments

#### Parameters

##### hexstring

`string`

#### Returns

`Promise`&lt;[`DecodedRawTransaction`](../type-aliases/DecodedRawTransaction.md)&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`decodeRawTransaction`](../interfaces/IBitcoinRpc.md#decoderawtransaction)

***

### decodeScript()

> **decodeScript**(`hexstring`): `Promise`&lt;[`ScriptDecoded`](../type-aliases/ScriptDecoded.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:344](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L344)

TODO: Comments

#### Parameters

##### hexstring

`string`

#### Returns

`Promise`&lt;[`ScriptDecoded`](../type-aliases/ScriptDecoded.md)&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`decodeScript`](../interfaces/IBitcoinRpc.md#decodescript)

***

### deriveAddresses()

> **deriveAddresses**(`descriptor`, `range?`): `Promise`&lt;[`DerivedAddresses`](../type-aliases/DerivedAddresses.md)[]&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:616](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L616)

Derives one or more addresses corresponding to an output descriptor.
Examples of output descriptors are:
  pkh(\<pubkey\>)                                     P2PKH outputs for the given pubkey
  wpkh(\<pubkey\>)                                    Native segwit P2PKH outputs for the given pubkey
  sh(multi(\<n\>,\<pubkey\>,\<pubkey\>,...))              P2SH-multisig outputs for the given threshold and pubkeys
  raw(\<hex script\>)                                 Outputs whose output script equals the specified hex-encoded bytes
  tr(\<pubkey\>,multi_a(\<n\>,\<pubkey\>,\<pubkey\>,...))   P2TR-multisig outputs for the given threshold and pubkeys

In the above, \<pubkey\> either refers to a fixed public key in hexadecimal notation, or to an xpub/xprv optionally followed by one
or more path elements separated by "/", where "h" represents a hardened child key.

See [github.com/bitcoin/bitcoin/descriptors.md](https://github.com/bitcoin/bitcoin/blob/master/doc/descriptors.md)
for more information.

#### Parameters

##### descriptor

`string`

The descriptor.

##### range?

`number`[]

If descriptor is ranged, must specify end or [begin,end] to derive.

#### Returns

`Promise`&lt;[`DerivedAddresses`](../type-aliases/DerivedAddresses.md)[]&gt;

a list of derived addresses

#### Async

#### Example

```
const bitcoind = BitcoinRpc.connect()
const addresses = bitcoind.deriveAddresses("wpkh([d34db33f/84h/0h/0h]xpub6DJ2dN.../0/*)#cjjspncu", [0,2])
```

***

### disconnectNode()

> **disconnectNode**(`address?`, `nodeid?`): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:845](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L845)

Disconnects a node by address or node ID.

#### Parameters

##### address?

`string`

##### nodeid?

`number`

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`disconnectNode`](../interfaces/IBitcoinRpc.md#disconnectnode)

***

### dumpPrivKey()

> **dumpPrivKey**(`address`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:849](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L849)

Reveals the private key corresponding to an address.

#### Parameters

##### address

`string`

#### Returns

`Promise`&lt;`string`&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`dumpPrivKey`](../interfaces/IBitcoinRpc.md#dumpprivkey)

***

### dumpWallet()

> **dumpWallet**(`filename`): `Promise`&lt;\{ `filename`: `string`; \}&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:853](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L853)

Dumps all wallet keys and metadata to a file.

#### Parameters

##### filename

`string`

#### Returns

`Promise`&lt;\{ `filename`: `string`; \}&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`dumpWallet`](../interfaces/IBitcoinRpc.md#dumpwallet)

***

### encryptWallet()

> **encryptWallet**(`passphrase`): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:857](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L857)

Encrypts the wallet with a passphrase.

#### Parameters

##### passphrase

`string`

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`encryptWallet`](../interfaces/IBitcoinRpc.md#encryptwallet)

***

### estimateSmartFee()

> **estimateSmartFee**(`conf_target`, `estimate_mode?`): `Promise`&lt;\{ `blocks?`: `number`; `errors?`: `string`[]; `feerate?`: `number`; \}&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:861](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L861)

Estimates the fee rate for a given confirmation target.

#### Parameters

##### conf\_target

`number`

##### estimate\_mode?

[`FeeEstimateMode`](../type-aliases/FeeEstimateMode.md)

#### Returns

`Promise`&lt;\{ `blocks?`: `number`; `errors?`: `string`[]; `feerate?`: `number`; \}&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`estimateSmartFee`](../interfaces/IBitcoinRpc.md#estimatesmartfee)

***

### fundRawTransaction()

> **fundRawTransaction**(`hexstring`, `options`): `Promise`&lt;[`FundRawTxResult`](../type-aliases/FundRawTxResult.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:446](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L446)

TODO: Comments

#### Parameters

##### hexstring

`string`

##### options

[`FundRawTxOptions`](../type-aliases/FundRawTxOptions.md)

#### Returns

`Promise`&lt;[`FundRawTxResult`](../type-aliases/FundRawTxResult.md)&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`fundRawTransaction`](../interfaces/IBitcoinRpc.md#fundrawtransaction)

***

### getBalance()

> **getBalance**(): `Promise`&lt;`any`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:646](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L646)

TODO: Comments

#### Returns

`Promise`&lt;`any`&gt;

***

### getBestBlockHash()

> **getBestBlockHash**(): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:351](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L351)

TODO: Comments

#### Returns

`Promise`&lt;`string`&gt;

***

### getBlock()

> **getBlock**(`params`): `Promise`&lt;`undefined` \| [`BlockResponse`](../type-aliases/BlockResponse.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:364](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L364)

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

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`getBlock`](../interfaces/IBitcoinRpc.md#getblock)

***

### getBlockByHash()

> **getBlockByHash**(`hash`, `options?`): `Promise`&lt;[`BlockHeader`](../type-aliases/BlockHeader.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:281](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L281)

Alias for `getblock <hash> 2`

#### Parameters

##### hash

`string`

##### options?

[`BlockHashOptions`](../interfaces/BlockHashOptions.md)

#### Returns

`Promise`&lt;[`BlockHeader`](../type-aliases/BlockHeader.md)&gt;

***

### getBlockchainInfo()

> **getBlockchainInfo**(): `Promise`&lt;[`ChainInfo`](../type-aliases/ChainInfo.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:418](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L418)

TODO: Comments

#### Returns

`Promise`&lt;[`ChainInfo`](../type-aliases/ChainInfo.md)&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`getBlockchainInfo`](../interfaces/IBitcoinRpc.md#getblockchaininfo)

***

### getBlockCount()

> **getBlockCount**(): `Promise`&lt;`number`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:397](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L397)

Returns the blockheight of the most-work fully-validated chain. The genesis block has height 0.

#### Returns

`Promise`&lt;`number`&gt;

The number of the blockheight with the most-work of the fully-validated chain.

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`getBlockCount`](../interfaces/IBitcoinRpc.md#getblockcount)

***

### getBlockHash()

> **getBlockHash**(`height`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:404](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L404)

Returns the blockhash of the block at the given height in the active chain.

#### Parameters

##### height

`number`

#### Returns

`Promise`&lt;`string`&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`getBlockHash`](../interfaces/IBitcoinRpc.md#getblockhash)

***

### getBlockHeader()

> **getBlockHeader**(`hash`, `verbose?`): `Promise`&lt;`string` \| [`BlockHeader`](../type-aliases/BlockHeader.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:411](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L411)

TODO: Comments

#### Parameters

##### hash

`string`

##### verbose?

`boolean`

#### Returns

`Promise`&lt;`string` \| [`BlockHeader`](../type-aliases/BlockHeader.md)&gt;

***

### getBlockHeadersByHash()

> **getBlockHeadersByHash**(`hash`, `count`, `options?`): `Promise`&lt;[`BlockHeader`](../type-aliases/BlockHeader.md)[]&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:260](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L260)

TODO: Comments

#### Parameters

##### hash

`string`

##### count

`number`

##### options?

[`ReturnFormatOptions`](../interfaces/ReturnFormatOptions.md)

#### Returns

`Promise`&lt;[`BlockHeader`](../type-aliases/BlockHeader.md)[]&gt;

***

### getConnectionCount()

> **getConnectionCount**(): `Promise`&lt;`number`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:865](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L865)

Gets the number of active connections to other nodes.

#### Returns

`Promise`&lt;`number`&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`getConnectionCount`](../interfaces/IBitcoinRpc.md#getconnectioncount)

***

### getDescriptorInfo()

> **getDescriptorInfo**(`descriptor`): `Promise`&lt;`any`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:567](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L567)

TODO: Comments

#### Parameters

##### descriptor

`string`

#### Returns

`Promise`&lt;`any`&gt;

***

### getDifficulty()

> **getDifficulty**(): `Promise`&lt;`number`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:869](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L869)

Gets the estimated network difficulty.

#### Returns

`Promise`&lt;`number`&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`getDifficulty`](../interfaces/IBitcoinRpc.md#getdifficulty)

***

### getInfo()

> **getInfo**(...`args`): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:425](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L425)

TODO: Comments

#### Parameters

##### args

...`any`[]

#### Returns

`Promise`&lt;`void`&gt;

***

### getMemoryInfo()

> **getMemoryInfo**(`mode?`): `Promise`&lt;`string` \| [`MemoryStats`](../type-aliases/MemoryStats.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:432](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L432)

TODO: Comments

#### Parameters

##### mode?

`"stats"` | `"mallocinfo"`

#### Returns

`Promise`&lt;`string` \| [`MemoryStats`](../type-aliases/MemoryStats.md)&gt;

***

### getMemoryPoolContent()

> **getMemoryPoolContent**(): `Promise`&lt;[`MempoolContent`](../type-aliases/MempoolContent.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:267](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L267)

TODO: Comments

#### Returns

`Promise`&lt;[`MempoolContent`](../type-aliases/MempoolContent.md)&gt;

***

### getMemoryPoolInformation()

> **getMemoryPoolInformation**(): `Promise`&lt;[`MempoolInfo`](../type-aliases/MempoolInfo.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:274](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L274)

TODO: Comments

#### Returns

`Promise`&lt;[`MempoolInfo`](../type-aliases/MempoolInfo.md)&gt;

***

### getMempoolInfo()

> **getMempoolInfo**(): `Promise`&lt;[`MempoolInfo`](../type-aliases/MempoolInfo.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:873](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L873)

Retrieves memory pool statistics.

#### Returns

`Promise`&lt;[`MempoolInfo`](../type-aliases/MempoolInfo.md)&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`getMempoolInfo`](../interfaces/IBitcoinRpc.md#getmempoolinfo)

***

### getMiningInfo()

> **getMiningInfo**(): `Promise`&lt;[`MiningInfo`](../type-aliases/MiningInfo.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:877](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L877)

Retrieves mining statistics.

#### Returns

`Promise`&lt;[`MiningInfo`](../type-aliases/MiningInfo.md)&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`getMiningInfo`](../interfaces/IBitcoinRpc.md#getmininginfo)

***

### getNewAddress()

> **getNewAddress**(`account?`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:653](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L653)

TODO: Comments

#### Parameters

##### account?

`string`

#### Returns

`Promise`&lt;`string`&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`getNewAddress`](../interfaces/IBitcoinRpc.md#getnewaddress)

***

### getPeerInfo()

> **getPeerInfo**(): `Promise`&lt;[`PeerInfo`](../type-aliases/PeerInfo.md)[]&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:881](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L881)

Gets detailed peer connection information.

#### Returns

`Promise`&lt;[`PeerInfo`](../type-aliases/PeerInfo.md)[]&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`getPeerInfo`](../interfaces/IBitcoinRpc.md#getpeerinfo)

***

### getRawTransaction()

> **getRawTransaction**(`txid`, `verbosity?`, `blockhash?`): `Promise`&lt;[`RawTransactionResponse`](../type-aliases/RawTransactionResponse.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:809](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L809)

Get detailed information about a transaction.

By default, this call only returns a transaction if it is in the mempool. If -txindex is enabled
and no blockhash argument is passed, it will return the transaction if it is in the mempool or any block.
If a blockhash argument is passed, it will return the transaction if the specified block is available and
the transaction is in that block.

#### Parameters

##### txid

`string`

The transaction id (required).

##### verbosity?

[`VerbosityLevel`](../enumerations/VerbosityLevel.md)

Response format: 0 (hex), 1 (json) or 2 (jsonext).

##### blockhash?

`string`

The block in which to look for the transaction (optional).

#### Returns

`Promise`&lt;[`RawTransactionResponse`](../type-aliases/RawTransactionResponse.md)&gt;

A promise resolving to data about a transaction in the form specified by verbosity.

#### Async

***

### getRawTransactions()

> **getRawTransactions**(`txids`, `verbosity?`): `Promise`&lt;[`RawTransactionResponse`](../type-aliases/RawTransactionResponse.md)[]&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:833](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L833)

Get detailed information about multiple transactions. An extension of [getRawTransaction](#getrawtransaction).

#### Parameters

##### txids

`string`[]

An array of transaction ids.

##### verbosity?

[`VerbosityLevel`](../enumerations/VerbosityLevel.md)

Response format: 0 (hex), 1 (json) or 2 (jsonext).

#### Returns

`Promise`&lt;[`RawTransactionResponse`](../type-aliases/RawTransactionResponse.md)[]&gt;

#### Async

***

### getTransaction()

> **getTransaction**(`txid`, `include_watchonly?`): `Promise`&lt;[`WalletTransaction`](../type-aliases/WalletTransaction.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:792](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L792)

Get detailed information about in-wallet transaction \<txid\>.

#### Parameters

##### txid

`string`

##### include\_watchonly?

`boolean`

Whether to include watch-only addresses in balance calculation and details.

#### Returns

`Promise`&lt;[`WalletTransaction`](../type-aliases/WalletTransaction.md)&gt;

A promise resolving to a [WalletTransaction](../type-aliases/WalletTransaction.md) object.

***

### getTransactionByHash()

> **getTransactionByHash**(`hash`, `options?`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:253](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L253)

TODO: Comments

#### Parameters

##### hash

`string`

##### options?

[`ReturnFormatOptions`](../interfaces/ReturnFormatOptions.md)

#### Returns

`Promise`&lt;`string`&gt;

***

### getUnspentTransactionOutputs()

> **getUnspentTransactionOutputs**(`outpoints`): `Promise`&lt;[`GetUTXOsResult`](../type-aliases/GetUTXOsResult.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:246](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L246)

TODO: Comments

#### Parameters

##### outpoints

[`Outpoint`](../type-aliases/Outpoint.md)[]

#### Returns

`Promise`&lt;[`GetUTXOsResult`](../type-aliases/GetUTXOsResult.md)&gt;

***

### importAddress()

> **importAddress**(`script`, `label?`, `rescan?`, `p2sh?`): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:660](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L660)

TODO: Comments

#### Parameters

##### script

`string`

##### label?

`string`

##### rescan?

`boolean`

##### p2sh?

`boolean`

#### Returns

`Promise`&lt;`void`&gt;

***

### importDescriptors()

> **importDescriptors**(`requests`): `Promise`&lt;`any`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:677](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L677)

Import descriptors.

This will trigger a rescan of the blockchain based on the earliest timestamp of all descriptors being imported.
Requires a new wallet backup. Note: This call can take over an hour to complete if using an early timestamp;
during that time, other rpc calls may report that the imported keys, addresses or scripts exist but related
transactions are still missing. The rescan is significantly faster if block filters are available
(using startup option "-blockfilterindex=1").

#### Parameters

##### requests

[`ImportDescriptorRequest`](../type-aliases/ImportDescriptorRequest.md)[]

Array of [ImportDescriptorRequest](../type-aliases/ImportDescriptorRequest.md) objects to be imported

#### Returns

`Promise`&lt;`any`&gt;

Array of [ImportDescriptorResult](../type-aliases/ImportDescriptorResult.md) objects

***

### importMulti()

> **importMulti**(`requests`, `options?`): `Promise`&lt;[`ImportMultiResult`](../type-aliases/ImportMultiResult.md)[]&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:684](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L684)

TODO: Comments

#### Parameters

##### requests

[`ImportMultiRequest`](../type-aliases/ImportMultiRequest.md)[]

##### options?

[`ImportMultiOptions`](../type-aliases/ImportMultiOptions.md)

#### Returns

`Promise`&lt;[`ImportMultiResult`](../type-aliases/ImportMultiResult.md)[]&gt;

***

### isJsonRpcError()

> **isJsonRpcError**(`e`): `e is Error & { code?: number; name: "RpcError" }`

Defined in: [packages/bitcoin/src/rpc-client.ts:179](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L179)

Check if the given error is a JSON-RPC error.

#### Parameters

##### e

`unknown`

The error to check.

#### Returns

`e is Error & { code?: number; name: "RpcError" }`

True if the error is a JSON-RPC error, false otherwise.

***

### listTransactions()

> **listTransactions**(`params`): `Promise`&lt;[`ListTransactionsResult`](../type-aliases/ListTransactionsResult.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:507](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L507)

TODO: Comments

#### Parameters

##### params

[`ListTransactionsParams`](../type-aliases/ListTransactionsParams.md)

#### Returns

`Promise`&lt;[`ListTransactionsResult`](../type-aliases/ListTransactionsResult.md)&gt;

***

### listUnspent()

> **listUnspent**(`params`): `Promise`&lt;[`UnspentTxInfo`](../type-aliases/UnspentTxInfo.md)[]&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:691](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L691)

TODO: Comments

#### Parameters

##### params

[`ListUnspentParams`](../type-aliases/ListUnspentParams.md)

#### Returns

`Promise`&lt;[`UnspentTxInfo`](../type-aliases/UnspentTxInfo.md)[]&gt;

***

### rescanBlockchain()

> **rescanBlockchain**(): `Promise`&lt;`any`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:698](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L698)

TODO: Comments

#### Returns

`Promise`&lt;`any`&gt;

***

### scanBlocks()

> **scanBlocks**(`params`): `Promise`&lt;`any`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:439](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L439)

TODO: Comments

#### Parameters

##### params

[`ScanBlocksParams`](../type-aliases/ScanBlocksParams.md)

#### Returns

`Promise`&lt;`any`&gt;

***

### send()

> **send**(): `Promise`&lt;`any`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:731](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L731)

TODO: Comments

#### Returns

`Promise`&lt;`any`&gt;

***

### sendAll()

> **sendAll**(`params`): `Promise`&lt;[`SendAllResult`](../type-aliases/SendAllResult.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:775](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L775)

#### Parameters

##### params

[`SendAllParams`](../type-aliases/SendAllParams.md)

The parameters for the sendAll command.

#### Returns

`Promise`&lt;[`SendAllResult`](../type-aliases/SendAllResult.md)&gt;

A promise resolving to a [SendAllResult](../type-aliases/SendAllResult.md) object

#### Warning

EXPERIMENTAL this call may be changed in future releases.

Spend the value of all (or specific) confirmed UTXOs & unconfirmed change in the wallet to one or
more recipients. Unconfirmed inbound UTXOs and locked UTXOs will not be spent. Sendall will respect the
avoid_reuse wallet flag. If your wallet contains many small inputs, either because it received tiny payments or as
a result of accumulating change, consider using `send_max` to exclude inputs that are worth less than the fees
needed to spend them.

#### Example

```ts
Spend all UTXOs from the wallet with a fee rate of 1 sat/vB using named arguments
const bob = BitcoinRpc.connect({
   username: 'bob',
   password: 'bobpass',
   host: 'http://127.0.0.1:18443',
   allowDefaultWallet: true,
   version: '28.1.0'
});
const sendall = await bob.sendAll({
   recipients: [
     'bc1q09vm5lfy0j5reeulh4x5752q25uqqvz34hufdl',
     'bc1q02ad21edsxd23d32dfgqqsz4vv4nmtfzuklhy3'
   ],
    options: { fee_rate: 1.1 }
});
```

***

### sendMany()

> **sendMany**(`params`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:782](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L782)

TODO: Comments

#### Parameters

##### params

[`SendManyParams`](../type-aliases/SendManyParams.md)

#### Returns

`Promise`&lt;`string`&gt;

***

### sendRawTransaction()

> **sendRawTransaction**(`hexstring`, `maxfeerate?`, `maxBurnAmount?`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:472](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L472)

Submit a raw transaction (serialized, hex-encoded) to local node and network.

The transaction will be sent unconditionally to all peers, so using sendrawtransaction
for manual rebroadcast may degrade privacy by leaking the transaction's origin, as
nodes will normally not rebroadcast non-wallet transactions already in their mempool.

#### Parameters

##### hexstring

`string`

The hex-encoded transaction to send.

##### maxfeerate?

If not passed, default is 0.10.

`string` | `number`

##### maxBurnAmount?

`string` | `number`

#### Returns

`Promise`&lt;`string`&gt;

A promise resolving to the transaction hash in hex.

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`sendRawTransaction`](../interfaces/IBitcoinRpc.md#sendrawtransaction)

***

### sendToAddress()

> **sendToAddress**(`address`, `amount`): `Promise`&lt;[`RawTransactionV2`](../interfaces/RawTransactionV2.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:709](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L709)

Send an amount to a given address.

#### Parameters

##### address

`string`

The address to send to.

##### amount

`number`

The amount to send in BTC.

#### Returns

`Promise`&lt;[`RawTransactionV2`](../interfaces/RawTransactionV2.md)&gt;

A promise resolving to the transaction id.

#### Async

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`sendToAddress`](../interfaces/IBitcoinRpc.md#sendtoaddress)

***

### signAndSendRawTransaction()

> **signAndSendRawTransaction**(`hexstring`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:486](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L486)

Combines calls to `signRawTransaction` and `sendRawTransaction`.

#### Parameters

##### hexstring

`string`

#### Returns

`Promise`&lt;`string`&gt;

A promise resolving to the transaction hash in hex.

***

### signMessage()

> **signMessage**(): `Promise`&lt;`any`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:717](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L717)

TODO: Comments

#### Returns

`Promise`&lt;`any`&gt;

***

### signMessageWithPrivkey()

> **signMessageWithPrivkey**(`privkey`, `message`): `Promise`&lt;[`BitcoinSignature`](../type-aliases/BitcoinSignature.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:574](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L574)

TODO: Comments

#### Parameters

##### privkey

`string`

##### message

`string`

#### Returns

`Promise`&lt;[`BitcoinSignature`](../type-aliases/BitcoinSignature.md)&gt;

***

### signRawTransaction()

> **signRawTransaction**(`hexstring`): `Promise`&lt;[`SignedRawTx`](../type-aliases/SignedRawTx.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:457](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L457)

Sign inputs for raw transaction (serialized, hex-encoded).
The second optional argument (may be null) is an array of previous transaction outputs that
this transaction depends on but may not yet be in the block chain.
Requires wallet passphrase to be set with walletpassphrase call if wallet is encrypted.

#### Parameters

##### hexstring

`string`

The hex-encoded transaction to send.

#### Returns

`Promise`&lt;[`SignedRawTx`](../type-aliases/SignedRawTx.md)&gt;

***

### signRawTransactionWithWallet()

> **signRawTransactionWithWallet**(): `Promise`&lt;`any`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:724](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L724)

TODO: Comments

#### Returns

`Promise`&lt;`any`&gt;

***

### validateAddress()

> **validateAddress**(`address`): `Promise`&lt;[`ValidateAddressResult`](../type-aliases/ValidateAddressResult.md)&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:581](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L581)

TODO: Comments

#### Parameters

##### address

`string`

#### Returns

`Promise`&lt;[`ValidateAddressResult`](../type-aliases/ValidateAddressResult.md)&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`validateAddress`](../interfaces/IBitcoinRpc.md#validateaddress)

***

### verifyMessage()

> **verifyMessage**(`address`, `signature`, `message`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:588](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L588)

TODO: Comments

#### Parameters

##### address

`string`

##### signature

`string`

##### message

`string`

#### Returns

`Promise`&lt;`boolean`&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`verifyMessage`](../interfaces/IBitcoinRpc.md#verifymessage)

***

### walletLock()

> **walletLock**(`passphrase`, `timeout`): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/rpc-client.ts:885](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L885)

Locks the wallet, requiring a passphrase to unlock.

#### Parameters

##### passphrase

`string`

##### timeout

`number`

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`IBitcoinRpc`](../interfaces/IBitcoinRpc.md).[`walletLock`](../interfaces/IBitcoinRpc.md#walletlock)

***

### connect()

> `static` **connect**(`config?`): `BitcoinRpc`

Defined in: [packages/bitcoin/src/rpc-client.ts:169](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L169)

Static method connects to a bitcoin node running the bitcoin core daemon (bitcoind).
To use default polar config, do not pass a config. See [DEFAULT\_RPC\_CLIENT\_CONFIG](../variables/DEFAULT_RPC_CLIENT_CONFIG.md) for default config.

#### Parameters

##### config?

[`RpcClientConfig`](RpcClientConfig.md)

The configuration object for the client (optional).

#### Returns

`BitcoinRpc`

A new BitcoinRpc instance.

#### Required

A locally running [Polar Lightning](https://github.com/jamaljsr/polar) regtest node.

#### Example

```
const alice = BitcoinRpc.connect();
```

***

### initialize()

> `static` **initialize**(`config?`): `Client`

Defined in: [packages/bitcoin/src/rpc-client.ts:152](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rpc-client.ts#L152)

Static method initializes a new BitcoinRpc client with the given configuration.
The RpcClient returned by this method does not have any named methods.
Use this method to create and pass a new RpcClient instance to a BitcoinRpc constructor.

#### Parameters

##### config?

[`IClientConfig`](../interfaces/IClientConfig.md)

The configuration object for the client (optional).

#### Returns

`Client`

A new RpcClient instance.

#### Example

```
const options: IClientConfig = {
    host: 'http://localhost:18443',
    username: 'alice',
    password: 'alicepass',
    version: '28.1.0',
}
const aliceClient = BitcoinRpc.initialize(options); // Client config required
const alice = new BitcoinRpc(aliceClient);
```
