# Enumeration: VerbosityLevel

Defined in: [packages/bitcoin/src/types.ts:1017](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L1017)

Defines verbosity levels for block and transaction outputs.
Used to specify the format of returned block or transaction data.
  VerbosityLevel for block and transaction outputs.

## Enumeration Members

### hex

> **hex**: `0`

Defined in: [packages/bitcoin/src/types.ts:1019](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L1019)

Return block or transaction data in raw hex-encoded format

***

### json

> **json**: `1`

Defined in: [packages/bitcoin/src/types.ts:1021](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L1021)

Return block or transaction data in JSON object format

***

### jsonext

> **jsonext**: `2`

Defined in: [packages/bitcoin/src/types.ts:1027](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L1027)

Return block or transaction data in JSON object format with additional information.
Returns block data with information about each transaction.
Returns transaction data with information about the transaction including fee and prevout information.

***

### jsonextprev

> **jsonextprev**: `3`

Defined in: [packages/bitcoin/src/types.ts:1032](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L1032)

Return block data in JSON object format with additional information.
Returns block data with information about each transaction, including prevout information for inputs.
