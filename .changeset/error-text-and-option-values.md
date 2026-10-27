---
'@did-btcr2/method': minor
'@did-btcr2/api': minor
'@did-btcr2/cli': patch
---

An error message prints only a primitive value of the caller. `BitcoinApi` refuses an unknown option value. The DID document context is frozen, and `Appendix.dereferenceZcapId` is removed (ADR 156).

- method: an error message holds a value of the caller only if the value is a primitive. For an object or a function, the message holds no value, and the error `data` holds it. Before, an object with no usable `toString`, for example `Object.create(null)`, gave a raw `TypeError`. The sites: `Updater.signingMethod`, `Updater.construct`, `DidBtcr2.update`, the `NeedFunding` check, the resolution option checks, and the id check of the resolver. Each now gives its typed error. The message of another object no longer holds `[object Object]`.
- method: `Updater.construct` refuses a `sourceDocument` that is not an object, with `Invalid sourceDocument: expected a DID document object.` It refuses a `sourceDocument.id` that is not a string, with a message that starts with `Invalid sourceDocument: expected a string id`. Each refusal is an `UpdateError` of type `INVALID_DID_UPDATE`. Before, an object id gave the message `Patches must not change the DID document id`.
- method: Breaking: `BTCR2_DID_DOCUMENT_CONTEXT` is frozen, and its type is a `readonly` tuple. A write to the array throws a `TypeError`. A caller that builds a document must copy the array, for example `[...BTCR2_DID_DOCUMENT_CONTEXT]`.
- method: Breaking: `Appendix.dereferenceZcapId` is removed. The specification no longer defines the algorithm. `Appendix.deriveRootCapability` gives the Root Capability of a DID.
- method: the JSDoc links to the specification name each section without a section number, and the dead anchors are fixed. The README update example sets a REST host for `BitcoinConnection`.
- api: Breaking: the `BitcoinApi` constructor refuses a `signalDiscovery` value other than `undefined`, `'indexer'`, and `'fullnode'`, for example `'Fullnode'` or `null`. Before, the api accepted such a value and read the signals as `'indexer'`.
- api: Breaking: the `BitcoinApi` constructor refuses a network that is not an own key of `DEFAULT_BITCOIN_NETWORK_CONFIG`, for example `'toString'`. It refuses `'fullnode'` with no RPC config. Each of the three refusals is a `MethodError` of type `INVALID_OPTIONS`. Before, the two refusals gave a plain `Error`, and the network `'toString'` gave a raw `TypeError`. The first access of `api.btc` or `api.btcr2` throws the refusal.
- api: the genesis document builder, the `verifyMessage` check detail, and the `announce.feeRate` check print only a primitive value in an error message.
- cli: `config set`, the keystore and envelope version checks, and the `--source-document` id check print only a primitive value in an error message. Before, `config set` gave a raw `TypeError` for the value `{"toString":1}`. `resolve` with `fullnode` and no RPC config prints one line, with no stack.
