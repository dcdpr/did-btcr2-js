import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import type { Signer } from '@did-btcr2/keypair';
import { LocalSigner } from '@did-btcr2/keypair';
import { hexToBytes } from '@noble/hashes/utils';
import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import type { BeaconService, BeaconSignal } from '../src/core/beacon/interfaces.js';
import type { NeedBeaconSignals } from '../src/core/resolver.js';
import { Updater } from '../src/core/updater.js';
import type { NeedBroadcast, NeedFunding, NeedSigningKey } from '../src/core/updater.js';
import type { Btcr2DidDocument } from '../src/utils/did-document.js';
import data from './data/deterministic-data.js';

/**
 * Resolve a DID to obtain its current document for use as an Updater source.
 * Uses the sans-I/O Resolver with empty beacon signals (no on-chain updates).
 */
function resolveCurrentDocument(did: string): Btcr2DidDocument {
  const resolver = DidBtcr2.resolve(did);
  const state = resolver.resolve();
  if(state.status !== 'action-required') {
    throw new Error(`Expected action-required, got ${state.status}`);
  }
  resolver.provide(
    state.needs[0] as NeedBeaconSignals,
    new Map<BeaconService, Array<BeaconSignal>>()
  );
  const final = resolver.resolve();
  if(final.status !== 'resolved') {
    throw new Error(`Expected resolved, got ${final.status}`);
  }
  return final.result.didDocument as Btcr2DidDocument;
}

