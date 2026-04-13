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
      updater.provide(state.needs[0] as NeedSigningKey, secretKey);

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
      updater.provide(state.needs[0] as NeedSigningKey, secretKey);

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

    it('completes after full Construct → Sign → Fund → Broadcast cycle', () => {
      // Sign
      let state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      updater.provide(state.needs[0] as NeedSigningKey, secretKey);

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
      expect(() => updater.provide(bogusNeed, secretKey)).to.throw(/phase/i);
    });

    it('provide(NeedSigningKey) throws without data', () => {
      const state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      const signingNeed = state.needs[0] as NeedSigningKey;
      // @ts-expect-error — deliberately omitting data
      expect(() => updater.provide(signingNeed)).to.throw(/secret key/i);
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
      updater.provide(state.needs[0] as NeedSigningKey, secretKey);

      // Skip funding — try to provide broadcast directly
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
      const signed = Updater.sign(sourceDocument.id, unsigned, vm, secretKey);
      expect(signed).to.have.property('proof');
      expect(signed.proof).to.have.property('proofValue').that.is.a('string');
      expect(signed.proof).to.have.property('cryptosuite', 'bip340-jcs-2025');
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
