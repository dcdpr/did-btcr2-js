# Class: DidBtc1CLI

Defined in: [cli.ts:14](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cli/src/cli.ts#L14)

A class-based CLI using Commander.
- No forced process.exit().
- Configurable by calling `run(argv?)`.

## Constructors

### Constructor

> **new DidBtc1CLI**(): `DidBtc1CLI`

Defined in: [cli.ts:17](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cli/src/cli.ts#L17)

#### Returns

`DidBtc1CLI`

## Methods

### run()

> **run**(`argv?`): `void`

Defined in: [cli.ts:120](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cli/src/cli.ts#L120)

Parse and run the CLI.
You can supply custom argv for testing, or let it default to process.argv in production.

#### Parameters

##### argv?

`string`[]

#### Returns

`void`
