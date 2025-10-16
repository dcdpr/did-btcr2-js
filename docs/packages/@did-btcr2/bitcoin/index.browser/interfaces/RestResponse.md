# Interface: RestResponse

Defined in: [packages/bitcoin/src/rest-client.ts:96](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/rest-client.ts#L96)

## Extends

- `Response`

## Indexable

\[`key`: `string`\]: `any`

## Properties

### body

> `readonly` **body**: `null` \| `ReadableStream`&lt;`Uint8Array`&lt;`ArrayBufferLike`&gt;&gt;

Defined in: node\_modules/.pnpm/typescript@5.7.3/node\_modules/typescript/lib/lib.dom.d.ts:3471

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/body)

#### Inherited from

`Response.body`

***

### bodyUsed

> `readonly` **bodyUsed**: `boolean`

Defined in: node\_modules/.pnpm/typescript@5.7.3/node\_modules/typescript/lib/lib.dom.d.ts:3473

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/bodyUsed)

#### Inherited from

`Response.bodyUsed`

***

### headers

> `readonly` **headers**: `Headers`

Defined in: node\_modules/.pnpm/typescript@5.7.3/node\_modules/typescript/lib/lib.dom.d.ts:19411

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/headers)

#### Inherited from

`Response.headers`

***

### ok

> `readonly` **ok**: `boolean`

Defined in: node\_modules/.pnpm/typescript@5.7.3/node\_modules/typescript/lib/lib.dom.d.ts:19413

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/ok)

#### Inherited from

`Response.ok`

***

### redirected

> `readonly` **redirected**: `boolean`

Defined in: node\_modules/.pnpm/typescript@5.7.3/node\_modules/typescript/lib/lib.dom.d.ts:19415

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/redirected)

#### Inherited from

`Response.redirected`

***

### status

> `readonly` **status**: `number`

Defined in: node\_modules/.pnpm/typescript@5.7.3/node\_modules/typescript/lib/lib.dom.d.ts:19417

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/status)

#### Inherited from

`Response.status`

***

### statusText

> `readonly` **statusText**: `string`

Defined in: node\_modules/.pnpm/typescript@5.7.3/node\_modules/typescript/lib/lib.dom.d.ts:19419

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/statusText)

#### Inherited from

`Response.statusText`

***

### type

> `readonly` **type**: `ResponseType`

Defined in: node\_modules/.pnpm/typescript@5.7.3/node\_modules/typescript/lib/lib.dom.d.ts:19421

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/type)

#### Inherited from

`Response.type`

***

### url

> `readonly` **url**: `string`

Defined in: node\_modules/.pnpm/typescript@5.7.3/node\_modules/typescript/lib/lib.dom.d.ts:19423

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/url)

#### Inherited from

`Response.url`

## Methods

### arrayBuffer()

> **arrayBuffer**(): `Promise`&lt;`ArrayBuffer`&gt;

Defined in: node\_modules/.pnpm/typescript@5.7.3/node\_modules/typescript/lib/lib.dom.d.ts:3475

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/arrayBuffer)

#### Returns

`Promise`&lt;`ArrayBuffer`&gt;

#### Inherited from

`Response.arrayBuffer`

***

### blob()

> **blob**(): `Promise`&lt;`Blob`&gt;

Defined in: node\_modules/.pnpm/typescript@5.7.3/node\_modules/typescript/lib/lib.dom.d.ts:3477

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/blob)

#### Returns

`Promise`&lt;`Blob`&gt;

#### Inherited from

`Response.blob`

***

### bytes()

> **bytes**(): `Promise`&lt;`Uint8Array`&lt;`ArrayBufferLike`&gt;&gt;

Defined in: node\_modules/.pnpm/typescript@5.7.3/node\_modules/typescript/lib/lib.dom.d.ts:3479

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/bytes)

#### Returns

`Promise`&lt;`Uint8Array`&lt;`ArrayBufferLike`&gt;&gt;

#### Inherited from

`Response.bytes`

***

### clone()

> **clone**(): `Response`

Defined in: node\_modules/.pnpm/typescript@5.7.3/node\_modules/typescript/lib/lib.dom.d.ts:19425

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/clone)

#### Returns

`Response`

#### Inherited from

`Response.clone`

***

### formData()

> **formData**(): `Promise`&lt;`FormData`&gt;

Defined in: node\_modules/.pnpm/typescript@5.7.3/node\_modules/typescript/lib/lib.dom.d.ts:3481

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/formData)

#### Returns

`Promise`&lt;`FormData`&gt;

#### Inherited from

`Response.formData`

***

### json()

> **json**(): `Promise`&lt;`any`&gt;

Defined in: node\_modules/.pnpm/typescript@5.7.3/node\_modules/typescript/lib/lib.dom.d.ts:3483

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/json)

#### Returns

`Promise`&lt;`any`&gt;

#### Inherited from

`Response.json`

***

### text()

> **text**(): `Promise`&lt;`string`&gt;

Defined in: node\_modules/.pnpm/typescript@5.7.3/node\_modules/typescript/lib/lib.dom.d.ts:3485

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/text)

#### Returns

`Promise`&lt;`string`&gt;

#### Inherited from

`Response.text`
