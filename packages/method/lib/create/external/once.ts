import { DidBtcr2 } from "@did-btcr2/method";

const options = { version: 1, network: "mutinynet" };
const intermediateDocument = {
    "id": "did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "controller": [
        "did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    ],
    "@context": [
        "https://www.w3.org/TR/did-1.1",
        "https://btcr2.dev/context/v1"
    ],
    "verificationMethod": [
        {
            "id": "did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#key-0",
            "type": "Multikey",
            "controller": "did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            "publicKeyMultibase": "zQ3shpvj4d9W1cDWhT93RLwAtjfQQ3CRLNsjjZKLsXa1AtvCf"
        }
    ],
    "authentication": [
        "did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#key-0"
    ],
    "assertionMethod": [
        "did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#key-0"
    ],
    "capabilityInvocation": [
        "did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#key-0"
    ],
    "capabilityDelegation": [
        "did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#key-0"
    ],
    "service": [
        {
            "id": "did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#key-0",
            "type": "SingletonBeacon",
            "serviceEndpoint": "bitcoin:1HG3YPxx91k92Qcjgsdz6SG7yhMTwq3XLx"
        }
    ]
}

const genesisBytes = await JSON.canonicalization.canonicalhash(intermediateDocument);
const res = await DidBtcr2.create({ idType: "EXTERNAL", genesisBytes, options });
console.log(res);