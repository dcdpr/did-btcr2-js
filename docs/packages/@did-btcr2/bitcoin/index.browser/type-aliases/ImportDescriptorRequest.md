# Type Alias: ImportDescriptorRequest

> **ImportDescriptorRequest** = `object`

Defined in: [packages/bitcoin/src/types.ts:625](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L625)

## Properties

### active?

> `optional` **active**: `boolean`

Defined in: [packages/bitcoin/src/types.ts:637](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L637)

(boolean, optional, default=false) Make descriptor "active" for corresponding output type/externality

***

### desc

> **desc**: `string`

Defined in: [packages/bitcoin/src/types.ts:627](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L627)

(string, required) Descriptor to import.

***

### internal?

> `optional` **internal**: `boolean`

Defined in: [packages/bitcoin/src/types.ts:643](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L643)

(boolean, optional, default=false) Whether matching outputs should be treated as not incoming payments (e.g. change)

***

### label?

> `optional` **label**: `string`

Defined in: [packages/bitcoin/src/types.ts:645](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L645)

(string, optional, default="") Label to assign to the address, only allowed with internal=false. Disabled for ranged descriptors

***

### next\_index?

> `optional` **next\_index**: `number`

Defined in: [packages/bitcoin/src/types.ts:641](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L641)

(numeric, optional) If a ranged descriptor is set to active, this specifies the next index to generate addresses from

***

### range?

> `optional` **range**: `number` \| `number`[]

Defined in: [packages/bitcoin/src/types.ts:639](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L639)

(numeric or array, optional) If a ranged descriptor is used, this specifies the end or the range (in the form [begin,end]) to import

***

### timestamp

> **timestamp**: `number` \| `string`

Defined in: [packages/bitcoin/src/types.ts:635](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L635)

(integer / string, required) Time from which to start rescanning the blockchain for this descriptor, in UNIX epoch time
Use the string "now" to substitute the current synced blockchain time.
"now" can be specified to bypass scanning, for outputs which are known to never have been used, and
0 can be specified to scan the entire blockchain. Blocks up to 2 hours before the earliest timestamp
of all descriptors being imported will be scanned as well as the mempool.
