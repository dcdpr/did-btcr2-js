import { canonicalHash, INVALID_DID_UPDATE, JSONPatch, KeyManagerError, UpdateError, VERIFICATION_METHOD_ERROR } from '@did-btcr2/common';
import type { PatchOperation } from '@did-btcr2/common';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import type { Signer } from '@did-btcr2/keypair';
import { CompressedSecp256k1PublicKey, LocalSigner } from '@did-btcr2/keypair';
import { p256 } from '@noble/curves/nist.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hexToBytes } from '@noble/hashes/utils';
import { base58, base64urlnopad } from '@scure/base';
import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import type { BeaconService, BeaconSignal } from '../src/core/beacon/interfaces.js';
import type { DidResolutionResponse, NeedBeaconSignals } from '../src/core/resolver.js';
import type { SignedBTCR2Update, UnsignedBTCR2Update } from '../src/core/btcr2-update.js';
import { BTCR2_UPDATE_CONTEXT, DEACTIVATION_PATCH } from '../src/core/btcr2-update.js';
import { Updater } from '../src/core/updater.js';
import type { NeedBroadcast, NeedFunding, NeedSigningKey } from '../src/core/updater.js';
import { DidVerificationMethod } from '../src/utils/did-document.js';
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

    /** Call the factory and return what it threw, or undefined. */
    function factoryThrows(params: Record<string, unknown>): any {
      try {
        DidBtcr2.update({ sourceDocument, patches: [], sourceVersionId: 1, verificationMethodId, beaconId, ...params } as any);
        return undefined;
      } catch(error) {
        return error;
      }
    }

    it('an unauthorized verificationMethodId fails with UpdateError of type INVALID_DID_UPDATE (ADR 112)', () => {
      const thrown = factoryThrows({ verificationMethodId: `${did}#not-a-real-key` });
      expect(thrown).to.be.instanceOf(UpdateError);
      expect(thrown.type).to.equal(INVALID_DID_UPDATE);
      expect(thrown.message).to.match(/not authorized for capabilityInvocation/);
    });

    it('a capabilityInvocation reference with no verificationMethod member fails with INVALID_DID_UPDATE (ADR 112)', () => {
      const document = {
        ...sourceDocument,
        capabilityInvocation : [ ...(sourceDocument.capabilityInvocation ?? []), `${did}#ghost` ]
      } as Btcr2DidDocument;
      const thrown = factoryThrows({ sourceDocument: document, verificationMethodId: `${did}#ghost` });
      expect(thrown).to.be.instanceOf(UpdateError);
      expect(thrown.type).to.equal(INVALID_DID_UPDATE);
      expect(thrown.message).to.match(/not found in source document/);
    });

    it('accepts a verification method that capabilityInvocation embeds and verificationMethod does not list (ADR 112)', () => {
      const secret = new Uint8Array(32);
      secret[31] = 5;
      const embedded = new DidVerificationMethod({
        id                 : `${did}#embedded`,
        type               : 'Multikey',
        controller         : did,
        publicKeyMultibase : new CompressedSecp256k1PublicKey(secp256k1.getPublicKey(secret, true)).multibase.encoded,
      });
      const document = {
        ...sourceDocument,
        capabilityInvocation : [ ...(sourceDocument.capabilityInvocation ?? []), { ...embedded } ]
      } as Btcr2DidDocument;
      const updater = DidBtcr2.update({
        sourceDocument       : document,
        patches              : [],
        sourceVersionId      : 1,
        verificationMethodId : `${did}#embedded`,
        beaconId,
      });
      let state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      expect((state.needs[0] as NeedSigningKey).verificationMethodId).to.equal(`${did}#embedded`);
      updater.provide(state.needs[0] as NeedSigningKey, new LocalSigner(secret));
      state = updater.advance();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs[0]!.kind).to.equal('NeedFunding');
    });

    for(const bad of [ 0, -1, 1.5, Number.NaN, undefined, '1' ]) {
      it(`refuses sourceVersionId ${String(bad)} with INVALID_DID_UPDATE (ADR 112)`, () => {
        const thrown = factoryThrows({ sourceVersionId: bad });
        expect(thrown).to.be.instanceOf(UpdateError);
        expect(thrown.type).to.equal(INVALID_DID_UPDATE);
        expect(thrown.message).to.match(/sourceVersionId/);
      });
    }
  });

  describe('strict patch, proof verification before funding, and deactivate (ADR 112)', () => {
    it('Updater.construct refuses a patch that removes a missing path, and carries the patch error as the cause', () => {
      let thrown: any;
      try {
        Updater.construct(sourceDocument, [{ op: 'remove', path: '/nothingHere' }], 1);
      } catch(error) {
        thrown = error;
      }
      expect(thrown).to.be.instanceOf(UpdateError);
      expect(thrown.type).to.equal(INVALID_DID_UPDATE);
      expect(thrown.message).to.match(/Invalid patch: .*at operation 0 \(remove \/nothingHere\)/);
      expect(thrown.data.cause.type).to.equal('JSON_PATCH_APPLY_ERROR');
    });

    it('Updater.construct refuses a patch whose test operation fails', () => {
      expect(() => Updater.construct(sourceDocument, [{ op: 'test', path: '/id', value: 'did:example:other' }], 1))
        .to.throw(UpdateError, /Test operation failed/);
    });

    it('the state machine refuses the same patch before it asks for a signature', () => {
      const updater = DidBtcr2.update({
        sourceDocument,
        patches         : [{ op: 'remove', path: '/nothingHere' }],
        sourceVersionId : 1,
        verificationMethodId,
        beaconId,
      });
      expect(() => updater.advance()).to.throw(UpdateError, /Invalid patch/);
    });

    it('Updater.sign refuses a signer that returns a wrong signature for the right key, before NeedFunding', () => {
      // The signer publishes the right key, so the key comparison passes; the signature it
      // returns is garbage, so the proof does not verify with the published key.
      const garbage: Signer = { publicKey: signer.publicKey, sign: () => new Uint8Array(64) };
      const updater = DidBtcr2.update({ sourceDocument, patches: [], sourceVersionId: 1, verificationMethodId, beaconId });
      const state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      let thrown: any;
      try {
        updater.provide(state.needs[0] as NeedSigningKey, garbage);
      } catch(error) {
        thrown = error;
      }
      expect(thrown).to.be.instanceOf(UpdateError);
      expect(thrown.type).to.equal(INVALID_DID_UPDATE);
      expect(thrown.message).to.match(/does not verify with the public key/);
      // The state machine stays in Sign: no funding is requested for an update that no resolver accepts.
      const again = updater.advance();
      expect(again.status).to.equal('action-required');
      if(again.status !== 'action-required') return;
      expect(again.needs[0]!.kind).to.equal('NeedSigningKey');
    });

    it('DEACTIVATION_PATCH is the predetermined patch of the specification', () => {
      expect(DEACTIVATION_PATCH).to.deep.equal({ op: 'add', path: '/deactivated', value: true });
      expect(Object.isFrozen(DEACTIVATION_PATCH)).to.equal(true);
    });

    it('DidBtcr2.deactivate returns the Updater of DidBtcr2.update with the deactivation patch', () => {
      const updater = DidBtcr2.deactivate({ sourceDocument, sourceVersionId: 1, verificationMethodId, beaconId });
      const state = updater.advance();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      const need = state.needs[0] as NeedSigningKey;
      expect(need.kind).to.equal('NeedSigningKey');
      expect(need.unsignedUpdate.patch).to.deep.equal([ { ...DEACTIVATION_PATCH } ]);
      expect(need.unsignedUpdate.targetVersionId).to.equal(2);
      expect(need.unsignedUpdate['@context']).to.deep.equal([ ...BTCR2_UPDATE_CONTEXT ]);
    });

    it('DidBtcr2.deactivate applies the factory checks of DidBtcr2.update', () => {
      expect(() => DidBtcr2.deactivate({
        sourceDocument, sourceVersionId : 1, verificationMethodId : `${did}#not-a-real-key`, beaconId
      })).to.throw(UpdateError, /not authorized for capabilityInvocation/);
    });
  });

  describe('the target document with methods of other types', () => {
    // The target document can hold a method of any type and any key. Each member of
    // verificationMethod must have a string id, type, and controller.

    it('Updater.construct accepts a patch that adds a P-256 JsonWebKey assertion method', () => {
      const secret = new Uint8Array(32);
      secret[31] = 1;
      const point = p256.getPublicKey(secret, false);
      const publicKeyJwk = { kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(point.slice(1, 33)), y: base64urlnopad.encode(point.slice(33)) };
      const method = { id: `${did}#p256`, type: 'JsonWebKey', controller: did, publicKeyJwk };
      const patch: PatchOperation[] = [
        { op: 'add', path: '/verificationMethod/-', value: method },
        { op: 'add', path: '/assertionMethod/-', value: method.id },
      ];
      const unsigned = Updater.construct(sourceDocument, patch, 1);
      const target = JSONPatch.apply(sourceDocument, patch);
      expect(target.verificationMethod[1]).to.deep.equal(method);
      expect(unsigned.targetHash).to.equal(canonicalHash(target));
    });

    it('Updater.construct refuses a patch that sets the type of a verification method to a number', () => {
      let thrown: any;
      try {
        Updater.construct(sourceDocument, [{ op: 'replace', path: '/verificationMethod/0/type', value: 42 }], 1);
      } catch(error) {
        thrown = error;
      }
      expect(thrown).to.be.instanceOf(UpdateError);
      expect(thrown.type).to.equal(INVALID_DID_UPDATE);
      expect(thrown.message).to.equal('Error validating targetDocument: Invalid "verificationMethod": verificationMethod[0] must be a map with a string id, type, and controller');
    });
  });

  describe('the embedded patch (ADR 139)', () => {
    // A later operation writes inside a value that an earlier operation added. The update
    // must embed the patch as given, and the embedded patch must give targetHash: a
    // resolver applies the JSON form of update.patch.
    function expectEmbeddedAsGiven(patch: PatchOperation[]): void {
      const given = JSON.parse(JSON.stringify(patch));
      const unsigned = Updater.construct(sourceDocument, patch, 1);
      expect(unsigned.patch).to.deep.equal(given);
      const embedded = JSON.parse(JSON.stringify(unsigned.patch));
      expect(canonicalHash(JSONPatch.apply(sourceDocument, embedded))).to.equal(unsigned.targetHash);
    }

    it('Updater.construct embeds the patch as given if a later operation removes a member of an added service', () => {
      expectEmbeddedAsGiven([
        { op: 'add', path: '/service/-', value: { ...sourceDocument.service![0]!, id: `${did}#extra`, note: 'x' } },
        { op: 'remove', path: `/service/${sourceDocument.service!.length}/note` },
      ]);
    });

    it('Updater.construct embeds the patch as given if a later operation appends to an added array', () => {
      expectEmbeddedAsGiven([
        { op: 'add', path: '/alsoKnownAs', value: [ 'https://a.example' ] },
        { op: 'add', path: '/alsoKnownAs/-', value: 'https://b.example' },
      ]);
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
        did           : sourceDocument.id,
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
      const signed = Updater.sign(sourceDocument, unsigned, vm.id, signer);
      expect(signed).to.have.property('proof');
      expect(signed.proof).to.have.property('proofValue').that.is.a('string');
      expect(signed.proof).to.have.property('cryptosuite', 'bip340-jcs-2025');
    });

    it('Updater.sign() sets proof.invocationTarget to the DID', () => {
      const unsigned = Updater.construct(sourceDocument, [], 1);
      const vm = sourceDocument.verificationMethod![0]!;
      const signed = Updater.sign(sourceDocument, unsigned, vm.id, signer);
      // Spec "Construct BTCR2 Signed Update": invocation-target is sourceDidDocument.id.
      expect(signed.proof).to.have.property('invocationTarget', sourceDocument.id);
    });

    it('Updater.construct() refuses a sourceVersionId that is not an integer of 1 or more', () => {
      for(const sourceVersionId of [ '1', 0, -1, 1.5, undefined ]) {
        let thrown: any;
        try {
          Updater.construct(sourceDocument, [], sourceVersionId as number);
        } catch(error) {
          thrown = error;
        }
        expect(thrown, String(sourceVersionId)).to.be.instanceOf(UpdateError);
        expect(thrown.type).to.equal(INVALID_DID_UPDATE);
        expect(thrown.message).to.equal('Invalid sourceVersionId: expected an integer of 1 or more.');
        expect(thrown.data).to.deep.equal({ sourceVersionId });
      }
    });

    it('Updater.construct() emits the @context array that the specification pins, in order', () => {
      const unsigned = Updater.construct(sourceDocument, [], 1);
      // The literal is the value from the specification, so this test pins the constant too.
      expect(unsigned['@context']).to.deep.equal([
        'https://w3id.org/json-ld-patch/v1',
        'https://w3id.org/zcap/v1',
        'https://w3id.org/security/data-integrity/v2',
        'https://btcr2.dev/context/v1'
      ]);
      expect(unsigned['@context']).to.deep.equal([ ...BTCR2_UPDATE_CONTEXT ]);
    });

    it('Updater.construct() gives each update its own copy of the @context array', () => {
      expect(Object.isFrozen(BTCR2_UPDATE_CONTEXT)).to.be.true;
      const first = Updater.construct(sourceDocument, [], 1);
      first['@context'].push('https://example.com/extra');
      const second = Updater.construct(sourceDocument, [], 1);
      expect(second['@context']).to.deep.equal([ ...BTCR2_UPDATE_CONTEXT ]);
    });

    it('Updater.sign() gives the proof the same @context as the update', () => {
      const unsigned = Updater.construct(sourceDocument, [], 1);
      const vm = sourceDocument.verificationMethod![0]!;
      const signed = Updater.sign(sourceDocument, unsigned, vm.id, signer);
      expect(signed.proof['@context']).to.deep.equal(signed['@context']);
      expect(signed['@context']).to.deep.equal([ ...BTCR2_UPDATE_CONTEXT ]);
    });
  });

  describe('signer round-trip (cryptographic verification)', () => {
    it('Updater.sign produces a proof that the cryptosuite verifier accepts', () => {
      const unsigned = Updater.construct(sourceDocument, [], 1);
      const vm = sourceDocument.verificationMethod![0]!;
      const signed = Updater.sign(sourceDocument, unsigned, vm.id, signer);

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
      expect(() => Updater.sign(sourceDocument, unsigned, vm.id, wrongSigner))
        .to.throw(/does not match verification method/i);
    });

    it('verifier still rejects a self-consistent proof made by a key other than the document\'s', () => {
      // Defense in depth: even when a proof is internally consistent (the signer's
      // key matches the method it was signed against), a resolver verifying against
      // the document's actual published key rejects a proof an attacker signed with
      // their own key while claiming the document's verification method id.
      const realVm = sourceDocument.verificationMethod![0]!;
      const fragment = realVm.id.slice(realVm.id.indexOf('#'));

      const wrongSigner = new LocalSigner(new Uint8Array(32).fill(0x42));
      const attackerKey = SchnorrMultikey
        .fromSigner(fragment, realVm.controller, wrongSigner)
        .publicKey.multibase.encoded;
      // A method that legitimately matches the attacker's key, so the sign guard passes. A
      // copy of the document publishes it under the id of the real method.
      const attackerVm = { ...realVm, publicKeyMultibase: attackerKey };
      const attackerDocument = { ...sourceDocument, verificationMethod: [ attackerVm ] } as Btcr2DidDocument;
      // The update must belong to the document that Updater.sign gets, so the attacker builds
      // the update from the copy.
      const unsigned = Updater.construct(attackerDocument, [], 1);
      const signed = Updater.sign(attackerDocument, unsigned, attackerVm.id, wrongSigner);

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
      const signedA = Updater.sign(sourceDocument, unsigned1, vm.id, signer);

      // Path B: inline literal Signer wrapping the same secret key.
      // Proves the Updater chain doesn't have LocalSigner-specific logic.
      const customSigner: Signer = {
        publicKey : signer.publicKey,
        sign      : (data, scheme, opts) => signer.sign(data, scheme, opts),
      };
      const unsigned2 = Updater.construct(sourceDocument, [], 1);
      const signedB = Updater.sign(sourceDocument, unsigned2, vm.id, customSigner);

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

  describe('the method that signs an update', () => {
    // Spec "Construct BTCR2 Signed Update": an entry of capabilityInvocation must identify the
    // method that signs. The method must have the type Multikey, the DID as its controller, and
    // a secp256k1 public key in the BIP340 Multikey encoding. Updater.signingMethod applies the
    // lookup and the checks. Updater.sign and DidBtcr2.update call it, so each write path
    // refuses an input with the same error. The read path uses the same message and data.
    const OTHER_DID = data[1]!.did;
    const INITIAL_KEY = `${did}#initialKey`;
    const SIGNER_ID = `${did}#signer`;
    const TYPE_RULE = 'type must equal "Multikey"';
    const CONTROLLER_RULE = `controller must equal "${did}"`;
    const KEY_RULE = 'publicKeyMultibase must encode a secp256k1 public key as a BIP340 Multikey';
    const NOT_CANONICAL = { type: VERIFICATION_METHOD_ERROR, message: 'Invalid publicKeyMultibase: not the base58btc encoding of the key' };
    const ALSO_KNOWN_AS: PatchOperation[] = [{ op: 'add', path: '/alsoKnownAs', value: [ 'https://example.com/signer' ] }];
    const RETYPE: PatchOperation[] = [{ op: 'replace', path: '/verificationMethod/0/type', value: 'JsonWebKey2020' }];

    /** An Ed25519 Multikey (multicodec 0xed01 and a 32-byte key): the z6Mk form. */
    const ED25519_KEY = `z${base58.encode(new Uint8Array([ 0xed, 0x01, ...new Uint8Array(32).fill(7) ]))}`;

    /** 35 bytes with the prefix 0xe701, the byte 0x02, and the x coordinate 5, which is not on the curve. */
    function notAPointKey(): string {
      const bytes = new Uint8Array(35);
      bytes.set([ 0xe7, 0x01, 0x02 ]);
      bytes[34] = 5;
      return `z${base58.encode(bytes)}`;
    }

    /** The publicKeyMultibase of #initialKey: the base58btc text of the fixture key. */
    function fixtureKey(): string {
      return sourceDocument.verificationMethod![0]!.publicKeyMultibase!;
    }

    /** Other text for the fixture key that the base58btc decoder of the cryptosuite reads as the same key. */
    function otherKeyText(codePoint: string): string {
      return `z${codePoint}${fixtureKey().slice(1)}`;
    }

    /** A copy of the source document of the DID: the KEY template. */
    function sourceCopy(): Btcr2DidDocument {
      return JSON.parse(JSON.stringify(sourceDocument)) as Btcr2DidDocument;
    }

    /**
     * A method with the id SIGNER_ID, the type Multikey, the DID as the controller, and the
     * fixture key. The values in `fields` replace these values. An undefined value removes the field.
     */
    function signerMethod(fields: Record<string, unknown> = {}): DidVerificationMethod {
      const method = { id: SIGNER_ID, type: 'Multikey', controller: did, publicKeyMultibase: fixtureKey(), ...fields };
      return Object.fromEntries(Object.entries(method).filter(([ , value ]) => value !== undefined)) as unknown as DidVerificationMethod;
    }

    /** A copy of the source document that lists `method` in verificationMethod and its id in capabilityInvocation. */
    function referencing(method: DidVerificationMethod): Btcr2DidDocument {
      const document = sourceCopy();
      document.verificationMethod!.push(method);
      document.capabilityInvocation!.push(method.id);
      return document;
    }

    /** A copy of the source document that embeds `method` in capabilityInvocation. */
    function embedding(method: DidVerificationMethod): Btcr2DidDocument {
      const document = sourceCopy();
      document.capabilityInvocation!.push(method);
      return document;
    }

    /** Call `fn` and return what it threw, or undefined. */
    function thrownBy(fn: () => unknown): any {
      try {
        fn();
      } catch(error) {
        return error;
      }
      return undefined;
    }

    /** An input that the write path refuses, and the error that each write path raises. */
    interface Refusal {
      /** The input, for the test title. */
      title: string;
      /** The id of the method that the caller passes. */
      methodId: string;
      /** The source document, and the message and the data of the error. */
      make: () => { document: Btcr2DidDocument; message: string; data: Record<string, unknown> };
    }

    /** The refusal of the lookup: no entry of capabilityInvocation identifies `methodId`. */
    function notAuthorized(title: string, methodId: string, build: () => Btcr2DidDocument): Refusal {
      return {
        title,
        methodId,
        make : () => {
          const document = build();
          return {
            document,
            message : 'Invalid verificationMethodId: not authorized for capabilityInvocation',
            data    : { verificationMethodId: methodId, capabilityInvocation: document.capabilityInvocation }
          };
        }
      };
    }

    /** The refusal of an id that does not resolve to a DID URL: the proof cannot name it. */
    /** The message for an id that is not under the DID `documentId`. */
    function notUnderTheDidMessage(documentId: string, methodId: string): string {
      return `Invalid verificationMethodId: expected "${documentId}" followed by a fragment, a query, or a path; `
        + `got "${methodId}".`;
    }

    /**
     * The refusal of an absolute id that is not under the DID. The document lists the method in
     * capabilityInvocation and verificationMethod, so only the id rule refuses it.
     */
    function notUnderTheDid(title: string, methodId: string, fields: Record<string, unknown> = {}): Refusal {
      return {
        title,
        methodId,
        make : () => ({
          document : referencing(signerMethod({ id: methodId, ...fields })),
          message  : notUnderTheDidMessage(did, methodId),
          data     : { verificationMethodId: methodId }
        })
      };
    }

    function notADidUrl(kind: string, methodId: string): Refusal {
      return {
        title : `${kind} "${methodId}" that the document lists in capabilityInvocation and verificationMethod`,
        methodId,
        make  : () => ({
          document : referencing(signerMethod({ id: methodId })),
          message  : `Invalid verificationMethodId: expected a DID URL or a relative DID URL that starts with "#"; got "${methodId}".`,
          data     : { verificationMethodId: methodId }
        })
      };
    }

    /** The refusal of a source document that is not an object. */
    function notAnObject(title: string, value: () => unknown): Refusal {
      return {
        title,
        methodId : '#initialKey',
        make     : () => {
          const document = value();
          return {
            document : document as Btcr2DidDocument,
            message  : 'Invalid sourceDocument: expected a DID document object.',
            data     : { sourceDocument: document }
          };
        }
      };
    }

    /** The refusal of a source document whose id is not a did:btcr2 identifier. */
    function notDidBtcr2(id: unknown): Refusal {
      return {
        title    : `a source document whose id is ${typeof id === 'string' ? `"${id}"` : String(id)}, for the id "#initialKey"`,
        methodId : '#initialKey',
        make     : () => ({
          document : { ...sourceCopy(), id } as unknown as Btcr2DidDocument,
          message  : `Expected a did:btcr2 identifier for the root capability; got "${String(id)}".`,
          data     : { did: id }
        })
      };
    }

    /** The refusal of a source document whose `field` is present and is not an array. */
    function notAnArray(field: 'capabilityInvocation' | 'verificationMethod', kind: string, value: () => unknown): Refusal {
      return {
        title    : `a source document whose ${field} is ${kind}`,
        methodId : INITIAL_KEY,
        make     : () => {
          const actual = value();
          return {
            document : { ...sourceCopy(), [field]: actual } as unknown as Btcr2DidDocument,
            message  : `Invalid sourceDocument: ${field} must be an array.`,
            data     : { field, actual }
          };
        }
      };
    }

    /** A change to the method that signs, and the condition that the changed method fails. */
    interface MethodChange {
      title: string;
      fields: () => Record<string, unknown>;
      field: 'type' | 'controller' | 'publicKeyMultibase';
      rule: string;
      cause?: { type: string; message: string };
      /** True if only the reference form applies. */
      referenceOnly?: boolean;
    }

    const METHOD_CHANGES: MethodChange[] = [
      { title: 'the type JsonWebKey2020 and a valid zQ3s key', fields: () => ({ type: 'JsonWebKey2020' }), field: 'type', rule: TYPE_RULE },
      { title: 'a controller that is another DID', fields: () => ({ controller: OTHER_DID }), field: 'controller', rule: CONTROLLER_RULE },
      // An embedded object without a controller is not a verification method, so only the
      // reference form reaches the method check. The row 'an embedded method with no
      // controller' in REFUSALS pins the lookup error of the embedded form.
      { title: 'no controller', fields: () => ({ controller: undefined }), field: 'controller', rule: CONTROLLER_RULE, referenceOnly: true },
      {
        title  : 'the key text "zQ3s" alone',
        fields : () => ({ publicKeyMultibase: 'zQ3s' }),
        field  : 'publicKeyMultibase',
        rule   : KEY_RULE,
        cause  : { type: VERIFICATION_METHOD_ERROR, message: 'Invalid publicKeyMultibase length: 3' }
      },
      {
        title  : 'a 35-byte 0xe701 key that is not a secp256k1 point',
        fields : () => ({ publicKeyMultibase: notAPointKey() }),
        field  : 'publicKeyMultibase',
        rule   : KEY_RULE,
        cause  : { type: 'CONSTRUCTOR_ERROR', message: 'Invalid argument: not a valid secp256k1 compressed point' }
      },
      {
        title  : 'an Ed25519 z6Mk key',
        fields : () => ({ publicKeyMultibase: ED25519_KEY }),
        field  : 'publicKeyMultibase',
        rule   : KEY_RULE,
        cause  : { type: VERIFICATION_METHOD_ERROR, message: 'Invalid publicKeyMultibase length: 34' }
      },
      { title: 'a key that is not a string', fields: () => ({ publicKeyMultibase: 42 }), field: 'publicKeyMultibase', rule: KEY_RULE },
      { title: 'no key', fields: () => ({ publicKeyMultibase: undefined }), field: 'publicKeyMultibase', rule: KEY_RULE },
      {
        title  : 'the key text "z" + U+0100 + the base58btc digits of the fixture key',
        fields : () => ({ publicKeyMultibase: otherKeyText('\u0100') }),
        field  : 'publicKeyMultibase',
        rule   : KEY_RULE,
        cause  : NOT_CANONICAL
      },
      {
        title  : 'the key text "z" + U+1F600 + the base58btc digits of the fixture key',
        fields : () => ({ publicKeyMultibase: otherKeyText('\u{1F600}') }),
        field  : 'publicKeyMultibase',
        rule   : KEY_RULE,
        cause  : NOT_CANONICAL
      },
    ];

    /** The refusal of the method check, for a method in `form` with `change`. */
    function methodRefusal(change: MethodChange, form: 'referenced' | 'embedded'): Refusal {
      return {
        title    : `${form === 'embedded' ? 'an' : 'a'} ${form} method with ${change.title}`,
        methodId : SIGNER_ID,
        make     : () => {
          const method = signerMethod(change.fields());
          const document = form === 'referenced' ? referencing(method) : embedding(method);
          const reason = change.cause !== undefined ? `: ${change.cause.message}` : '';
          return {
            document,
            message : `Invalid update: verificationMethod.${change.rule}${reason}`,
            data    : {
              verificationMethodId : SIGNER_ID,
              field                : change.field,
              actual               : (method as unknown as Record<string, unknown>)[change.field],
              ...(change.cause !== undefined && { cause: change.cause })
            }
          };
        }
      };
    }

    const REFUSALS: Refusal[] = [
      notAnObject('a source document that is null', () => null),
      notAnObject('a source document that is an array', () => [ sourceCopy() ]),
      notDidBtcr2('did:example:123'),
      notDidBtcr2('urn:x'),
      notDidBtcr2(''),
      notDidBtcr2(42),
      notDidBtcr2(undefined),
      notAnArray('capabilityInvocation', 'a string', () => INITIAL_KEY),
      notAnArray('capabilityInvocation', 'null', () => null),
      notAnArray('verificationMethod', 'an object', () => sourceCopy().verificationMethod![0]),
      notAuthorized('a method that only assertionMethod lists', `${did}#assert`, () => {
        const document = sourceCopy();
        document.verificationMethod!.push(signerMethod({ id: `${did}#assert` }));
        document.assertionMethod!.push(`${did}#assert`);
        return document;
      }),
      notAuthorized('a method that no verification relationship lists', `${did}#loose`, () => {
        const document = sourceCopy();
        document.verificationMethod!.push(signerMethod({ id: `${did}#loose` }));
        return document;
      }),
      {
        title    : 'a capabilityInvocation reference that names no member of verificationMethod',
        methodId : `${did}#ghost`,
        make     : () => {
          const document = sourceCopy();
          document.capabilityInvocation!.push(`${did}#ghost`);
          return { document, message: 'Invalid verificationMethodId: not found in source document', data: { verificationMethodId: `${did}#ghost` } };
        }
      },
      notADidUrl('the relative id', '?key=1'),
      notADidUrl('the relative id', '/keys/1'),
      notADidUrl('the URN', 'urn:x:1'),
      ...METHOD_CHANGES.flatMap(change => change.referenceOnly
        ? [ methodRefusal(change, 'referenced') ]
        : [ methodRefusal(change, 'referenced'), methodRefusal(change, 'embedded') ]),
      {
        title    : 'an embedded method with no controller',
        methodId : SIGNER_ID,
        make     : () => ({
          document : embedding(signerMethod({ controller: undefined })),
          message  : 'Invalid verificationMethodId: not found in source document',
          data     : { verificationMethodId: SIGNER_ID }
        })
      },
      {
        // The method of the DID is correct, but the source document names another DID. The id
        // of the method is not under sourceDocument.id.
        title    : 'a copy of the source document whose id is another DID',
        methodId : INITIAL_KEY,
        make     : () => ({
          document : { ...sourceCopy(), id: OTHER_DID } as Btcr2DidDocument,
          message  : notUnderTheDidMessage(OTHER_DID, INITIAL_KEY),
          data     : { verificationMethodId: INITIAL_KEY }
        })
      },
      notUnderTheDid(
        'a referenced method whose id and controller are under another DID',
        `${OTHER_DID}#key`, { controller: OTHER_DID }
      ),
      notUnderTheDid('a referenced method whose id is under another DID and whose controller is the DID', `${OTHER_DID}#key`),
      notUnderTheDid('the id "<did>#", with an empty fragment', `${did}#`),
      notUnderTheDid('the id "<did>?", with an empty query', `${did}?`),
      notUnderTheDid('an id under a longer DID that starts with the DID', `${did}0#key`),
      {
        title    : '#initialKey after an earlier patch changes its type to JsonWebKey2020',
        methodId : INITIAL_KEY,
        make     : () => ({
          document : JSONPatch.apply(sourceCopy(), RETYPE) as Btcr2DidDocument,
          message  : `Invalid update: verificationMethod.${TYPE_RULE}`,
          data     : { verificationMethodId: INITIAL_KEY, field: 'type', actual: 'JsonWebKey2020' }
        })
      },
      // The caller spells the id relatively. The error names the absolute id, as the proof does.
      {
        title    : '#initialKey after an earlier patch changes its type, named by the relative id "#initialKey"',
        methodId : '#initialKey',
        make     : () => ({
          document : JSONPatch.apply(sourceCopy(), RETYPE) as Btcr2DidDocument,
          message  : `Invalid update: verificationMethod.${TYPE_RULE}`,
          data     : { verificationMethodId: INITIAL_KEY, field: 'type', actual: 'JsonWebKey2020' }
        })
      },
      {
        title    : 'the relative id "#missing" that no capabilityInvocation entry lists',
        methodId : '#missing',
        make     : () => {
          const document = sourceCopy();
          return {
            document,
            message : 'Invalid verificationMethodId: not authorized for capabilityInvocation',
            data    : { verificationMethodId: `${did}#missing`, capabilityInvocation: document.capabilityInvocation }
          };
        }
      },
    ];

    /** Expect an UpdateError of the type INVALID_DID_UPDATE with the message and the data of `expected`. */
    function expectRefusal(thrown: any, expected: { message: string; data: Record<string, unknown> }): void {
      expect(thrown, 'expected the input to be refused').to.be.instanceOf(UpdateError);
      expect(thrown.type).to.equal(INVALID_DID_UPDATE);
      expect(thrown.message).to.equal(expected.message);
      expect(thrown.data).to.deep.equal(expected.data);
    }

    /** Call DidBtcr2.update for `document` and `methodId`, with the first beacon of the KEY template. */
    function updaterFor(document: Btcr2DidDocument, methodId: string): Updater {
      return DidBtcr2.update({ sourceDocument: document, patches: ALSO_KNOWN_AS, sourceVersionId: 1, verificationMethodId: methodId, beaconId });
    }

    describe('Updater.signingMethod', () => {
      it('returns #initialKey for the relative id and for the absolute id', () => {
        for(const methodId of [ '#initialKey', INITIAL_KEY ]) {
          expect(Updater.signingMethod(sourceDocument, methodId), methodId).to.deep.equal(sourceDocument.verificationMethod![0]);
        }
      });

      it('returns a method that capabilityInvocation embeds', () => {
        expect(Updater.signingMethod(embedding(signerMethod()), SIGNER_ID)).to.deep.equal(signerMethod());
      });

      it('returns the method of a bare-fragment capabilityInvocation reference that the caller names by the absolute id', () => {
        const document = sourceCopy();
        document.capabilityInvocation = [ '#initialKey' ];
        expect(Updater.signingMethod(document, INITIAL_KEY)).to.deep.equal(sourceDocument.verificationMethod![0]);
      });

      it('returns a method whose absolute id has no fragment, for the query form and the path form', () => {
        for(const methodId of [ `${did}?key=1`, `${did}/keys/1` ]) {
          const method = signerMethod({ id: methodId });
          expect(Updater.signingMethod(referencing(method), methodId), methodId).to.deep.equal(method);
        }
      });

      it('the cryptosuite decoder reads each other key text as the fixture key, so only the text check refuses it', () => {
        for(const publicKeyMultibase of [ otherKeyText('\u0100'), otherKeyText('\u{1F600}') ]) {
          const decoded = SchnorrMultikey.fromVerificationMethod(signerMethod({ publicKeyMultibase }));
          expect(decoded.publicKey.multibase.encoded).to.equal(fixtureKey());
        }
      });

      for(const refusal of REFUSALS) {
        it(`refuses ${refusal.title}`, () => {
          const expected = refusal.make();
          expectRefusal(thrownBy(() => Updater.signingMethod(expected.document, refusal.methodId)), expected);
        });
      }

      it('names the first condition that fails: the type, then the controller, then the key', () => {
        const allFail = { type: 'JsonWebKey2020', controller: OTHER_DID, publicKeyMultibase: 'zQ3s' };
        const steps: Array<[ Record<string, unknown>, string, string ]> = [
          [ allFail, 'type', TYPE_RULE ],
          [ { ...allFail, type: 'Multikey' }, 'controller', CONTROLLER_RULE ],
          [ { ...allFail, type: 'Multikey', controller: did }, 'publicKeyMultibase', `${KEY_RULE}: Invalid publicKeyMultibase length: 3` ],
        ];
        for(const [ fields, field, rule ] of steps) {
          const thrown = thrownBy(() => Updater.signingMethod(referencing(signerMethod(fields)), SIGNER_ID));
          expect(thrown).to.be.instanceOf(UpdateError);
          expect(thrown.message).to.equal(`Invalid update: verificationMethod.${rule}`);
          expect(thrown.data.field).to.equal(field);
        }
      });
    });

    describe('Updater.sign', () => {
      it('signs with a method whose absolute id has no fragment, and the proof names that id', () => {
        for(const methodId of [ `${did}?key=1`, `${did}/keys/1` ]) {
          const method = signerMethod({ id: methodId });
          const document = referencing(method);
          const signed = Updater.sign(document, Updater.construct(document, ALSO_KNOWN_AS, 1), methodId, signer);
          expect(signed.proof.verificationMethod, methodId).to.equal(methodId);
          const verifier = SchnorrMultikey.fromVerificationMethod(method).toCryptosuite();
          expect(verifier.verifyProof(signed).verified, methodId).to.equal(true);
        }
      });

      it('names the method by its absolute id in the proof if the caller passes #initialKey', () => {
        const signed = Updater.sign(sourceDocument, Updater.construct(sourceDocument, [], 1), '#initialKey', signer);
        expect(signed.proof.verificationMethod).to.equal(INITIAL_KEY);
      });

      it('takes the root capability and the invocation target from sourceDocument.id', () => {
        const signed = Updater.sign(sourceDocument, Updater.construct(sourceDocument, [], 1), INITIAL_KEY, signer);
        expect(signed.proof.capability).to.equal(`urn:zcap:root:${encodeURIComponent(sourceDocument.id)}`);
        expect(signed.proof.invocationTarget).to.equal(sourceDocument.id);
      });

      for(const refusal of REFUSALS) {
        it(`refuses ${refusal.title}, with the error of Updater.signingMethod`, () => {
          const expected = refusal.make();
          // Updater.sign checks the method before it checks the unsigned update, so the update of
          // the KEY template serves each document. For most documents, the update does not belong
          // to the document, and the error of the method check shows the order.
          const unsigned = Updater.construct(sourceDocument, ALSO_KNOWN_AS, 1);
          const thrown = thrownBy(() => Updater.sign(expected.document, unsigned, refusal.methodId, signer));
          expectRefusal(thrown, expected);
          const fromLookup = thrownBy(() => Updater.signingMethod(expected.document, refusal.methodId));
          expect(thrown.message).to.equal(fromLookup.message);
          expect(thrown.data).to.deep.equal(fromLookup.data);
        });
      }

      it('checks the method before it compares the key of the signer with the key of the method', () => {
        // The signer holds the fixture key. The other text decodes to that key, but the text
        // differs from the base58btc text of the signer key, so a key comparison would refuse it too.
        // Updater.construct refuses the text in a target document, so the update of the KEY template
        // serves: Updater.sign checks the method before it checks the unsigned update.
        const publicKeyMultibase = otherKeyText('\u0100');
        const document = referencing(signerMethod({ publicKeyMultibase }));
        const thrown = thrownBy(() => Updater.sign(document, Updater.construct(sourceDocument, [], 1), SIGNER_ID, signer));
        expect(thrown).to.be.instanceOf(UpdateError);
        expect(thrown.message).to.equal(`Invalid update: verificationMethod.${KEY_RULE}: ${NOT_CANONICAL.message}`);
        expect(thrown.data.field).to.equal('publicKeyMultibase');
        expect(thrown.message).to.not.match(/Signing key does not match/);
      });

      it('names the absolute id in the key mismatch error if the caller passes #initialKey', () => {
        const wrongSigner = new LocalSigner(new Uint8Array(32).fill(0x42));
        const thrown = thrownBy(() => Updater.sign(sourceDocument, Updater.construct(sourceDocument, [], 1), '#initialKey', wrongSigner));
        expect(thrown).to.be.instanceOf(UpdateError);
        expect(thrown.type).to.equal(INVALID_DID_UPDATE);
        expect(thrown.message).to.equal(
          `Signing key does not match verification method "${INITIAL_KEY}": the signer's public `
          + 'key differs from the method\'s published publicKeyMultibase.'
        );
        expect(thrown.data).to.deep.equal({
          verificationMethodId : INITIAL_KEY,
          expected             : fixtureKey(),
          actual               : new CompressedSecp256k1PublicKey(wrongSigner.publicKey).multibase.encoded
        });
      });

      it('wraps the error of a key manager that holds no secret key as INVALID_DID_UPDATE, with the error as the cause', () => {
        const inner = new KeyManagerError('Key is not a signing key: urn:kms:secp256k1:test', 'KEY_NOT_SIGNER');
        const watchOnly: Signer = { publicKey: signer.publicKey, sign: () => { throw inner; } };
        const thrown = thrownBy(() => Updater.sign(sourceDocument, Updater.construct(sourceDocument, [], 1), '#initialKey', watchOnly));
        expect(thrown).to.be.instanceOf(UpdateError);
        expect(thrown.type).to.equal(INVALID_DID_UPDATE);
        expect(thrown.message).to.equal(`Invalid update: cannot make the proof with "${INITIAL_KEY}": ${inner.message}`);
        expect(thrown.data).to.deep.equal({ verificationMethodId: INITIAL_KEY, cause: { type: 'KEY_NOT_SIGNER', message: inner.message } });
      });

      it('wraps a plain Error of the signer, with the name of the error as the cause type', () => {
        const failing: Signer = { publicKey: signer.publicKey, sign: () => { throw new TypeError('the device is locked'); } };
        const thrown = thrownBy(() => Updater.sign(sourceDocument, Updater.construct(sourceDocument, [], 1), INITIAL_KEY, failing));
        expect(thrown).to.be.instanceOf(UpdateError);
        expect(thrown.type).to.equal(INVALID_DID_UPDATE);
        expect(thrown.message).to.equal(`Invalid update: cannot make the proof with "${INITIAL_KEY}": the device is locked`);
        expect(thrown.data).to.deep.equal({ verificationMethodId: INITIAL_KEY, cause: { type: 'TypeError', message: 'the device is locked' } });
      });

      it('refuses a signer whose public key is not a compressed secp256k1 key, with the key error as the cause', () => {
        const cases: Array<[ Uint8Array, string ]> = [
          [ new Uint8Array(33), 'Invalid argument: not a valid secp256k1 compressed point' ],
          [ new Uint8Array(32).fill(1), 'Invalid argument: byte length must be 33 (compressed)' ],
        ];
        for(const [ publicKey, message ] of cases) {
          const badKey: Signer = { publicKey, sign: (bytes, scheme, opts) => signer.sign(bytes, scheme, opts) };
          const thrown = thrownBy(() => Updater.sign(sourceDocument, Updater.construct(sourceDocument, [], 1), '#initialKey', badKey));
          expect(thrown, message).to.be.instanceOf(UpdateError);
          expect(thrown.type).to.equal(INVALID_DID_UPDATE);
          expect(thrown.message).to.equal(`Invalid signer: ${message}`);
          expect(thrown.data).to.deep.equal({ verificationMethodId: INITIAL_KEY, cause: { type: 'CONSTRUCTOR_ERROR', message } });
        }
      });

      it('refuses a signer that returns a wrong signature for the right key, and names the absolute id', () => {
        const garbage: Signer = { publicKey: signer.publicKey, sign: () => new Uint8Array(64) };
        const thrown = thrownBy(() => Updater.sign(sourceDocument, Updater.construct(sourceDocument, [], 1), '#initialKey', garbage));
        expect(thrown).to.be.instanceOf(UpdateError);
        expect(thrown.type).to.equal(INVALID_DID_UPDATE);
        expect(thrown.message).to.equal(`Invalid update: the proof does not verify with the public key of "${INITIAL_KEY}".`);
        expect(thrown.data).to.deep.equal({ verificationMethodId: INITIAL_KEY });
      });

      it('refuses a signer that returns a signature of 63 bytes, with the verify error as the cause', () => {
        const short: Signer = { publicKey: signer.publicKey, sign: () => new Uint8Array(63) };
        const thrown = thrownBy(() => Updater.sign(sourceDocument, Updater.construct(sourceDocument, [], 1), '#initialKey', short));
        const cause = 'signature of length 64 expected, got 63';
        expect(thrown).to.be.instanceOf(UpdateError);
        expect(thrown.type).to.equal(INVALID_DID_UPDATE);
        expect(thrown.message).to.equal(`Invalid update: the proof does not verify with the public key of "${INITIAL_KEY}": ${cause}`);
        expect(thrown.data).to.deep.equal({ verificationMethodId: INITIAL_KEY, cause: { type: 'Error', message: cause } });
      });

      it('signs the update that changes the type of #initialKey, and then refuses the next update that #initialKey signs', () => {
        const source = sourceCopy();
        const retyped = Updater.sign(source, Updater.construct(source, RETYPE, 1), INITIAL_KEY, signer);
        expect(retyped.patch).to.deep.equal(RETYPE);
        const target = JSONPatch.apply(source, RETYPE) as Btcr2DidDocument;
        const thrown = thrownBy(() => Updater.sign(target, Updater.construct(target, ALSO_KNOWN_AS, 2), INITIAL_KEY, signer));
        expectRefusal(thrown, {
          message : `Invalid update: verificationMethod.${TYPE_RULE}`,
          data    : { verificationMethodId: INITIAL_KEY, field: 'type', actual: 'JsonWebKey2020' }
        });
      });
    });

    describe('Updater.sign and the unsigned update', () => {
      // A resolver refuses an announced update whose hashes do not match the documents, and then
      // the DID no longer resolves. Updater.sign refuses such an update before it signs.
      const OTHER_PATCH: PatchOperation[] = [{ op: 'add', path: '/alsoKnownAs', value: [ 'https://example.com/other' ] }];

      /** The update of the KEY template with ALSO_KNOWN_AS. The values in `fields` replace its values. */
      function updateWith(fields: Record<string, unknown>): UnsignedBTCR2Update {
        return { ...Updater.construct(sourceDocument, ALSO_KNOWN_AS, 1), ...fields } as UnsignedBTCR2Update;
      }

      /** Sign `unsigned` with #initialKey of the KEY template and return what Updater.sign threw. */
      function signThrows(unsigned: unknown, signWith: Signer = signer): any {
        return thrownBy(() => Updater.sign(sourceDocument, unsigned as UnsignedBTCR2Update, '#initialKey', signWith));
      }

      /** Resolve the DID with `update` announced on the first beacon of the KEY template. */
      function resolveWith(update: SignedBTCR2Update): DidResolutionResponse {
        const resolver = DidBtcr2.resolve(did, { sidecar: { updates: [ update ] } });
        let state = resolver.resolve();
        if(state.status !== 'action-required') throw new Error('expected action-required');
        const need = state.needs[0] as NeedBeaconSignals;
        resolver.provide(need, new Map([[ need.beaconServices[0]!, [{
          tx            : {} as any,
          signalBytes   : canonicalHash(update, { encoding: 'hex' }),
          blockMetadata : { height: 100, time: 1700000000, mediantime: 1700000000, confirmations: 6 }
        }] ]]));
        state = resolver.resolve();
        if(state.status !== 'resolved') throw new Error('expected resolved');
        return state.result;
      }

      it('refuses an unsignedUpdate that is not an object', () => {
        for(const unsigned of [ null, [ updateWith({}) ], 'update' ]) {
          expectRefusal(signThrows(unsigned), {
            message : 'Invalid unsignedUpdate: expected an object.',
            data    : { unsignedUpdate: unsigned }
          });
        }
      });

      it('refuses an unsignedUpdate with a proof member, also a proof of Updater.sign', () => {
        const signed = Updater.sign(sourceDocument, updateWith({}), '#initialKey', signer);
        for(const proof of [ signed.proof, undefined, {} ]) {
          expectRefusal(signThrows({ ...updateWith({}), proof }), {
            message : 'Invalid unsignedUpdate: an unsigned update must not have a proof.',
            data    : { field: 'proof', actual: proof }
          });
        }
        // A signed update is not an unsigned update: the caller cannot sign it again.
        expectRefusal(signThrows(signed), {
          message : 'Invalid unsignedUpdate: an unsigned update must not have a proof.',
          data    : { field: 'proof', actual: signed.proof }
        });
      });

      it('refuses a targetVersionId that is not an integer of 2 or more', () => {
        for(const targetVersionId of [ 1, 0, -2, 2.5, '2', 2n, [ 2 ], undefined ]) {
          expectRefusal(signThrows(updateWith({ targetVersionId })), {
            message : 'Invalid unsignedUpdate: targetVersionId must be an integer of 2 or more.',
            data    : { field: 'targetVersionId', actual: targetVersionId }
          });
        }
      });

      it('refuses an @context that is not the BTCR2 update context', () => {
        const contexts = [
          undefined,
          [ ...BTCR2_UPDATE_CONTEXT ].reverse(),
          [ ...BTCR2_UPDATE_CONTEXT, 'https://example.com/extra' ],
          BTCR2_UPDATE_CONTEXT.slice(0, 3),
          BTCR2_UPDATE_CONTEXT[0],
        ];
        for(const context of contexts) {
          expectRefusal(signThrows(updateWith({ '@context': context })), {
            message : 'Invalid unsignedUpdate: @context must be the BTCR2 update context.',
            data    : { field: '@context', expected: [ ...BTCR2_UPDATE_CONTEXT ], actual: context }
          });
        }
      });

      it('refuses a sourceHash that is not the hash of sourceDocument', () => {
        const other = Updater.construct(sourceDocument, ALSO_KNOWN_AS, 1).targetHash;
        for(const sourceHash of [ other, '', 42 ]) {
          expectRefusal(signThrows(updateWith({ sourceHash })), {
            message : 'Invalid unsignedUpdate: sourceHash is not the hash of sourceDocument.',
            data    : { field: 'sourceHash', expected: canonicalHash(sourceDocument), actual: sourceHash }
          });
        }
      });

      it('refuses an update that Updater.construct made from version 1 if sourceDocument is version 2', () => {
        const v2Document = JSONPatch.apply(sourceDocument, ALSO_KNOWN_AS) as Btcr2DidDocument;
        const unsignedFromV1 = Updater.construct(sourceDocument, OTHER_PATCH, 1);
        const thrown = thrownBy(() => Updater.sign(v2Document, unsignedFromV1, '#initialKey', signer));
        expectRefusal(thrown, {
          message : 'Invalid unsignedUpdate: sourceHash is not the hash of sourceDocument.',
          data    : { field: 'sourceHash', expected: canonicalHash(v2Document), actual: canonicalHash(sourceDocument) }
        });
      });

      it('refuses a patch that does not give a valid DID document, with the error of Updater.construct as the cause', () => {
        const cases: Array<[ unknown, string ]> = [
          [ undefined, 'Invalid patch: Invalid JSON Patch operations: Operations must be an array' ],
          [ { ...ALSO_KNOWN_AS[0] }, 'Invalid patch: Invalid JSON Patch operations: Operations must be an array' ],
          [
            [{ op: 'replace', path: '/id', value: OTHER_DID }],
            `Patches must not change the DID document id (source "${did}" to target "${OTHER_DID}").`
          ],
          [
            [{ op: 'replace', path: '/verificationMethod/0/type', value: 42 }],
            'Error validating targetDocument: Invalid "verificationMethod": verificationMethod[0] must be a map with a string id, type, and controller'
          ],
        ];
        for(const [ patch, inner ] of cases) {
          expectRefusal(signThrows(updateWith({ patch })), {
            message : `Invalid unsignedUpdate: the patch does not give a valid DID document from sourceDocument: ${inner}`,
            data    : { field: 'patch', cause: { type: INVALID_DID_UPDATE, message: inner } }
          });
        }
      });

      describe('a value with no JCS form (ADR 154)', () => {
        const LONE = '\ud800';
        const NAN_NOTE = 'Cannot canonicalize: the number NaN at /note is not a JSON number (RFC 8785 section 3.2.2.3).';
        const NAN_PATCH = 'Cannot canonicalize: the number NaN at /0/value is not a JSON number (RFC 8785 section 3.2.2.3).';

        /** The message of a lone surrogate at `path`. */
        function loneSurrogate(path: string): string {
          return `Cannot canonicalize: the string at ${path} has a lone surrogate (RFC 8785 section 3.2.2.2).`;
        }

        it('Updater.construct refuses a sourceDocument with no JCS form', () => {
          const thrown = thrownBy(() => Updater.construct({ ...sourceDocument, note: NaN } as Btcr2DidDocument, ALSO_KNOWN_AS, 1));
          expectRefusal(thrown, {
            message : `Invalid sourceDocument: ${NAN_NOTE}`,
            data    : { field: 'sourceDocument', cause: { type: 'NON_FINITE_NUMBER', message: NAN_NOTE } }
          });
        });

        it('Updater.sign refuses a sourceDocument with no JCS form', () => {
          const unsigned = Updater.construct(sourceDocument, ALSO_KNOWN_AS, 1);
          const thrown = thrownBy(() => Updater.sign({ ...sourceDocument, note: LONE } as Btcr2DidDocument, unsigned, '#initialKey', signer));
          expectRefusal(thrown, {
            message : `Invalid sourceDocument: ${loneSurrogate('/note')}`,
            data    : { field: 'sourceDocument', cause: { type: 'LONE_SURROGATE', message: loneSurrogate('/note') } }
          });
        });

        it('Updater.construct refuses a patch with no JCS form, also if the target document has a JCS form', () => {
          // JSONPatch.apply writes NaN as null, so the target document of the first case has a JCS form.
          const cases: Array<[ PatchOperation[], string, string ]> = [
            [ [{ op: 'add', path: '/note', value: NaN }], 'NON_FINITE_NUMBER', NAN_PATCH ],
            [ [{ op: 'add', path: '/alsoKnownAs', value: [ `https://example.com/${LONE}` ] }], 'LONE_SURROGATE', loneSurrogate('/0/value/0') ],
            [ [{ op: 'add', path: `/note${LONE}`, value: 'x' }], 'LONE_SURROGATE', loneSurrogate('/0/path') ],
          ];
          for(const [ patch, type, inner ] of cases) {
            expectRefusal(thrownBy(() => Updater.construct(sourceDocument, patch, 1)), {
              message : `Invalid patch: ${inner}`,
              data    : { cause: { type, message: inner } }
            });
          }
        });

        it('Updater.sign refuses a patch with no JCS form, with the error of Updater.construct as the cause', () => {
          const inner = `Invalid patch: ${NAN_PATCH}`;
          expectRefusal(signThrows(updateWith({ patch: [{ op: 'add', path: '/note', value: NaN }] })), {
            message : `Invalid unsignedUpdate: the patch does not give a valid DID document from sourceDocument: ${inner}`,
            data    : { field: 'patch', cause: { type: INVALID_DID_UPDATE, message: inner } }
          });
        });

        it('Updater.sign refuses an extra member with no JCS form, with the error of the cryptosuite as the cause', () => {
          const inner = `Invalid document: ${NAN_NOTE}`;
          expectRefusal(signThrows(updateWith({ note: NaN })), {
            message : `Invalid update: cannot make the proof with "${INITIAL_KEY}": ${inner}`,
            data    : { verificationMethodId: INITIAL_KEY, cause: { type: 'PROOF_TRANSFORMATION_ERROR', message: inner } }
          });
        });
      });

      it('refuses a targetHash that is not the hash of the document that the patch gives', () => {
        const unsigned = updateWith({});
        const changedPatch = updateWith({ patch: OTHER_PATCH });
        const cases: Array<[ UnsignedBTCR2Update, string, unknown ]> = [
          [ updateWith({ targetHash: unsigned.sourceHash }), unsigned.targetHash, unsigned.sourceHash ],
          [ updateWith({ targetHash: 42 }), unsigned.targetHash, 42 ],
          // The caller changes the patch after Updater.construct and keeps the old targetHash.
          [ changedPatch, Updater.construct(sourceDocument, OTHER_PATCH, 1).targetHash, unsigned.targetHash ],
        ];
        for(const [ update, expected, actual ] of cases) {
          expectRefusal(signThrows(update), {
            message : 'Invalid unsignedUpdate: targetHash is not the hash of the document that the patch gives.',
            data    : { field: 'targetHash', expected, actual }
          });
        }
      });

      it('names the first check that fails: targetVersionId, then @context, then sourceHash', () => {
        const allFail = { targetVersionId: 1, '@context': [], sourceHash: '', targetHash: '' };
        const steps: Array<[ Record<string, unknown>, unknown ]> = [
          [ allFail, 'targetVersionId' ],
          [ { ...allFail, targetVersionId: 2 }, '@context' ],
          [ { ...allFail, targetVersionId: 2, '@context': [ ...BTCR2_UPDATE_CONTEXT ] }, 'sourceHash' ],
        ];
        for(const [ fields, field ] of steps) {
          const thrown = signThrows(updateWith(fields));
          expect(thrown).to.be.instanceOf(UpdateError);
          expect(thrown.data.field).to.equal(field);
        }
      });

      it('checks the unsigned update before it compares the key of the signer with the key of the method', () => {
        const wrongSigner = new LocalSigner(new Uint8Array(32).fill(0x42));
        expectRefusal(signThrows(updateWith({ sourceHash: '' }), wrongSigner), {
          message : 'Invalid unsignedUpdate: sourceHash is not the hash of sourceDocument.',
          data    : { field: 'sourceHash', expected: canonicalHash(sourceDocument), actual: '' }
        });
      });

      it('signs an update of a later version if the update belongs to sourceDocument', () => {
        // Updater.sign gets no version of sourceDocument, so it accepts each targetVersionId of 2 or more.
        const signed = Updater.sign(sourceDocument, Updater.construct(sourceDocument, ALSO_KNOWN_AS, 4), '#initialKey', signer);
        expect(signed.targetVersionId).to.equal(5);
      });

      it('adds no proof to the unsigned update, so the caller can sign it again after a signer fails', () => {
        const unsigned = updateWith({});
        const garbage: Signer = { publicKey: signer.publicKey, sign: () => new Uint8Array(64) };
        expectRefusal(signThrows(unsigned, garbage), {
          message : `Invalid update: the proof does not verify with the public key of "${INITIAL_KEY}".`,
          data    : { verificationMethodId: INITIAL_KEY }
        });
        expect(unsigned).to.not.have.property('proof');
        const signed = Updater.sign(sourceDocument, unsigned, '#initialKey', signer);
        expect(signed).to.not.equal(unsigned);
        expect(unsigned).to.not.have.property('proof');
        const again = Updater.sign(sourceDocument, unsigned, '#initialKey', signer);
        expect(again.proof.verificationMethod).to.equal(INITIAL_KEY);
        expect(unsigned).to.not.have.property('proof');
      });

      it('signs an update with an extra property, and the resolver accepts the update', () => {
        const unsigned = updateWith({ note: 'an extra property' });
        const signed = Updater.sign(sourceDocument, unsigned, '#initialKey', signer);
        expect((signed as unknown as Record<string, unknown>).note).to.equal('an extra property');
        const { didDocument, metadata } = resolveWith(signed);
        expect(metadata.versionId).to.equal('2');
        expect(canonicalHash(didDocument)).to.equal(unsigned.targetHash);
      });
    });

    describe('DidBtcr2.update', () => {
      for(const refusal of REFUSALS) {
        it(`refuses ${refusal.title} before Construct, with the error of Updater.signingMethod`, () => {
          const expected = refusal.make();
          expectRefusal(thrownBy(() => updaterFor(expected.document, refusal.methodId)), expected);
        });
      }

      it('DidBtcr2.deactivate refuses a method of the type JsonWebKey2020 with the same error', () => {
        const document = referencing(signerMethod({ type: 'JsonWebKey2020' }));
        const thrown = thrownBy(() => DidBtcr2.deactivate({ sourceDocument: document, sourceVersionId: 1, verificationMethodId: SIGNER_ID, beaconId }));
        expectRefusal(thrown, {
          message : `Invalid update: verificationMethod.${TYPE_RULE}`,
          data    : { verificationMethodId: SIGNER_ID, field: 'type', actual: 'JsonWebKey2020' }
        });
      });

      it('asks for the key of #initialKey by the absolute id, if the caller or the document spells the id as "#initialKey"', () => {
        // The second document spells the id of #initialKey and its capabilityInvocation entry
        // as relative DID URLs.
        const relative = sourceCopy();
        relative.verificationMethod![0]!.id = '#initialKey';
        relative.capabilityInvocation = [ '#initialKey' ];
        for(const document of [ sourceDocument, relative ]) {
          for(const methodId of [ '#initialKey', INITIAL_KEY ]) {
            const state = updaterFor(document, methodId).advance();
            if(state.status !== 'action-required') throw new Error('expected action-required');
            const need = state.needs[0] as NeedSigningKey;
            expect(need.kind).to.equal('NeedSigningKey');
            expect(need.verificationMethodId, `${document.verificationMethod![0]!.id} named by ${methodId}`).to.equal(INITIAL_KEY);
          }
        }
      });

      it('asks for the key again after a signer fails, and then signs with the right signer', () => {
        const updater = updaterFor(sourceDocument, '#initialKey');
        let state = updater.advance();
        if(state.status !== 'action-required') throw new Error('expected action-required');
        const need = state.needs[0] as NeedSigningKey;
        const garbage: Signer = { publicKey: signer.publicKey, sign: () => new Uint8Array(64) };
        expectRefusal(thrownBy(() => updater.provide(need, garbage)), {
          message : `Invalid update: the proof does not verify with the public key of "${INITIAL_KEY}".`,
          data    : { verificationMethodId: INITIAL_KEY }
        });
        expect(need.unsignedUpdate).to.not.have.property('proof');
        state = updater.advance();
        if(state.status !== 'action-required') throw new Error('expected action-required');
        expect(state.needs[0]!.kind).to.equal('NeedSigningKey');
        updater.provide(state.needs[0] as NeedSigningKey, signer);
        state = updater.advance();
        if(state.status !== 'action-required') throw new Error('expected action-required');
        expect(state.needs[0]!.kind).to.equal('NeedFunding');
        expect(need.unsignedUpdate).to.not.have.property('proof');
      });

      it('signs with a method whose absolute id has no fragment, from NeedSigningKey to NeedBroadcast', () => {
        const methodId = `${did}?key=1`;
        const updater = updaterFor(referencing(signerMethod({ id: methodId })), methodId);
        let state = updater.advance();
        if(state.status !== 'action-required') throw new Error('expected action-required');
        expect((state.needs[0] as NeedSigningKey).verificationMethodId).to.equal(methodId);
        updater.provide(state.needs[0] as NeedSigningKey, signer);
        state = updater.advance();
        if(state.status !== 'action-required') throw new Error('expected action-required');
        updater.provide(state.needs[0] as NeedFunding);
        state = updater.advance();
        if(state.status !== 'action-required') throw new Error('expected action-required');
        const broadcast = state.needs[0] as NeedBroadcast;
        expect(broadcast.kind).to.equal('NeedBroadcast');
        expect(broadcast.signedUpdate.proof.verificationMethod).to.equal(methodId);
      });
    });
  });

  describe('the optional service and verificationMethod members (ADR 148)', () => {
    // Spec "DID Document": "verificationMethod" and "service" are optional, "@context" is
    // required. Spec "Update": an update can change any property except id.

    /** The error that `fn` throws, or undefined. */
    function thrownBy(fn: () => unknown): any {
      try {
        fn();
      } catch(error) {
        return error;
      }
      return undefined;
    }

    /** A copy of the source document whose relationships embed the method of verificationMethod. */
    /** The source document with its first method embedded in capabilityInvocation. The other relationships keep their references. */
    function embeddedSource(): Btcr2DidDocument {
      const method = { ...sourceDocument.verificationMethod![0]! };
      return {
        ...JSON.parse(JSON.stringify(sourceDocument)),
        capabilityInvocation : [{ ...method }],
      } as Btcr2DidDocument;
    }

    it('Updater.construct accepts a patch that removes the optional /service member, but not the required /@context member', () => {
      const patch: PatchOperation[] = [{ op: 'remove', path: '/service' }];
      const unsigned = Updater.construct(sourceDocument, patch, 1);
      const target = JSONPatch.apply(sourceDocument, patch);
      expect(target).to.not.have.property('service');
      expect(unsigned.targetHash).to.equal(canonicalHash(target));

      const thrown = thrownBy(() => Updater.construct(sourceDocument, [{ op: 'remove', path: '/@context' }], 1));
      expect(thrown).to.be.instanceOf(UpdateError);
      expect(thrown.type).to.equal(INVALID_DID_UPDATE);
      expect(thrown.message).to.equal('Error validating targetDocument: Invalid "@context"');
    });

    it('Updater.construct accepts a patch that removes /verificationMethod if the relationships embed the method', () => {
      const source = embeddedSource();
      const patch: PatchOperation[] = [{ op: 'remove', path: '/verificationMethod' }];
      const unsigned = Updater.construct(source, patch, 1);
      const target = JSONPatch.apply(source, patch);
      expect(target).to.not.have.property('verificationMethod');
      expect(target.capabilityInvocation[0]).to.deep.equal(sourceDocument.verificationMethod![0]);
      expect(unsigned.targetHash).to.equal(canonicalHash(target));
    });

    it('DidBtcr2.update refuses a source document without service or with a service that is not an array with INVALID_DID_UPDATE', () => {
      const withoutService = JSON.parse(JSON.stringify(sourceDocument)) as Btcr2DidDocument;
      delete withoutService.service;
      const stringService = { ...sourceDocument, service: 'x' } as unknown as Btcr2DidDocument;
      for(const [label, document] of [['no service', withoutService], ['service "x"', stringService]] as const) {
        const thrown = thrownBy(() => DidBtcr2.update({
          sourceDocument  : document,
          patches         : [],
          sourceVersionId : 1,
          verificationMethodId,
          beaconId,
        }));
        expect(thrown, label).to.be.instanceOf(UpdateError);
        expect(thrown.type, label).to.equal(INVALID_DID_UPDATE);
        expect(thrown.message, label).to.equal('No beacon service found for provided beaconId');
      }
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
