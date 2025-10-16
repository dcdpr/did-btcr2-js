# Interface: IBitcoinRpc

Defined in: [packages/bitcoin/src/interface.ts:28](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L28)

Interface for the Bitcoin Core RPC client.

## Methods

### abandonTransaction()

> **abandonTransaction**(`txid`): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/interface.ts:33](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L33)

Marks a transaction and its in-wallet descendants as abandoned, allowing their inputs to be respent.

#### Parameters

##### txid

`string`

#### Returns

`Promise`&lt;`void`&gt;

***

### abortRescan()

> **abortRescan**(): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/interface.ts:36](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L36)

Stops the current wallet rescan triggered by an RPC call, such as by an importprivkey call.

#### Returns

`Promise`&lt;`void`&gt;

***

### addMultiSigAddress()

> **addMultiSigAddress**(`__namedParameters`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/interface.ts:39](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L39)

Adds a multi-signature address with n required signatures and a set of keys.

#### Parameters

##### \_\_namedParameters

[`AddMultiSigAddressParams`](../type-aliases/AddMultiSigAddressParams.md)

#### Returns

`Promise`&lt;`string`&gt;

***

### addWitnessAddress()

> **addWitnessAddress**(`address`): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/interface.ts:42](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L42)

Adds a witness address for SegWit compatibility.

#### Parameters

##### address

`string`

#### Returns

`Promise`&lt;`void`&gt;

***

### backupWallet()

> **backupWallet**(`destination`): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/interface.ts:45](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L45)

Backs up the wallet file to a specified destination.

#### Parameters

##### destination

`string`

#### Returns

`Promise`&lt;`void`&gt;

***

### bumpFee()

> **bumpFee**(`txid`, `options?`): `Promise`&lt;[`BumpFeeResult`](../type-aliases/BumpFeeResult.md)&gt;

Defined in: [packages/bitcoin/src/interface.ts:48](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L48)

Increases the fee of an unconfirmed transaction to improve its confirmation time.

#### Parameters

##### txid

`string`

##### options?

[`BumpFeeOption`](../type-aliases/BumpFeeOption.md)

#### Returns

`Promise`&lt;[`BumpFeeResult`](../type-aliases/BumpFeeResult.md)&gt;

***

### clearBanned()

> **clearBanned**(): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/interface.ts:51](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L51)

Removes all banned nodes from the ban list.

#### Returns

`Promise`&lt;`void`&gt;

***

### combineRawTransaction()

> **combineRawTransaction**(`txs`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/interface.ts:54](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L54)

Combines multiple raw transactions into a single transaction.

#### Parameters

##### txs

`string`[]

#### Returns

`Promise`&lt;`string`&gt;

***

### command()?

> `optional` **command**&lt;`R`&gt;(`methods`): `Promise`&lt;readonly `R`[]&gt;

Defined in: [packages/bitcoin/src/interface.ts:30](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L30)

Executes multiple commands in a batch request.

#### Type Parameters

##### R

`R` *extends* `unknown`

#### Parameters

##### methods

[`BatchOption`](../type-aliases/BatchOption.md)[]

#### Returns

`Promise`&lt;readonly `R`[]&gt;

***

### createMultiSig()

> **createMultiSig**(`nrequired`, `keys`): `Promise`&lt;[`CreateMultiSigResult`](../type-aliases/CreateMultiSigResult-1.md)&gt;

Defined in: [packages/bitcoin/src/interface.ts:57](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L57)

Creates a multi-signature address with n required signatures and a set of keys.

#### Parameters

##### nrequired

`number`

##### keys

`string`[]

#### Returns

`Promise`&lt;[`CreateMultiSigResult`](../type-aliases/CreateMultiSigResult-1.md)&gt;

***

### createRawTransaction()

> **createRawTransaction**(`inputs`, `outputs`, `locktime?`, `replacable?`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/interface.ts:60](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L60)

Creates a raw transaction spending specified inputs to specified outputs.

#### Parameters

##### inputs

[`CreateRawTxInputs`](../type-aliases/CreateRawTxInputs.md)[]

##### outputs

[`CreateRawTxOutputs`](../type-aliases/CreateRawTxOutputs.md)[]

##### locktime?

`number`

##### replacable?

`boolean`

#### Returns

`Promise`&lt;`string`&gt;

***

### createWallet()

> **createWallet**(`__namedParameters`): `Promise`&lt;[`CreateWalletResult`](../type-aliases/CreateWalletResult.md)&gt;

Defined in: [packages/bitcoin/src/interface.ts:63](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L63)

Creates a new wallet with various optional parameters.

#### Parameters

##### \_\_namedParameters

[`CreateWalletParams`](../type-aliases/CreateWalletParams.md)

#### Returns

