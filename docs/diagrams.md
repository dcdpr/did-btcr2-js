# Diagrams

## Architecture

COMING SOON

## Sequence

Below are sequence diagrams of the various data flows for the core DID Method CRUD functionality.

### Create

A did:btc1 identifier and associated DID document can either be created deterministically from a cryptographic seed, or it can be created from an arbitrary genesis intermediate DID document representation. In both cases, DID creation can be undertaken in an offline manner, i.e., the DID controller does not need to interact with the Bitcoin network to create their DID.

**Create Deterministic**

For deterministic creation, the did:btc1 encodes a secp256k1 public key into an identifier. The key is then used to deterministically generate the initial DID document.

```mermaid
sequenceDiagram
    title Create From Deterministic Key Pair
    actor Controller as DID Controller
    participant BTC1Create
    participant Encode as Identifier Encoding
    participant BTC1Read

    note over Controller, BTC1Read: Offline — no Bitcoin network interaction

    Controller->>BTC1Create: CreateDeterministic(pubKeyBytes, version?, network?)
    BTC1Create->>BTC1Create: idType="key"<br/>version=1<br/>network="bitcoin"<br/>genesisBytes=pubKeyBytes
    BTC1Create->>Encode: Encode(idType, version, network, genesisBytes)
    Encode-->>BTC1Create: id
    BTC1Create->>BTC1Read: BTC1Read(did = id)
    BTC1Read-->>BTC1Create: {initialDocument}
    BTC1Create-->>Controller: {did, initialDocument}

```

**Create External**

For external creation, the did:btc1 encodes an arbitrary DID document into an identifier. The initial document is then used as the initial DID Document.

```mermaid
sequenceDiagram
    title Create From External Intermediate DID Document
    participant Controller
    participant BTC1Create
    participant Encode as Identifier Encoding
    participant Canonicalize as Canonicalize & Hash

    note over Controller, Canonicalize: Offline — no Bitcoin network interaction
    Controller->>BTC1Create: CreateExternal(intermediateDocument, version?, network?)
    BTC1Create->>BTC1Create: idType="external"<br/>version=1<br/>network="bitcoin"
    BTC1Create->>Canonicalize: CanonicalizeAndHash(intermediateDocument)
    Canonicalize-->>BTC1Create: genesisBytes
    BTC1Create->>Encode: Encode(idType, version, network, genesisBytes)
    Encode-->>BTC1Create: id
    BTC1Create->>BTC1Create: initialDocument = copy(intermediateDocument)<br/>Replace all did:btc1:xxxx... with id
    BTC1Create-->>Controller: {did, initialDocument}
    Note right of BTC1Create: Optionally, store canonicalBytes on IPFS as CID. F
```

### Resolve

The resolve operation is executed by a resolver after a resolution request identifying a specific did:btc1 identifier is received from a client at Resolution Time. The request MAY contain a resolutionOptions object containing additional information to be used in resolution. The resolver then attempts to resolve the DID document of the identifier at a specific Target Time. The Target Time is either provided in resolutionOptions or is set to the Resolution Time of the request.

```mermaid
sequenceDiagram
    title Resolve
    participant Resolver as DID Resolver
    participant Resolve as BTC1Resolve
    participant Decode as Identifier Decoding

    note over Resolver: DID Controller<br/>provides identifier to<br/>DID Resolver

    Resolver->>Resolve: Resolve(identifier, options)
    Resolve->>Decode: Decode(identifier)
    Decode-->>Resolve: {didComponents}
    Resolve-->>Resolve: ResolveInitialDocument(identifier, didComponents, options?)
    Resolve-->>Resolve: ResolveTargetDocument(initialDocument, options?)
    Resolve-->>Resolver: {didResolutionResult}
```

### Update

An update to a did:btc1 document is an invoked capability using the ZCAP-LD data format, signed by a verificationMethod that has the authority to make the update as specified in the previous DID document. Capability invocations for updates MUST be authorized using Data Integrity following the bip340-jcs-2025 cryptosuite with a proofPurpose of capabilityInvocation.

```mermaid
sequenceDiagram
  title Update
  autonumber

  actor Client as DID Controller
  participant Update as Btc1Update
  participant Factory as BeaconFactory
  participant Beacon as Beacon (Singleton/Map/SMT)

  Client->>Update: update({ identifier, sourceDocument,<br/>sourceVersionId, patch, verificationMethodId, beaconIds })
  activate Update

  %% ===== Construct DID Update Payload =====
  rect rgba(0,0,0,0.03)
    Note over Update: Construct DID Update Payload
    Update->>Update: construct({ identifier, sourceDocument,<br/>sourceVersionId, patch })
    Note right of Update: - Verify sourceDocument.id === identifier<br/>- Apply JSON Patch → targetDocument<br/>- Validate targetDocument (DID Core)<br/>- JCS + hash → sourceHash, targetHash<br/>- targetVersionId = sourceVersionId + 1
    Update-->>Update: DidUpdatePayload
  end

  %% ===== Resolve & validate signing method =====
  rect rgba(0,0,0,0.03)
    Note over Update: Resolve & validate signing method
    Update->>Update: getSigningMethod(sourceDocument, verificationMethodId)
    Update-->>Update: verificationMethod
    alt invalid verificationMethod
      Update-->>Client: throw Btc1Error(INVALID_DID_DOCUMENT)
      deactivate Update
    else type !== "Multikey" OR publicKeyMultibase prefix !== "zQ3s"
      Update-->>Client: throw Btc1Error(INVALID_DID_DOCUMENT)
    end
  end

  %% ===== Invoke DID Update Payload (add ZCAP-LD Data Integrity proof) =====
  rect rgba(0,0,0,0.03)
    Note over Update: Invoke DID Update Payload (add ZCAP-LD Data Integrity proof)
    Update->>Update: invoke({ identifier, didUpdatePayload,<br/>verificationMethod })
    Update-->>Update: DidUpdateInvocation
  end

  %% ===== Announce DID Update (broadcast to beacons) =====
  rect rgba(0,0,0,0.03)
    Note over Update: Announce DID Update (broadcast to beacons)
    loop for beaconId in beaconIds
      Update->>Update: find service in sourceDocument.service
      alt not found
        Update-->>Client: throw Btc1Error(INVALID_DID_DOCUMENT)
      else found
        Update->>Factory: establish(beaconService)
        Factory-->>Update: Beacon instance
        Update->>Beacon: broadcastSignal(DidUpdateInvocation)
        Beacon-->>Update: signalMetadata (accumulate)
      end
    end
  end

  Update-->>Client: signalsMetadata
```

### Deactivate

To deactivate a did:btc1, the DID controller MUST add the property deactivated with the value true on the DID document. To do this, the DID controller constructs a valid DID Update Payload with a JSON patch that adds this property and announces the payload through a Beacon in their current DID document following the algorithm in Update. Once a did:btc1 has been deactivated this state is considered permanent and resolution MUST terminate.