describe('Updater', () => {
  const fixture = data[0]!;
  const did = fixture.did;
  const secretKey = hexToBytes(fixture.secretKey);
  const signer = new LocalSigner(secretKey);

  let sourceDocument: Btcr2DidDocument;
  let verificationMethodId: string;
  let beaconId: string;

  before(() => {
    sourceDocument = resolveCurrentDocument(did);
    verificationMethodId = sourceDocument.verificationMethod?.[0]?.id as string;
    beaconId = sourceDocument.service?.[0]?.id as string;
  });

  describe('factory (DidBtcr2.update)', () => {
    it('returns an Updater instance', () => {
      const updater = DidBtcr2.update({
        sourceDocument,
        patches         : [],
        sourceVersionId : 1,
        verificationMethodId,
        beaconId,
      });
      expect(updater).to.exist;
      expect(updater).to.have.property('advance');
      expect(updater).to.have.property('provide');
    });

    it('throws if verificationMethodId is not in capabilityInvocation', () => {
      expect(() => DidBtcr2.update({
        sourceDocument,
        patches              : [],
        sourceVersionId      : 1,
        verificationMethodId : `${did}#not-a-real-key`,
        beaconId,
      })).to.throw(/capabilityInvocation/i);
    });

    it('throws if beaconId does not match any service', () => {
      expect(() => DidBtcr2.update({
        sourceDocument,
        patches         : [],
        sourceVersionId : 1,
        verificationMethodId,
        beaconId        : `${did}#nonexistent-beacon`,
      })).to.throw(/No beacon service found/i);
    });
  });

  describe('state machine (advance / provide)', () => {
    let updater: Updater;

    beforeEach(() => {
      updater = DidBtcr2.update({
        sourceDocument,
        patches         : [],
        sourceVersionId : 1,
        verificationMethodId,
        beaconId,
      });
    });

    it('first advance() emits NeedSigningKey', () => {
      const state = updater.advance();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs).to.have.length(1);
      expect(state.needs[0]!.kind).to.equal('NeedSigningKey');
      const need = state.needs[0] as NeedSigningKey;
      expect(need.verificationMethodId).to.equal(verificationMethodId);
      expect(need.unsignedUpdate).to.have.property('targetVersionId', 2);
      expect(need.unsignedUpdate).to.have.property('sourceHash').that.is.a('string');
      expect(need.unsignedUpdate).to.have.property('targetHash').that.is.a('string');
    });

    it('after signing, advance() emits NeedFunding with the beacon address', () => {
      let state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      updater.provide(state.needs[0] as NeedSigningKey, signer);

      state = updater.advance();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs).to.have.length(1);
      expect(state.needs[0]!.kind).to.equal('NeedFunding');

      const fundingNeed = state.needs[0] as NeedFunding;
      expect(fundingNeed.beaconAddress).to.be.a('string').with.length.greaterThan(0);
      expect(fundingNeed.beaconService.id).to.equal(beaconId);
      // beaconAddress should be the serviceEndpoint minus the 'bitcoin:' prefix
      const expectedAddress = sourceDocument.service![0]!.serviceEndpoint.replace('bitcoin:', '');
      expect(fundingNeed.beaconAddress).to.equal(expectedAddress);
    });

    it('after funding, advance() emits NeedBroadcast with the signed update', () => {
      // Sign
      let state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      updater.provide(state.needs[0] as NeedSigningKey, signer);

      // Fund
      state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      updater.provide(state.needs[0] as NeedFunding);

      // Should now be at Broadcast
      state = updater.advance();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs).to.have.length(1);
      expect(state.needs[0]!.kind).to.equal('NeedBroadcast');

      const broadcastNeed = state.needs[0] as NeedBroadcast;
      expect(broadcastNeed.beaconService.id).to.equal(beaconId);
      expect(broadcastNeed.signedUpdate).to.have.property('proof');
      expect(broadcastNeed.signedUpdate.proof).to.have.property('proofValue').that.is.a('string');
    });

    it('NeedFunding accepts a FundingProof with utxoCount >= 1', () => {
      // Sign
      let state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      updater.provide(state.needs[0] as NeedSigningKey, signer);

      // Fund with explicit proof - should transition to Broadcast cleanly.
      state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      updater.provide(state.needs[0] as NeedFunding, { utxoCount: 1, txid: 'aa'.repeat(32) });

      state = updater.advance();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs[0]!.kind).to.equal('NeedBroadcast');
    });

    it('NeedFunding rejects a FundingProof with utxoCount < 1', () => {
      // Sign
      let state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      updater.provide(state.needs[0] as NeedSigningKey, signer);

      // Fund with falsy proof - caller claims no UTXOs available; state machine rejects.
      state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      expect(() =>
        updater.provide(state.needs[0] as NeedFunding, { utxoCount: 0 })
      ).to.throw(/utxoCount >= 1/);
    });

    it('completes after full Construct -> Sign -> Fund -> Broadcast cycle', () => {
      // Sign
      let state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      updater.provide(state.needs[0] as NeedSigningKey, signer);

      // Fund
      state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      updater.provide(state.needs[0] as NeedFunding);

      // Broadcast
      state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      const broadcastNeed = state.needs[0] as NeedBroadcast;
      updater.provide(broadcastNeed);

      // Complete
      state = updater.advance();
      expect(state.status).to.equal('complete');
      if(state.status !== 'complete') return;
      expect(state.result.signedUpdate).to.have.property('proof');
      expect(state.result.signedUpdate).to.deep.equal(broadcastNeed.signedUpdate);
    });

    // ── Error paths ──────────────────────────────────────────────────────

    it('provide(NeedSigningKey) throws if called before advance()', () => {
      const bogusNeed: NeedSigningKey = {
        kind                 : 'NeedSigningKey',
        verificationMethodId,
        unsignedUpdate       : {} as never,
      };
      expect(() => updater.provide(bogusNeed, signer)).to.throw(/phase/i);
    });

    it('provide(NeedSigningKey) throws without data', () => {
      const state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      const signingNeed = state.needs[0] as NeedSigningKey;
      // @ts-expect-error - deliberately omitting data
      expect(() => updater.provide(signingNeed)).to.throw(/Signer/i);
    });

    it('provide(NeedSigningKey) throws when the signer does not match the verification method', () => {
      // Drives the same guard through the state-machine path the api and cli use.
      const state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      const wrongSigner = new LocalSigner(new Uint8Array(32).fill(0x42));
      expect(() => updater.provide(state.needs[0] as NeedSigningKey, wrongSigner))
        .to.throw(/does not match verification method/i);
    });

    it('provide(NeedFunding) throws if called before signing is done', () => {
      const bogusFunding: NeedFunding = {
        kind          : 'NeedFunding',
        beaconAddress : 'bc1q...',
        beaconService : sourceDocument.service![0]! as BeaconService,
      };
      expect(() => updater.provide(bogusFunding)).to.throw(/phase/i);
    });

    it('provide(NeedBroadcast) throws if called before funding is done', () => {
      // Advance through signing only
      let state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      updater.provide(state.needs[0] as NeedSigningKey, signer);

      // Skip funding - try to provide broadcast directly
      const bogusBroadcast: NeedBroadcast = {
        kind          : 'NeedBroadcast',
        beaconService : sourceDocument.service![0]! as BeaconService,
        signedUpdate  : {} as never,
      };
      expect(() => updater.provide(bogusBroadcast)).to.throw(/phase/i);
    });
  });

  describe('static utility methods', () => {
    it('Updater.construct() builds an unsigned update with correct fields', () => {
      const unsigned = Updater.construct(sourceDocument, [], 1);
      expect(unsigned).to.have.property('targetVersionId', 2);
      expect(unsigned).to.have.property('sourceHash').that.is.a('string');
      expect(unsigned).to.have.property('targetHash').that.is.a('string');
      expect(unsigned).to.have.property('patch').that.is.an('array');
    });

    it('Updater.sign() produces a signed update with a proof', () => {
      const unsigned = Updater.construct(sourceDocument, [], 1);
      const vm = sourceDocument.verificationMethod![0]!;
      const signed = Updater.sign(sourceDocument.id, unsigned, vm, signer);
      expect(signed).to.have.property('proof');
      expect(signed.proof).to.have.property('proofValue').that.is.a('string');
      expect(signed.proof).to.have.property('cryptosuite', 'bip340-jcs-2025');
    });
  });

  describe('signer round-trip (cryptographic verification)', () => {
    it('Updater.sign produces a proof that the cryptosuite verifier accepts', () => {
      const unsigned = Updater.construct(sourceDocument, [], 1);
      const vm = sourceDocument.verificationMethod![0]!;
      const signed = Updater.sign(sourceDocument.id, unsigned, vm, signer);

      // Reconstruct the verifier from the verification method's publicKeyMultibase
      // (the same path a remote resolver would take).
      const verifierMultikey = SchnorrMultikey.fromVerificationMethod(vm);
      const cryptosuite = verifierMultikey.toCryptosuite();
      const result = cryptosuite.verifyProof(signed);

      expect(result.verified).to.be.true;
    });

    it('Updater.sign throws when the signer does not match the verification method', () => {
      const unsigned = Updater.construct(sourceDocument, [], 1);
      const vm = sourceDocument.verificationMethod![0]!;

      // Sign with a key that does NOT match the method's published publicKeyMultibase.
      // The guard fails fast here, before an unverifiable proof is produced and an
      // on-chain announcement wasted.
      const wrongSigner = new LocalSigner(new Uint8Array(32).fill(0x42));
      expect(() => Updater.sign(sourceDocument.id, unsigned, vm, wrongSigner))
        .to.throw(/does not match verification method/i);
    });

    it('verifier still rejects a self-consistent proof made by a key other than the document\'s', () => {
      // Defense in depth: even when a proof is internally consistent (the signer's
      // key matches the method it was signed against), a resolver verifying against
      // the document's actual published key rejects a proof an attacker signed with
      // their own key while claiming the document's verification method id.
      const unsigned = Updater.construct(sourceDocument, [], 1);
      const realVm = sourceDocument.verificationMethod![0]!;
      const fragment = realVm.id.slice(realVm.id.indexOf('#'));

      const wrongSigner = new LocalSigner(new Uint8Array(32).fill(0x42));
      const attackerKey = SchnorrMultikey
        .fromSigner(fragment, realVm.controller, wrongSigner)
        .publicKey.multibase.encoded;
      // A method that legitimately matches the attacker's key, so the sign guard passes.
      const attackerVm = { ...realVm, publicKeyMultibase: attackerKey };
      const signed = Updater.sign(sourceDocument.id, unsigned, attackerVm, wrongSigner);

      // The resolver checks against the document's REAL published key, which rejects it.
      const verifier = SchnorrMultikey.fromVerificationMethod(realVm).toCryptosuite();
      expect(verifier.verifyProof(signed).verified).to.be.false;
    });

    it('cross-signer parity: LocalSigner and inline literal Signer both produce verifiable proofs', () => {
      const vm = sourceDocument.verificationMethod![0]!;
      const verifierMultikey = SchnorrMultikey.fromVerificationMethod(vm);
      const cryptosuite = verifierMultikey.toCryptosuite();

      // Path A: LocalSigner.
      const unsigned1 = Updater.construct(sourceDocument, [], 1);
      const signedA = Updater.sign(sourceDocument.id, unsigned1, vm, signer);

      // Path B: inline literal Signer wrapping the same secret key.
      // Proves the Updater chain doesn't have LocalSigner-specific logic.
      const customSigner: Signer = {
        publicKey : signer.publicKey,
        sign      : (data, scheme, opts) => signer.sign(data, scheme, opts),
      };
      const unsigned2 = Updater.construct(sourceDocument, [], 1);
      const signedB = Updater.sign(sourceDocument.id, unsigned2, vm, customSigner);

      // Both proofs verify against the same verification method.
      // (BIP-340 schnorr uses random aux_rand; signatures themselves differ.)
      expect(cryptosuite.verifyProof(signedA).verified).to.be.true;
      expect(cryptosuite.verifyProof(signedB).verified).to.be.true;
    });

    it('state machine end-to-end: provide(NeedSigningKey, signer) yields a verifiable signed update', () => {
      const updater = DidBtcr2.update({
        sourceDocument,
        patches         : [],
        sourceVersionId : 1,
        verificationMethodId,
        beaconId,
      });

      // Construct -> Sign
      let state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      updater.provide(state.needs[0] as NeedSigningKey, signer);

      // Fund -> Broadcast (skipped - no actual I/O in unit tests)
      state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      updater.provide(state.needs[0] as NeedFunding);

      state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      const broadcastNeed = state.needs[0] as NeedBroadcast;

      // Verify the signed update produced by the state machine.
      const vm = sourceDocument.verificationMethod![0]!;
      const verifierMultikey = SchnorrMultikey.fromVerificationMethod(vm);
      const cryptosuite = verifierMultikey.toCryptosuite();
      expect(cryptosuite.verifyProof(broadcastNeed.signedUpdate).verified).to.be.true;
    });
  });

  describe('sans-I/O: no async work during advance()', () => {
    it('advance() is synchronous (returns UpdaterState, not Promise)', () => {
      const updater = DidBtcr2.update({
        sourceDocument,
        patches         : [],
        sourceVersionId : 1,
        verificationMethodId,
        beaconId,
      });
      const state = updater.advance();
      expect(state).to.not.have.property('then');
      expect(state).to.have.property('status');
    });
  });
});
