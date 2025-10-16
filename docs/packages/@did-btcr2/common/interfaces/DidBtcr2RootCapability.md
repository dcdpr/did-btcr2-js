# Interface: DidBtcr2RootCapability

Defined in: [packages/common/src/interfaces.ts:306](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L306)

A ZCAP-LD root capability object that authorizes updates for a particular did:btcr2.

DID BTCR2
[9.4.1 Derive Root Capability from did:btcr2 Identifier](https://dcdpr.github.io/did-btcr2/#derive-root-capability-from-didbtcr2-identifier).

## Example

```
{
  "@context": "https://w3id.org/zcap/v1",
  "id": "urn:zcap:root:did%3Abtcr2%3Ak1qq...",
  "controller": "did:btcr2:k1qq...",
  "invocationTarget": "did:btcr2:k1qq..."
}
```

## Properties

### @context

> **@context**: `string` \| `string`[]

Defined in: [packages/common/src/interfaces.ts:307](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L307)

***

### controller

> **controller**: `string`

Defined in: [packages/common/src/interfaces.ts:309](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L309)

***

### id

> **id**: `string`

Defined in: [packages/common/src/interfaces.ts:308](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L308)

***

### invocationTarget

> **invocationTarget**: `string`

Defined in: [packages/common/src/interfaces.ts:310](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L310)