`Promise`&lt;[`CreateWalletResult`](../type-aliases/CreateWalletResult.md)&gt;

***

### decodeRawTransaction()

> **decodeRawTransaction**(`hexstring`): `Promise`&lt;[`DecodedRawTransaction`](../type-aliases/DecodedRawTransaction.md)&gt;

Defined in: [packages/bitcoin/src/interface.ts:74](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L74)

Decodes a raw transaction hex string.

#### Parameters

##### hexstring

`string`

#### Returns

`Promise`&lt;[`DecodedRawTransaction`](../type-aliases/DecodedRawTransaction.md)&gt;

***

### decodeScript()

> **decodeScript**(`hexstring`): `Promise`&lt;[`ScriptDecoded`](../type-aliases/ScriptDecoded.md)&gt;

Defined in: [packages/bitcoin/src/interface.ts:77](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L77)

Decodes a hex-encoded script.

#### Parameters

##### hexstring

`string`

#### Returns

`Promise`&lt;[`ScriptDecoded`](../type-aliases/ScriptDecoded.md)&gt;

***

### disconnectNode()

> **disconnectNode**(`address?`, `nodeid?`): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/interface.ts:80](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L80)

Disconnects a node by address or node ID.

#### Parameters

##### address?

`string`

##### nodeid?

`number`

#### Returns

`Promise`&lt;`void`&gt;

***

### dumpPrivKey()

> **dumpPrivKey**(`address`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/interface.ts:83](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L83)

Reveals the private key corresponding to an address.

#### Parameters

##### address

`string`

#### Returns

`Promise`&lt;`string`&gt;

***

### dumpWallet()

> **dumpWallet**(`filename`): `Promise`&lt;\{ `filename`: `string`; \}&gt;

Defined in: [packages/bitcoin/src/interface.ts:86](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L86)

Dumps all wallet keys and metadata to a file.

#### Parameters

##### filename

`string`

#### Returns

`Promise`&lt;\{ `filename`: `string`; \}&gt;

***

### encryptWallet()

> **encryptWallet**(`passphrase`): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/interface.ts:89](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L89)

Encrypts the wallet with a passphrase.

#### Parameters

##### passphrase

`string`

#### Returns

`Promise`&lt;`void`&gt;

***

### estimateSmartFee()

> **estimateSmartFee**(`conf_target`, `estimate_mode?`): `Promise`&lt;\{ `blocks?`: `number`; `errors?`: `string`[]; `feerate?`: `number`; \}&gt;

Defined in: [packages/bitcoin/src/interface.ts:92](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L92)

Estimates the fee rate for a given confirmation target.

#### Parameters

##### conf\_target

`number`

##### estimate\_mode?

[`FeeEstimateMode`](../type-aliases/FeeEstimateMode.md)

#### Returns

`Promise`&lt;\{ `blocks?`: `number`; `errors?`: `string`[]; `feerate?`: `number`; \}&gt;

***

### fundRawTransaction()

> **fundRawTransaction**(`hexstring`, `options`): `Promise`&lt;\{ `changepos`: `number`; `fee`: `number`; `hex`: `string`; \}&gt;

Defined in: [packages/bitcoin/src/interface.ts:98](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L98)

Funds a raw transaction by adding necessary inputs and change.

#### Parameters

##### hexstring

`string`

##### options

[`FundRawTxOptions`](../type-aliases/FundRawTxOptions.md)

#### Returns

`Promise`&lt;\{ `changepos`: `number`; `fee`: `number`; `hex`: `string`; \}&gt;

***

### getBlock()

> **getBlock**(`__namedParameters`): `Promise`&lt;`undefined` \| [`BlockResponse`](../type-aliases/BlockResponse.md)&gt;

Defined in: [packages/bitcoin/src/interface.ts:110](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L110)

Gets detailed information about a specific block.

#### Parameters

##### \_\_namedParameters

[`GetBlockParams`](GetBlockParams.md)

#### Returns

`Promise`&lt;`undefined` \| [`BlockResponse`](../type-aliases/BlockResponse.md)&gt;

***

### getBlockchainInfo()

> **getBlockchainInfo**(): `Promise`&lt;[`ChainInfo`](../type-aliases/ChainInfo.md)&gt;

Defined in: [packages/bitcoin/src/interface.ts:113](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L113)

Retrieves general blockchain state info.

#### Returns

`Promise`&lt;[`ChainInfo`](../type-aliases/ChainInfo.md)&gt;

***

### getBlockCount()

> **getBlockCount**(): `Promise`&lt;`number`&gt;

Defined in: [packages/bitcoin/src/interface.ts:104](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L104)

Returns the number of blocks in the longest blockchain.

#### Returns

`Promise`&lt;`number`&gt;

***

### getBlockHash()

