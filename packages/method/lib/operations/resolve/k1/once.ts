import { Identifier, Resolver } from '../../../../src/index.js';

const did = 'did:btcr2:k1q5prr73dxh76el6tfl09skfm49uqxxqra8cqxszy9yntqt852ulecrsrxkp82';

// Decode the did to be resolved
const didComponents = Identifier.decode(did);

console.log('Decoded DID components:', didComponents);

// Process sidecar if provided
const sidecarData = Resolver.sidecarData({'updates': [{'@context': ['https://w3id.org/security/v2','https://w3id.org/zcap/v1','https://w3id.org/json-ld-patch/v1','https://btcr2.dev/context/v1','https://w3id.org/security/data-integrity/v2'],'patch': [{'op': 'add','path': '/service/0','value': {'id': 'did:btcr2:k1q5prr73dxh76el6tfl09skfm49uqxxqra8cqxszy9yntqt852ulecrsrxkp82#service-1','type': 'MyService','serviceEndpoint': 'https://localhost:1234/'}}],'sourceHash': 'l7zFAm7uHNMCDDOXqm0GXJqsN1QZd5JpI4J-aM5hpiI=','targetHash': '9izUOyujZSsOpEoMBqmAZ7GSJuQWNs56APNzGz7FlCg=','targetVersionId': 2,'proof': {'type': 'DataIntegrityProof','cryptosuite': 'bip340-jcs-2025','verificationMethod': 'did:btcr2:k1q5prr73dxh76el6tfl09skfm49uqxxqra8cqxszy9yntqt852ulecrsrxkp82#initialKey','proofPurpose': 'capabilityInvocation','capability': 'urn:zcap:root:did%3Abtcr2%3Ak1q5prr73dxh76el6tfl09skfm49uqxxqra8cqxszy9yntqt852ulecrsrxkp82','capabilityAction': 'Write','proofValue': 'z5zXkHkNjVarQqTq74Ut9sDt3MYpD8UMnY4MSZgjWiTopefxqbDoQARru8SRA55SqZDdcqbBYdfn4w218F1YaywyE'}}]});

console.log('Processed sidecar data:', sidecarData);

// Establish the current document for KEY identifiers (pure, synchronous).
const currentDocument = Resolver.deterministic(didComponents);

console.log('Established current document:', currentDocument);