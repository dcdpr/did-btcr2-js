# Interface: DidUpdatePayload

Defined in: [packages/common/src/interfaces.ts:54](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L54)

The unsigned payload object containing instructions for how to update a
did:btcr2 DID Document. Once signed, it becomes a
[DID Update Invocation](DidUpdateInvocation.md)

DID BTCR2
[4.3.1 Construct DID Update Payload](https://dcdpr.github.io/did-btcr2/#construct-did-update-payload).

Found in DID BTCR2 Specification [Section 9.4.2](https://dcdpr.github.io/did-btcr2/#dereference-root-capability-identifier)

## Example

```
{
 "@context": [
   "https://w3id.org/zcap/v1",
   "https://w3id.org/security/data-integrity/v2",
   "https://w3id.org/json-ld-patch/v1"
 ],
 "patch": [
   {
     "op": "add",
     "path": "/service/4",
     "value": {
       "id": "#linked-domain",
       "type": "LinkedDomains",
       "serviceEndpoint": "https://contact-me.com"
     }
   }
  ],
  "proof":{
  "type": "DataIntegrityProof,
  "cryptosuite": "schnorr-secp256k1-jcs-2025,
  "verificationMethod": "did:btcr2:k1qqpuwwde82nennsavvf0lqfnlvx7frrgzs57lchr02q8mz49qzaaxmqphnvcx#initialKey,
  "invocationTarget": "did:btcr2:k1qqpuwwde82nennsavvf0lqfnlvx7frrgzs57lchr02q8mz49qzaaxmqphnvcx,
  "capability": "urn:zcap:root:did%3Abtcr2%3Ak1qqpuwwde82nennsavvf0lqfnlvx7frrgzs57lchr02q8mz49qzaaxmqphnvcx,
  "capabilityAction": "Write,
  "proofPurpose": "assertionMethod,
  "proofValue": "z381yXYmxU8NudZ4HXY56DfMN6zfD8syvWcRXzT9xD9uYoQToo8QsXD7ahM3gXTzuay5WJbqTswt2BKaGWYn2hHhVFKJLXaD
 }
}
```

## Extended by

- [`DidUpdateInvocation`](DidUpdateInvocation.md)

## Properties

### @context

> **@context**: `string`[]

Defined in: [packages/common/src/interfaces.ts:59](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L59)

JSON-LD context URIs for interpreting this payload, including contexts
for ZCAP (capabilities), Data Integrity proofs, and JSON-LD patch ops.

***

### patch

> **patch**: [`JsonPatch`](../type-aliases/JsonPatch.md)

Defined in: [packages/common/src/interfaces.ts:66](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L66)

A JSON Patch (or JSON-LD Patch) object defining the mutations to apply to
the DID Document. Applying this patch to the current DID Document yields
the new DID Document (which must remain valid per DID Core spec).

***

### proof?

> `optional` **proof**: [`Proof`](Proof.md)

Defined in: [packages/common/src/interfaces.ts:94](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L94)

A proof object (Data Integrity proof) that authorizes this update.
It is a JSON-LD proof indicating a capability invocation on the DID's
root capability, typically signed with the DID's verification key (using
Schnorr secp256k1 in did:btcr2).

***

### sourceHash

> **sourceHash**: `string`

Defined in: [packages/common/src/interfaces.ts:73](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L73)

The multihash of the current (source) DID Document, encoded as a multibase
base58-btc string. This is a SHA-256 hash of the canonicalized source DID
Document, used to ensure the patch is applied to the correct document state.

***

### targetHash

> **targetHash**: `string`

Defined in: [packages/common/src/interfaces.ts:80](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L80)

The multihash of the updated (target) DID Document, encoded as multibase
base58-btc. This is the SHA-256 hash of the canonicalized
DID Document after applying the patch, used to verify the update result.

***

### targetVersionId

> **targetVersionId**: `number`

Defined in: [packages/common/src/interfaces.ts:86](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L86)

The version number of the DID Document after this update.
It is equal to the previous document version + 1.
