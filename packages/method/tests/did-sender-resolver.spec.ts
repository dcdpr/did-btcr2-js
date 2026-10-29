import { DidDocumentError, INVALID_DID_DOCUMENT, VERIFICATION_METHOD_ERROR } from '@did-btcr2/std';
import { expect } from 'chai';
import { hex } from '@scure/base';
import { CompressedSecp256k1PublicKey, SchnorrKeyPair } from '@did-btcr2/keys';
import { DidBtcr2 } from '../src/did-btcr2.js';
import { getAggregationCommunicationKey, resolveBtcr2SenderPk } from '../src/core/did-sender-resolver.js';
import { Identifier } from '../src/core/identifier.js';
import { Resolver } from '../src/core/resolver.js';
import { GenesisDocument, type DidDocument, type GenesisDocumentLike } from '../src/utils/did-document.js';
import externalData from './data/external-data.js';
import deterministicData from './data/deterministic-data.js';

/**
 * Sender-key resolution for the aggregation transport, for both KEY (k1) and
 * EXTERNAL (x1) did:btcr2 identifiers (ADR 066).
 */

/** Public key (compressed, hex) derived independently from a secret key hex. */
const derivePkHex = (secretKey: string): string =>
  hex.encode(SchnorrKeyPair.fromSecret(secretKey).publicKey.compressed);

const external = externalData[0];

describe('resolveBtcr2SenderPk', () => {
  it('resolves a KEY (k1) DID to its genesis public key, ignoring any genesis document', () => {
    for(const { did, genesisBytes } of deterministicData) {
      const resolved = resolveBtcr2SenderPk(did);
      expect(resolved, did).to.be.instanceOf(CompressedSecp256k1PublicKey);
      expect(hex.encode(resolved!.compressed), did).to.equal(hex.encode(genesisBytes));

      // A genesisDocument argument is ignored for a KEY identifier.
      const withGenesis = resolveBtcr2SenderPk(did, { genesisDocument: external.genesisDocument });
      expect(hex.encode(withGenesis!.compressed), did).to.equal(hex.encode(genesisBytes));
    }
  });

  it('resolves an EXTERNAL (x1) DID to its capabilityInvocation[0] key when the genesis matches', () => {
    for(const { did, secretKey, genesisDocument } of externalData) {
      const resolved = resolveBtcr2SenderPk(did, { genesisDocument });
      expect(resolved, did).to.be.instanceOf(CompressedSecp256k1PublicKey);
      expect(hex.encode(resolved!.compressed), did).to.equal(derivePkHex(secretKey));
    }
  });

  it('returns undefined for an EXTERNAL (x1) DID with no genesis document (1-arg unchanged)', () => {
    for(const { did } of externalData) {
      expect(resolveBtcr2SenderPk(did), did).to.equal(undefined);
    }
  });

  it('returns undefined when the supplied genesis does not hash to the x1 DID', () => {
    // fixture[0]'s DID paired with fixture[1]'s genesis document: the hash commitment fails.
    const resolved = resolveBtcr2SenderPk(externalData[0].did, { genesisDocument: externalData[1].genesisDocument });
    expect(resolved).to.equal(undefined);
  });

  it('returns undefined for an x1 DID whose genesis has no capabilityInvocation', () => {
    // Build a genesis that is well-formed but lacks capabilityInvocation, then mint the DID
    // that commits to exactly that document so the hash check passes and only the missing
    // communication key rejects it.
    const genesis: Record<string, unknown> = structuredClone(external.genesisDocument);
    delete genesis.capabilityInvocation;
    const genesisBytes = GenesisDocument.toGenesisBytes(genesis as GenesisDocumentLike);
    const did = DidBtcr2.create(genesisBytes, { idType: 'EXTERNAL', network: external.network });
    expect(resolveBtcr2SenderPk(did, { genesisDocument: genesis })).to.equal(undefined);
  });

  it('returns undefined for an x1 DID whose genesis has no "@context"', () => {
    // The DID commits to this genesis, so the hash check passes. A DID document must have
    // "@context", so the genesis does not resolve and gives no communication key.
    const genesis: Record<string, unknown> = structuredClone(external.genesisDocument);
    delete genesis['@context'];
    const genesisBytes = GenesisDocument.toGenesisBytes(genesis as GenesisDocumentLike);
    const did = DidBtcr2.create(genesisBytes, { idType: 'EXTERNAL', network: external.network });
    expect(() => Resolver.external(Identifier.decode(did), genesis)).to.throw('Invalid "@context"');
    expect(resolveBtcr2SenderPk(did, { genesisDocument: genesis })).to.equal(undefined);
  });

  it('resolves an x1 DID whose genesis has no service to its capabilityInvocation[0] key', () => {
    // The service member is optional. The communication key does not need a service.
    const genesis: Record<string, unknown> = structuredClone(external.genesisDocument);
    delete genesis.service;
    const genesisBytes = GenesisDocument.toGenesisBytes(genesis as GenesisDocumentLike);
    const did = DidBtcr2.create(genesisBytes, { idType: 'EXTERNAL', network: external.network });
    const resolved = resolveBtcr2SenderPk(did, { genesisDocument: genesis });
    expect(resolved).to.be.instanceOf(CompressedSecp256k1PublicKey);
    expect(hex.encode(resolved!.compressed)).to.equal(derivePkHex(external.secretKey));
  });

  it('returns undefined for an x1 DID whose capabilityInvocation[0] has the type JsonWebKey2020 and a valid zQ3s key', () => {
    const genesis = structuredClone(external.genesisDocument);
    genesis.verificationMethod[0]!.type = 'JsonWebKey2020';
    const genesisBytes = GenesisDocument.toGenesisBytes(genesis as GenesisDocumentLike);
    const did = DidBtcr2.create(genesisBytes, { idType: 'EXTERNAL', network: external.network });
    // The genesis document resolves: the document can hold a method of any type. The method
    // cannot sign an update, so it gives no communication key.
    expect(Resolver.external(Identifier.decode(did), genesis).verificationMethod![0]!.type).to.equal('JsonWebKey2020');
    expect(resolveBtcr2SenderPk(did, { genesisDocument: genesis })).to.equal(undefined);
  });

  it('returns undefined for a non-did:btcr2 or undecodable identifier', () => {
    expect(resolveBtcr2SenderPk('did:example:123')).to.equal(undefined);
    expect(resolveBtcr2SenderPk('not-a-did', { genesisDocument: external.genesisDocument })).to.equal(undefined);
  });
});

