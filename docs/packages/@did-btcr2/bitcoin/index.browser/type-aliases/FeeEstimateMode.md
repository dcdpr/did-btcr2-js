# Type Alias: FeeEstimateMode

> **FeeEstimateMode** = `"UNSET"` \| `"ECONOMICAL"` \| `"CONSERVATIVE"`

Defined in: [packages/bitcoin/src/types.ts:134](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L134)

unset
   - no mode set
economical
   - used if the transaction is replaceable
   - uses shorter time horizon to estimate
   - more responsive to short-term drops in the prevailing fee market
   - potentially returns a lower fee rate estimate
conservative
   - used is the transaction is not replaceable
   - use a longer time horizon to estimate
   - less responsive to short-term drops in the prevailing fee market
   - potentially returns a higher fee rate estimate
