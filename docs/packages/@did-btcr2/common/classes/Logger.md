# Class: Logger

Defined in: [packages/common/src/logger.ts:55](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/logger.ts#L55)

A flexible, feature-rich logger with:
- Environment-based filtering
- Namespacing
- File/line tracing
- Timestamps
- Colorized output

## Constructors

### Constructor

> **new Logger**(`namespace?`): `Logger`

Defined in: [packages/common/src/logger.ts:59](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/logger.ts#L59)

#### Parameters

##### namespace?

`string`

#### Returns

`Logger`

## Methods

### debug()

> **debug**(`message?`, ...`args?`): `Logger`

Defined in: [packages/common/src/logger.ts:83](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/logger.ts#L83)

#### Parameters

##### message?

`unknown`

##### args?

...`unknown`[]

#### Returns

`Logger`

***

### error()

> **error**(`message?`, ...`args?`): `Logger`

Defined in: [packages/common/src/logger.ts:87](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/logger.ts#L87)

#### Parameters

##### message?

`unknown`

##### args?

...`unknown`[]

#### Returns

`Logger`

***

### info()

> **info**(`message?`, ...`args?`): `Logger`

Defined in: [packages/common/src/logger.ts:91](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/logger.ts#L91)

#### Parameters

##### message?

`unknown`

##### args?

...`unknown`[]

#### Returns

`Logger`

***

### log()

> **log**(`message?`, ...`args?`): `Logger`

Defined in: [packages/common/src/logger.ts:103](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/logger.ts#L103)

#### Parameters

##### message?

`unknown`

##### args?

...`unknown`[]

#### Returns

`Logger`

***

### newline()

> **newline**(): `Logger`

Defined in: [packages/common/src/logger.ts:107](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/logger.ts#L107)

#### Returns

`Logger`

***

### security()

> **security**(`message?`, ...`args?`): `Logger`

Defined in: [packages/common/src/logger.ts:99](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/logger.ts#L99)

#### Parameters

##### message?

`unknown`

##### args?

...`unknown`[]

#### Returns

`Logger`

***

### warn()

> **warn**(`message?`, ...`args?`): `Logger`

Defined in: [packages/common/src/logger.ts:95](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/logger.ts#L95)

#### Parameters

##### message?

`unknown`

##### args?

...`unknown`[]

#### Returns

`Logger`

***

### debug()

> `static` **debug**(`message?`, ...`args?`): `void`

Defined in: [packages/common/src/logger.ts:114](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/logger.ts#L114)

Static methods for convenience (auto-instantiate).

#### Parameters

##### message?

`unknown`

##### args?

...`unknown`[]

#### Returns

`void`

***

### error()

> `static` **error**(`message?`, ...`args?`): `void`

Defined in: [packages/common/src/logger.ts:118](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/logger.ts#L118)

#### Parameters

##### message?

`unknown`

##### args?

...`unknown`[]

#### Returns

`void`

***

### info()

> `static` **info**(`message?`, ...`args?`): `void`

Defined in: [packages/common/src/logger.ts:122](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/logger.ts#L122)

#### Parameters

##### message?

`unknown`

##### args?

...`unknown`[]

#### Returns

`void`

***

### log()

> `static` **log**(`message?`, ...`args?`): `void`

Defined in: [packages/common/src/logger.ts:134](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/logger.ts#L134)

#### Parameters

##### message?

`unknown`

##### args?

...`unknown`[]

#### Returns

`void`

***

### newline()

> `static` **newline**(): `void`

Defined in: [packages/common/src/logger.ts:138](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/logger.ts#L138)

#### Returns

`void`

***

### security()

> `static` **security**(`message?`, ...`args?`): `void`

Defined in: [packages/common/src/logger.ts:130](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/logger.ts#L130)

#### Parameters

##### message?

`unknown`

##### args?

...`unknown`[]

#### Returns

`void`

***

### warn()

> `static` **warn**(`message?`, ...`args?`): `void`

Defined in: [packages/common/src/logger.ts:126](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/logger.ts#L126)

#### Parameters

##### message?

`unknown`

##### args?

...`unknown`[]

#### Returns

`void`