describe('getAggregationCommunicationKey', () => {
  const controller = 'did:btcr2:x1example';
  const vmId = `${controller}#key-0`;
  const publicKeyMultibase = external.genesisDocument.verificationMethod[0].publicKeyMultibase;
  const vm = { id: vmId, type: 'Multikey', controller, publicKeyMultibase };
  const expectedPkHex = derivePkHex(external.secretKey);

  it('resolves a string capabilityInvocation reference against verificationMethod', () => {
    const doc = { id: controller, verificationMethod: [vm], capabilityInvocation: [vmId] } as unknown as DidDocument;
    expect(hex.encode(getAggregationCommunicationKey(doc).compressed)).to.equal(expectedPkHex);
  });

  it('uses an embedded capabilityInvocation verification method directly', () => {
    const doc = { id: controller, verificationMethod: [], capabilityInvocation: [vm] } as unknown as DidDocument;
    expect(hex.encode(getAggregationCommunicationKey(doc).compressed)).to.equal(expectedPkHex);
  });

  it('throws when capabilityInvocation is absent (no verificationMethod[0] fallback)', () => {
    const doc = { id: controller, verificationMethod: [vm] } as unknown as DidDocument;
    expect(() => getAggregationCommunicationKey(doc)).to.throw(/capabilityInvocation/);
  });

  it('throws when the capabilityInvocation reference does not resolve to a verification method', () => {
    const doc = { id: controller, verificationMethod: [], capabilityInvocation: [vmId] } as unknown as DidDocument;
    expect(() => getAggregationCommunicationKey(doc)).to.throw(/verification method/);
  });

  // Either the reference or the method id may be a relative DID URL (ADR 092): both are
  // resolved against the document before comparison, so all four pairings resolve.
  it('resolves either spelling of the reference against either spelling of the method id', () => {
    const relativeVm = { ...vm, id: '#key-0' };
    const pairings: Array<[typeof vm, string]> = [
      [vm, vmId],
      [vm, '#key-0'],
      [relativeVm, vmId],
      [relativeVm, '#key-0'],
    ];
    for(const [method, reference] of pairings) {
      const doc = {
        id                   : controller,
        verificationMethod   : [method],
        capabilityInvocation : [reference],
      } as unknown as DidDocument;
      expect(
        hex.encode(getAggregationCommunicationKey(doc).compressed),
        `method ${method.id} / reference ${reference}`
      ).to.equal(expectedPkHex);
    }
  });

  it('does not resolve a reference naming a different subject', () => {
    const doc = {
      id                   : controller,
      verificationMethod   : [{ ...vm, id: '#key-0' }],
      capabilityInvocation : ['did:btcr2:x1other#key-0'],
    } as unknown as DidDocument;
    expect(() => getAggregationCommunicationKey(doc)).to.throw(/verification method/);
  });

  /**
   * Expect the INVALID_DID_DOCUMENT error of the method check for `field`, with `message`.
   * The data names the capabilityInvocation entry: a reference or an embedded method.
   */
  function expectMethodRefused(
    doc: DidDocument, invocation: unknown, field: string, message: string, cause?: { type: string; message: string }
  ): void {
    let thrown: any;
    try {
      getAggregationCommunicationKey(doc);
    } catch(error) {
      thrown = error;
    }
    expect(thrown, 'expected a refusal').to.be.instanceOf(DidDocumentError);
    expect(thrown.type).to.equal(INVALID_DID_DOCUMENT);
    expect(thrown.message).to.equal(`Cannot derive aggregation communication key: verificationMethod.${message}`);
    // The method of the entry: the embedded object, or the member that the reference names.
    const method = typeof invocation === 'string'
      ? doc.verificationMethod?.find(member => member.id === invocation)
      : invocation;
    const actual = (method as Record<string, unknown> | undefined)?.[field];
    expect(thrown.data).to.deep.include({ id: controller, invocation, field, actual });
    expect(thrown.data.cause).to.deep.equal(cause);
  }

  it('throws for a referenced method of the type JsonWebKey2020 with a valid zQ3s key', () => {
    const doc = {
      id                   : controller,
      verificationMethod   : [{ ...vm, type: 'JsonWebKey2020' }],
      capabilityInvocation : [vmId],
    } as unknown as DidDocument;
    expectMethodRefused(doc, vmId, 'type', 'type must equal "Multikey"');
  });

  it('throws for an embedded Multikey method whose controller is another DID', () => {
    const embedded = { ...vm, controller: 'did:btcr2:x1other' };
    const doc = {
      id                   : controller,
      verificationMethod   : [],
      capabilityInvocation : [embedded],
    } as unknown as DidDocument;
    expectMethodRefused(doc, embedded, 'controller', `controller must equal "${controller}"`);
  });

  it('throws for other text for the key that the decoder reads as the same key', () => {
    // U+0100 after the `z` header: the base58btc decoder of the cryptosuite ignores it and
    // reads the same 35 bytes. Only the base58btc text of the key is a valid key value.
    const otherText = `z\u0100${publicKeyMultibase.slice(1)}`;
    const doc = {
      id                   : controller,
      verificationMethod   : [{ ...vm, publicKeyMultibase: otherText }],
      capabilityInvocation : [vmId],
    } as unknown as DidDocument;
    expectMethodRefused(doc, vmId, 'publicKeyMultibase',
      'publicKeyMultibase must encode a secp256k1 public key as a BIP340 Multikey: '
      + 'Invalid publicKeyMultibase: not the base58btc encoding of the key', {
        type    : VERIFICATION_METHOD_ERROR,
        message : 'Invalid publicKeyMultibase: not the base58btc encoding of the key'
      });
  });

  it('resolves the query reference "?key=0" against the method id "<did>?key=0", and the reverse spelling', () => {
    const queryId = `${controller}?key=0`;
    for(const [ methodId, reference ] of [ [ queryId, '?key=0' ], [ '?key=0', queryId ] ]) {
      const doc = {
        id                   : controller,
        verificationMethod   : [{ ...vm, id: methodId }],
        capabilityInvocation : [reference],
      } as unknown as DidDocument;
      expect(
        hex.encode(getAggregationCommunicationKey(doc).compressed),
        `method ${methodId} / reference ${reference}`
      ).to.equal(expectedPkHex);
    }
  });

  it('matches the reference "" with the method id "": both resolve to the DID (RFC 3986, section 5.2.2)', () => {
    const doc = {
      id                   : controller,
      verificationMethod   : [{ ...vm, id: '' }],
      capabilityInvocation : [''],
    } as unknown as DidDocument;
    expect(hex.encode(getAggregationCommunicationKey(doc).compressed)).to.equal(expectedPkHex);
  });

  it('does not match a reference with a method id if the document id is not a string', () => {
    // A document id that is not a string gives no absolute DID URL, so no reference names a method.
    const doc = {
      id                   : 42,
      verificationMethod   : [{ ...vm, id: '' }],
      capabilityInvocation : [''],
    } as unknown as DidDocument;
    expect(() => getAggregationCommunicationKey(doc)).to.throw(/does not resolve to a verification method/);
  });
});

describe('x1 genesis hash commitment (round-trip)', () => {
  it('the DID re-encodes from the canonical hash of its genesis document', () => {
    for(const { did, network, genesisBytes, genesisDocument } of externalData) {
      const hashed = GenesisDocument.toGenesisBytes(genesisDocument as GenesisDocumentLike);
      expect(hex.encode(hashed), did).to.equal(hex.encode(genesisBytes));
      expect(DidBtcr2.create(hashed, { idType: 'EXTERNAL', network }), did).to.equal(did);
    }
  });
});
