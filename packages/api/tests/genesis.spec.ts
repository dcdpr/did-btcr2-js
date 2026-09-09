import { expect } from 'chai';
import { canonicalHashBytes, DidDocumentError } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { deriveSingletonAddress, GenesisDocument, Identifier } from '@did-btcr2/method';
import { getNetwork } from '@did-btcr2/bitcoin';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  BEACON_ADDRESS_TYPES,
  BEACON_TYPES,
  buildGenesisDocument,
  DEFAULT_BEACON_ADDRESS_TYPE,
  DidMethodApi,
  VERIFICATION_RELATIONSHIPS,
} from '../src/index.js';
import type { GenesisDocumentSpec } from '../src/index.js';

/** A fresh 33-byte compressed public key. */
function publicKey(): Uint8Array {
  return SchnorrKeyPair.generate().publicKey.compressed;
}

/** The plain JSON form of a document, as a file or a sidecar carries it. */
function plain(document: object): Record<string, any> {
  return JSON.parse(JSON.stringify(document));
}

/** The address of a key on a network for a script kind. */
function addressOf(key: Uint8Array, network: string, kind: 'p2pkh' | 'p2wpkh' | 'p2tr'): string {
  return deriveSingletonAddress(kind, key, getNetwork(network));
}

describe('genesis document builder', () => {
  describe('buildGenesisDocument()', () => {
    it('builds a document with placeholder ids, all four relationships, and one P2WPKH singleton beacon', () => {
      const key = publicKey();
      const doc = plain(buildGenesisDocument({ network: 'regtest', verificationMethods: [{ publicKey: key }] }));
      expect(doc.id).to.equal('did:btcr2:_');
      expect(doc['@context']).to.deep.equal(['https://www.w3.org/ns/did/v1.1', 'https://btcr2.dev/context/v1']);
      expect(doc.verificationMethod).to.deep.equal([{
        id                 : 'did:btcr2:_#key-0',
        type               : 'Multikey',
        controller         : 'did:btcr2:_',
        publicKeyMultibase : doc.verificationMethod[0].publicKeyMultibase,
      }]);
      expect(doc.verificationMethod[0].publicKeyMultibase).to.match(/^zQ3s/);
      for (const relationship of VERIFICATION_RELATIONSHIPS) {
        expect(doc[relationship], relationship).to.deep.equal(['did:btcr2:_#key-0']);
      }
      expect(doc.service).to.deep.equal([{
        id              : 'did:btcr2:_#service-0',
        type            : 'SingletonBeacon',
        serviceEndpoint : `bitcoin:${addressOf(key, 'regtest', DEFAULT_BEACON_ADDRESS_TYPE)}`,
      }]);
      expect(doc.service[0].serviceEndpoint).to.match(/^bitcoin:bcrt1q/);
      expect(doc).to.not.have.property('deactivated');
    });

    it('derives the beacon addresses for the named network', () => {
      const key = publicKey();
      const doc = plain(buildGenesisDocument({ network: 'mutinynet', verificationMethods: [{ publicKey: key }] }));
      expect(doc.service[0].serviceEndpoint).to.equal(`bitcoin:${addressOf(key, 'mutinynet', 'p2wpkh')}`);
      expect(doc.service[0].serviceEndpoint).to.match(/^bitcoin:tb1q/);
    });

    it('lists only the relationships each method names, and omits an empty relationship', () => {
      const signer = publicKey();
      const asserter = publicKey();
      const doc = plain(buildGenesisDocument({
        network             : 'regtest',
        verificationMethods : [
          { publicKey: signer, relationships: ['capabilityInvocation', 'authentication'] },
          { publicKey: asserter, relationships: ['assertionMethod'] },
        ],
      }));
      expect(doc.authentication).to.deep.equal(['did:btcr2:_#key-0']);
      expect(doc.assertionMethod).to.deep.equal(['did:btcr2:_#key-1']);
      expect(doc.capabilityInvocation).to.deep.equal(['did:btcr2:_#key-0']);
      expect(doc).to.not.have.property('capabilityDelegation');
    });

    it('takes a fragment for a method id and a beacon id', () => {
      const key = publicKey();
      const doc = plain(buildGenesisDocument({
        network             : 'regtest',
        verificationMethods : [{ publicKey: key, fragment: 'signing' }],
        beacons             : [{ type: 'SingletonBeacon', publicKey: key, fragment: 'beacon' }],
      }));
      expect(doc.verificationMethod[0].id).to.equal('did:btcr2:_#signing');
      expect(doc.capabilityInvocation).to.deep.equal(['did:btcr2:_#signing']);
      expect(doc.service[0].id).to.equal('did:btcr2:_#beacon');
    });

    it('builds a beacon of each type from a key with each address type', () => {
      const key = publicKey();
      const beacons = BEACON_TYPES.map((type, index) => ({
        type,
        publicKey   : key,
        addressType : BEACON_ADDRESS_TYPES[index],
      }));
      const doc = plain(buildGenesisDocument({ network: 'regtest', verificationMethods: [{ publicKey: key }], beacons }));
      expect(doc.service.map((s: any) => s.type)).to.deep.equal(['SingletonBeacon', 'CASBeacon', 'SMTBeacon']);
      expect(doc.service.map((s: any) => s.id)).to.deep.equal([
        'did:btcr2:_#service-0', 'did:btcr2:_#service-1', 'did:btcr2:_#service-2',
      ]);
      expect(doc.service[0].serviceEndpoint).to.equal(`bitcoin:${addressOf(key, 'regtest', 'p2pkh')}`);
      expect(doc.service[1].serviceEndpoint).to.equal(`bitcoin:${addressOf(key, 'regtest', 'p2wpkh')}`);
      expect(doc.service[2].serviceEndpoint).to.equal(`bitcoin:${addressOf(key, 'regtest', 'p2tr')}`);
    });

    it('takes a beacon address as given, with or without the bitcoin: scheme', () => {
      const key = publicKey();
      const cohort = addressOf(publicKey(), 'regtest', 'p2tr');
      const doc = plain(buildGenesisDocument({
        network             : 'regtest',
        verificationMethods : [{ publicKey: key }],
        beacons             : [
          { type: 'SMTBeacon', address: cohort },
          { type: 'CASBeacon', address: `bitcoin:${cohort}` },
        ],
      }));
      expect(doc.service[0].serviceEndpoint).to.equal(`bitcoin:${cohort}`);
      expect(doc.service[1].serviceEndpoint).to.equal(`bitcoin:${cohort}`);
    });

    it('adds other services after the beacons, with a fragment id or a placeholder id', () => {
      const key = publicKey();
      const doc = plain(buildGenesisDocument({
        network             : 'regtest',
        verificationMethods : [{ publicKey: key }],
        services            : [
          { id: '#website', type: 'LinkedDomains', serviceEndpoint: 'https://example.com' },
          { id: 'did:btcr2:_#hub', type: 'Hub', serviceEndpoint: ['https://a.example', 'https://b.example'] },
          { type: 'Other', serviceEndpoint: { uri: 'https://c.example' } } as any,
        ],
      }));
      expect(doc.service).to.have.lengthOf(4);
      expect(doc.service[1]).to.deep.equal({ id: 'did:btcr2:_#website', type: 'LinkedDomains', serviceEndpoint: 'https://example.com' });
      expect(doc.service[2].id).to.equal('did:btcr2:_#hub');
      // The default fragment names the position in the service array.
      expect(doc.service[3].id).to.equal('did:btcr2:_#service-3');
    });

    it('hashes the same as its plain JSON form', () => {
      const doc = buildGenesisDocument({ network: 'regtest', verificationMethods: [{ publicKey: publicKey() }] });
      expect(bytesToHex(GenesisDocument.toGenesisBytes(doc))).to.equal(bytesToHex(canonicalHashBytes(plain(doc))));
    });

    describe('refusals', () => {
      const key = publicKey();
      const base = (): GenesisDocumentSpec => ({ network: 'regtest', verificationMethods: [{ publicKey: key }] });

      const cases: Array<[string, () => GenesisDocumentSpec, RegExp]> = [
        ['no verification method', () => ({ ...base(), verificationMethods: [] }), /at least one verification method/],
        ['a key that is not 33 bytes', () => ({ ...base(), verificationMethods: [{ publicKey: key.slice(1) }] }), /33-byte compressed/],
        // 0x02 followed by 32 bytes of 0xff: the x coordinate exceeds the field prime.
        ['a key that is not on the curve', () => ({ ...base(), verificationMethods: [{ publicKey: Uint8Array.from([2, ...new Uint8Array(32).fill(0xff)]) }] }), /not a valid compressed/],
        ['an unknown relationship', () => ({ ...base(), verificationMethods: [{ publicKey: key, relationships: ['keyAgreement' as any] }] }), /keyAgreement/],
        ['no capabilityInvocation method', () => ({ ...base(), verificationMethods: [{ publicKey: key, relationships: ['authentication'] }] }), /capabilityInvocation/],
        ['an empty beacon list', () => ({ ...base(), beacons: [] }), /at least one beacon/],
        ['an unknown beacon type', () => ({ ...base(), beacons: [{ type: 'MyBeacon' as any, publicKey: key }] }), /MyBeacon/],
        ['a beacon with a key and an address', () => ({ ...base(), beacons: [{ type: 'SingletonBeacon', publicKey: key, address: addressOf(key, 'regtest', 'p2wpkh') }] }), /exactly one of publicKey or address/],
        ['a beacon with neither a key nor an address', () => ({ ...base(), beacons: [{ type: 'SingletonBeacon' }] }), /exactly one of publicKey or address/],
        ['an address type with an address', () => ({ ...base(), beacons: [{ type: 'SingletonBeacon', address: addressOf(key, 'regtest', 'p2wpkh'), addressType: 'p2tr' }] }), /addressType applies only with publicKey/],
        ['an unknown address type', () => ({ ...base(), beacons: [{ type: 'SingletonBeacon', publicKey: key, addressType: 'p2sh' as any }] }), /p2sh/],
        ['an address of another network', () => ({ ...base(), beacons: [{ type: 'SingletonBeacon', address: addressOf(key, 'bitcoin', 'p2wpkh') }] }), /not a P2PKH, P2WPKH, or P2TR address of the network/],
        ['an address that is not an address', () => ({ ...base(), beacons: [{ type: 'SingletonBeacon', address: 'nope' }] }), /not a P2PKH, P2WPKH, or P2TR address/],
        ['a fragment with a hash sign', () => ({ ...base(), verificationMethods: [{ publicKey: key, fragment: '#key' }] }), /without "#"/],
        ['a service with a beacon type', () => ({ ...base(), services: [{ id: '#b', type: 'SingletonBeacon', serviceEndpoint: 'bitcoin:x' }] }), /Declare a beacon under "beacons"/],
        ['a service id without the placeholder', () => ({ ...base(), services: [{ id: 'did:example:1#x', type: 'T', serviceEndpoint: 'https://x' }] }), /contain the placeholder/],
        ['a service without an endpoint', () => ({ ...base(), services: [{ id: '#x', type: 'T' } as any] }), /serviceEndpoint is required/],
        ['two services with one id', () => ({ ...base(), services: [{ id: '#service-0', type: 'T', serviceEndpoint: 'https://x' }] }), /appears twice/],
        ['two methods with one fragment', () => ({ ...base(), verificationMethods: [{ publicKey: key, fragment: 'a' }, { publicKey: publicKey(), fragment: 'a' }] }), /appears twice/],
      ];

      for (const [name, spec, message] of cases) {
        it(`refuses ${name}`, () => {
          expect(() => buildGenesisDocument(spec())).to.throw(DidDocumentError, message);
        });
      }
    });
  });

  describe('DidMethodApi.buildGenesisDocument()', () => {
    it('derives the beacon addresses for the default network when the spec names none', () => {
      const key = publicKey();
      const offline = new DidMethodApi();
      const doc = plain(offline.buildGenesisDocument({ verificationMethods: [{ publicKey: key }] }));
      expect(doc.service[0].serviceEndpoint).to.equal(`bitcoin:${addressOf(key, DidMethodApi.FALLBACK_NETWORK, 'p2wpkh')}`);
    });

    it('takes the network of the spec over the default', () => {
      const key = publicKey();
      const doc = plain(new DidMethodApi().buildGenesisDocument({ network: 'signet', verificationMethods: [{ publicKey: key }] }));
      expect(doc.service[0].serviceEndpoint).to.equal(`bitcoin:${addressOf(key, 'signet', 'p2wpkh')}`);
    });
  });

  describe('DidMethodApi.createExternalFromDocument()', () => {
    it('mints an EXTERNAL DID that encodes the hash of the document as given', () => {
      const methodApi = new DidMethodApi();
      const doc = plain(methodApi.buildGenesisDocument({ network: 'mutinynet', verificationMethods: [{ publicKey: publicKey() }] }));
      const { did, genesisBytes, didDocument } = methodApi.createExternalFromDocument(doc, { network: 'mutinynet' });
      expect(did).to.match(/^did:btcr2:x1/);
      const components = Identifier.decode(did);
      expect(components.network).to.equal('mutinynet');
      expect(bytesToHex(components.genesisBytes)).to.equal(bytesToHex(genesisBytes));
      expect(bytesToHex(genesisBytes)).to.equal(bytesToHex(canonicalHashBytes(doc)));
      expect(didDocument.id).to.equal(did);
      expect(didDocument.verificationMethod[0].id).to.equal(`${did}#key-0`);
      expect(didDocument.verificationMethod[0].controller).to.equal(did);
      expect(didDocument.service[0].id).to.equal(`${did}#service-0`);
    });

    it('agrees with getInitialDocument, getBeacons, and the identifier validation report', () => {
      const methodApi = new DidMethodApi();
      const key = publicKey();
      const doc = plain(methodApi.buildGenesisDocument({ network: 'regtest', verificationMethods: [{ publicKey: key }] }));
      const { did, didDocument } = methodApi.createExternalFromDocument(doc, { network: 'regtest' });
      expect(plain(methodApi.getInitialDocument(did, doc))).to.deep.equal(plain(didDocument));
      expect(methodApi.getBeacons(didDocument)).to.deep.equal([{
        id      : `${did}#service-0`,
        type    : 'SingletonBeacon',
        address : addressOf(key, 'regtest', 'p2wpkh'),
      }]);
      const report = Identifier.validate(did, { genesisDocument: doc, genesisBytes: canonicalHashBytes(doc) });
      expect(report.valid, JSON.stringify(report.checks)).to.equal(true);
    });

    it('accepts the document instance as well as its plain form', () => {
      const methodApi = new DidMethodApi();
      const instance = methodApi.buildGenesisDocument({ network: 'regtest', verificationMethods: [{ publicKey: publicKey() }] });
      const fromInstance = methodApi.createExternalFromDocument(instance, { network: 'regtest' });
      const fromPlain = methodApi.createExternalFromDocument(plain(instance), { network: 'regtest' });
      expect(fromInstance.did).to.equal(fromPlain.did);
    });

    it('mints for the default network when the options name none', () => {
      const methodApi = new DidMethodApi();
      const doc = plain(methodApi.buildGenesisDocument({ verificationMethods: [{ publicKey: publicKey() }] }));
      const { did } = methodApi.createExternalFromDocument(doc);
      expect(Identifier.decode(did).network).to.equal(DidMethodApi.FALLBACK_NETWORK);
    });

    it('accepts a hand-written genesis document in the shape of the specification example', () => {
      const key = publicKey();
      const doc = {
        '@context'           : ['https://www.w3.org/ns/did/v1.1', 'https://btcr2.dev/context/v1'],
        'id'                 : 'did:btcr2:_',
        'verificationMethod' : [{
          id                 : 'did:btcr2:_#key-0',
          type               : 'Multikey',
          controller         : 'did:btcr2:_',
          publicKeyMultibase : plain(buildGenesisDocument({ network: 'regtest', verificationMethods: [{ publicKey: key }] })).verificationMethod[0].publicKeyMultibase,
        }],
        'assertionMethod'      : ['did:btcr2:_#key-0'],
        'capabilityInvocation' : ['did:btcr2:_#key-0'],
        'service'              : [{
          id              : 'did:btcr2:_#service-0',
          type            : 'SingletonBeacon',
          serviceEndpoint : `bitcoin:${addressOf(key, 'regtest', 'p2wpkh')}`,
        }],
      };
      const { did, didDocument } = new DidMethodApi().createExternalFromDocument(doc, { network: 'regtest' });
      expect(didDocument.id).to.equal(did);
      expect(didDocument).to.not.have.property('authentication');
    });

    describe('refusals', () => {
      const methodApi = new DidMethodApi();
      const valid = (): Record<string, any> => plain(methodApi.buildGenesisDocument({
        network             : 'regtest',
        verificationMethods : [{ publicKey: publicKey() }],
      }));

      it('refuses a value that is not a JSON object', () => {
        for (const bad of [null, 'text', 42, [valid()]]) {
          expect(() => methodApi.createExternalFromDocument(bad as any), String(bad)).to.throw(DidDocumentError, /must be a JSON object/);
        }
      });

      it('refuses a document whose id is not the placeholder', () => {
        const doc = valid();
        doc.id = 'did:btcr2:k1qq';
        expect(() => methodApi.createExternalFromDocument(doc)).to.throw(DidDocumentError, /id must be "did:btcr2:_"/);
      });

      it('refuses a document without the required contexts', () => {
        const missing = valid();
        delete missing['@context'];
        expect(() => methodApi.createExternalFromDocument(missing)).to.throw(DidDocumentError, /"@context" must include/);
        const partial = valid();
        partial['@context'] = ['https://www.w3.org/ns/did/v1.1'];
        expect(() => methodApi.createExternalFromDocument(partial)).to.throw(DidDocumentError, /"@context" must include/);
      });

      it('refuses a verification method that does not carry the placeholder', () => {
        const doc = valid();
        doc.verificationMethod[0].controller = 'did:btcr2:k1qq';
        expect(() => methodApi.createExternalFromDocument(doc)).to.throw(DidDocumentError, /verificationMethod/);
      });

      it('refuses a service that does not carry the placeholder', () => {
        const doc = valid();
        doc.service[0].id = '#service-0';
        expect(() => methodApi.createExternalFromDocument(doc)).to.throw(DidDocumentError, /service/);
      });

      it('refuses a verification method that is not a Multikey', () => {
        const doc = valid();
        doc.verificationMethod[0].type = 'JsonWebKey';
        expect(() => methodApi.createExternalFromDocument(doc)).to.throw(DidDocumentError, /verificationMethod/);
      });
    });
  });
});