> **getBlockHash**(`height`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/interface.ts:107](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L107)

Gets the hash of a block at a given height.

#### Parameters

##### height

`number`

#### Returns

`Promise`&lt;`string`&gt;

***

### getConnectionCount()

> **getConnectionCount**(): `Promise`&lt;`number`&gt;

Defined in: [packages/bitcoin/src/interface.ts:116](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L116)

Gets the number of active connections to other nodes.

#### Returns

`Promise`&lt;`number`&gt;

***

### getDifficulty()

> **getDifficulty**(): `Promise`&lt;`number`&gt;

Defined in: [packages/bitcoin/src/interface.ts:119](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L119)

Gets the estimated network difficulty.

#### Returns

`Promise`&lt;`number`&gt;

***

### getMempoolInfo()

> **getMempoolInfo**(): `Promise`&lt;[`MempoolInfo`](../type-aliases/MempoolInfo.md)&gt;

Defined in: [packages/bitcoin/src/interface.ts:122](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L122)

Retrieves memory pool statistics.

#### Returns

`Promise`&lt;[`MempoolInfo`](../type-aliases/MempoolInfo.md)&gt;

***

### getMiningInfo()

> **getMiningInfo**(): `Promise`&lt;[`MiningInfo`](../type-aliases/MiningInfo.md)&gt;

Defined in: [packages/bitcoin/src/interface.ts:125](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L125)

Retrieves mining statistics.

#### Returns

`Promise`&lt;[`MiningInfo`](../type-aliases/MiningInfo.md)&gt;

***

### getNewAddress()

> **getNewAddress**(`account?`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/interface.ts:128](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L128)

Gets a new Bitcoin address for receiving payments.

#### Parameters

##### account?

`string`

#### Returns

`Promise`&lt;`string`&gt;

***

### getPeerInfo()

> **getPeerInfo**(): `Promise`&lt;[`PeerInfo`](../type-aliases/PeerInfo.md)[]&gt;

Defined in: [packages/bitcoin/src/interface.ts:131](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L131)

Gets detailed peer connection information.

#### Returns

`Promise`&lt;[`PeerInfo`](../type-aliases/PeerInfo.md)[]&gt;

***

### sendRawTransaction()

> **sendRawTransaction**(`hexstring`, `maxfeerate?`, `maxBurnAmount?`): `Promise`&lt;`string`&gt;

Defined in: [packages/bitcoin/src/interface.ts:134](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L134)

Sends raw transaction hex to the Bitcoin network.

#### Parameters

##### hexstring

`string`

##### maxfeerate?

`string` | `number`

##### maxBurnAmount?

`string` | `number`

#### Returns

`Promise`&lt;`string`&gt;

***

### sendToAddress()

> **sendToAddress**(`address`, `amount`, `comment?`, `comment_to?`, `subtreactfeefromamount?`, `replaceable?`, `conf_target?`, `estimate_mode?`): `Promise`&lt;[`RawTransactionResponse`](../type-aliases/RawTransactionResponse.md)&gt;

Defined in: [packages/bitcoin/src/interface.ts:141](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L141)

Sends bitcoins to a specified address.

#### Parameters

##### address

`string`

##### amount

`number`

##### comment?

`string`

##### comment\_to?

`string`

##### subtreactfeefromamount?

`boolean`

##### replaceable?

`boolean`

##### conf\_target?

`number`

##### estimate\_mode?

[`FeeEstimateMode`](../type-aliases/FeeEstimateMode.md)

#### Returns

`Promise`&lt;[`RawTransactionResponse`](../type-aliases/RawTransactionResponse.md)&gt;

***

### validateAddress()

> **validateAddress**(`address`): `Promise`&lt;[`ValidateAddressResult`](../type-aliases/ValidateAddressResult.md)&gt;

Defined in: [packages/bitcoin/src/interface.ts:153](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L153)

Validates a Bitcoin address.

#### Parameters

##### address

`string`

#### Returns

`Promise`&lt;[`ValidateAddressResult`](../type-aliases/ValidateAddressResult.md)&gt;

***

### verifyMessage()

> **verifyMessage**(`address`, `signature`, `message`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/bitcoin/src/interface.ts:156](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L156)

Verifies a signed message.

#### Parameters

##### address

`string`

##### signature

`string`

##### message

`string`

#### Returns

`Promise`&lt;`boolean`&gt;

***

### walletLock()

> **walletLock**(`passphrase`, `timeout`): `Promise`&lt;`void`&gt;

Defined in: [packages/bitcoin/src/interface.ts:159](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/interface.ts#L159)

Locks the wallet, requiring a passphrase to unlock.

#### Parameters

##### passphrase

`string`

##### timeout

`number`

#### Returns

`Promise`&lt;`void`&gt;
