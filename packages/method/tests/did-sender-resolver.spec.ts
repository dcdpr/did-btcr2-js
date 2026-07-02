import { expect } from 'chai';
import { hex } from '@scure/base';
import { CompressedSecp256k1PublicKey, SchnorrKeyPair } from '@did-btcr2/keypair';
import { DidBtcr2 } from '../src/did-btcr2.js';
import { getAggregationCommunicationKey, resolveBtcr2SenderPk } from '../src/core/did-sender-resolver.js';
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
