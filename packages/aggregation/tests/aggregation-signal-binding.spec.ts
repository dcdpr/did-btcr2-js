import { getNetwork } from '@did-btcr2/bitcoin';
import { canonicalize, hash } from '@did-btcr2/common';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { Btcr2DataIntegrityConfig, SignedBTCR2Update, UnsignedBTCR2Update } from '@did-btcr2/method';
import { DidBtcr2 } from '@did-btcr2/method';
import { bytesToHex } from '@noble/hashes/utils';
import { Script, Transaction, p2tr } from '@scure/btc-signer';
import { expect } from 'chai';
import type { AggregationParticipantError, BaseMessage } from '../src/index.js';
import {
  AggregationParticipant,
  AggregationService,
  KeyPairAggregationSigner,
  ParticipantCohortPhase,
  ServiceCohortPhase,
  buildFallbackLeaf,
  buildRecoveryLeaves,
  createAuthorizationRequestMessage,
  createFallbackAuthorizationRequestMessage,
  getBeaconStrategy,
} from '../src/index.js';

const TEST_RECOVERY_KEY = 'a'.repeat(64);
const TEST_RECOVERY_SEQUENCE = 144;
const NET = getNetwork('mutinynet');
const VALUE = 100_000n;

function createSignedUpdate(did: string, keys: SchnorrKeyPair): SignedBTCR2Update {
  const context = [
    'https://w3id.org/security/v2',
    'https://w3id.org/zcap/v1',
    'https://w3id.org/json-ld-patch/v1',
    'https://btcr2.dev/context/v1',
  ];
  const verificationMethodId = `${did}#initialKey`;
  const unsigned: UnsignedBTCR2Update = {
    '@context'      : context,
    patch           : [ { op: 'add', path: '/service/-', value: { id: `${did}#svc`, type: 'Test', serviceEndpoint: 'https://example.com' } } ],
    sourceHash      : `zQmSourceHash${did.slice(-6)}`,
    targetHash      : `zQmTargetHash${did.slice(-6)}`,
    targetVersionId : 2,
  };
  const config: Btcr2DataIntegrityConfig = {
    '@context'         : context,
    cryptosuite        : 'bip340-jcs-2025',
    type               : 'DataIntegrityProof',
    verificationMethod : verificationMethodId,
    proofPurpose       : 'capabilityInvocation',
    capability         : `urn:zcap:root:${encodeURIComponent(did)}`,
    capabilityAction   : 'Write',
  };
  const multikey = SchnorrMultikey.fromSecretKey(verificationMethodId, did, keys.secretKey.bytes);
  return multikey.toCryptosuite().toDataIntegrityProof().addProof(unsigned, config);
}

/**
 * A two-member cohort driven directly through both state machines (no
 * transport), formed and with every member's round response in. Messages are
 * delivered by hand so a test can tamper with one on the way. Members listed in
 * `decliners` take the cooperative non-inclusion path instead of submitting.
 */
function formCohort(beaconType: string, decliners: number[] = []) {
  const serviceKeys = SchnorrKeyPair.generate();
  const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
  const keys = [ SchnorrKeyPair.generate(), SchnorrKeyPair.generate() ];
  const dids = keys.map(k => DidBtcr2.create(k.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' }));
  const service = new AggregationService({ did: serviceDid, publicKey: serviceKeys.publicKey });
  const parts = keys.map((k, i) => new AggregationParticipant({ did: dids[i], signer: new KeyPairAggregationSigner(k) }));

  const toParts = (msgs: BaseMessage[]) => msgs.forEach(m => parts.forEach(p => {
    if(!m.to || m.to === p.did) p.receive(m);
  }));
  const toService = (msgs: BaseMessage[]) => msgs.forEach(m => service.receive(m));

  const cohortId = service.createCohort({
    minParticipants  : 2,
    network          : 'mutinynet',
    beaconType,
    recoveryKey      : TEST_RECOVERY_KEY,
    recoverySequence : TEST_RECOVERY_SEQUENCE,
  });
  toParts(service.advertise(cohortId));
  parts.forEach(p => toService(p.joinCohort(cohortId)));
  dids.forEach(did => toParts(service.acceptParticipant(cohortId, did)));
  toParts(service.finalizeKeygen(cohortId));
  parts.forEach((p, i) => toService(decliners.includes(i)
    ? p.declineUpdate(cohortId)
    : p.submitUpdate(cohortId, createSignedUpdate(dids[i], keys[i]))));

  return { service, parts, serviceDid, dids, keys, cohortId, toParts, toService };
}

/** The real script-tree beacon output script the cohort's address commits to. */
function beaconScript(service: AggregationService, cohortId: string): Uint8Array {
  const cohort = service.getCohort(cohortId)!;
  const leaves = buildRecoveryLeaves('operator-funded', {
    recoveryKey       : cohort.recoveryKey!,
    recoverySequence  : cohort.recoverySequence!,
    cohortKeys        : cohort.cohortKeys,
    fallbackThreshold : cohort.effectiveFallbackThreshold,
  });
  return p2tr(cohort.internalKey, leaves, NET, true).script;
}

interface BeaconTxOptions {
  /** OP_RETURN payloads, appended in order after the change output. */
  signals: Uint8Array[];
  /** Change destination script; defaults to the beacon script (roll forward). */
  changeScript?: Uint8Array;
  /** Change amount; defaults to the input value less a 500 sat fee. */
  changeAmount?: bigint;
  /** Value assigned to the LAST OP_RETURN output; defaults to 0. */
  signalAmount?: bigint;
  /** Number of inputs spending the beacon UTXO; defaults to 1. */
  inputs?: number;
}

/** A beacon announcement tx: change output first, signal OP_RETURN(s) after. */
function beaconTx(script: Uint8Array, options: BeaconTxOptions): Transaction {
  const { signals, changeScript, changeAmount, signalAmount, inputs = 1 } = options;
  const tx = new Transaction({ version: 2, allowUnknownInputs: true, allowUnknownOutputs: true });
  for(let i = 0; i < inputs; i++) {
    tx.addInput({ txid: `${(i + 0x22).toString(16)}`.repeat(32).slice(0, 64), index: 0, witnessUtxo: { script, amount: VALUE } });
  }
  tx.addOutput({ script: changeScript ?? script, amount: changeAmount ?? VALUE - 500n });
  signals.forEach((signal, i) => tx.addOutput({
    script : Script.encode([ 'RETURN', signal ]),
    amount : i === signals.length - 1 ? signalAmount ?? 0n : 0n,
  }));
  return tx;
}

/** An outsider-controlled P2TR script (a coordinator's own drain destination). */
function outsiderScript(): Uint8Array {
  return p2tr(SchnorrKeyPair.generate().publicKey.x, undefined, NET).script;
}

/** Assert `fn` throws a participant error with the given type and message. */
function expectRefusal(fn: () => unknown, type: string, message: RegExp): void {
  try {
    fn();
  } catch (error) {
    expect((error as AggregationParticipantError).type, 'error type').to.equal(type);
    expect((error as Error).message, 'error message').to.match(message);
    return;
  }
  expect.fail(`expected a refusal of type ${type}`);
}

describe('Aggregate beacon announcement binding', () => {

  describe('validated data binds the announced signal (audit H2)', () => {

    it('CAS: rejects a map that includes the member when the signal excludes it', () => {
      const { service, parts, dids, cohortId, toParts } = formCohort('CASBeacon');
      const messages = service.buildAndDistribute(cohortId);
      const honestMap = { ...service.getCohort(cohortId)!.casAnnouncement! };

      // The coordinator distributes the honest map (the member's update IS in it)
      // but announces the hash of a map that omits the member.
      const excludingMap = { ...honestMap };
      delete excludingMap[dids[0]];
      messages[0].body!.signalBytesHex = bytesToHex(hash(canonicalize(excludingMap)));
      toParts(messages);

      const validation = parts[0].getValidation(cohortId)!;
      expect(validation.casAnnouncement![dids[0]]).to.be.a('string');
      expect(validation.matches).to.be.false;
    });

    it('CAS: accepts the announcement the distributed map derives to', () => {
      const { service, parts, cohortId, toParts } = formCohort('CASBeacon');
      toParts(service.buildAndDistribute(cohortId));

      const validation = parts[0].getValidation(cohortId)!;
      expect(validation.matches).to.be.true;
      expect(validation.signalBytesHex).to.equal(bytesToHex(service.getCohort(cohortId)!.signalBytes!));
    });

    it('SMT: rejects a valid inclusion proof announced under a different root', () => {
      const { service, parts, cohortId, toParts } = formCohort('SMTBeacon');
      const messages = service.buildAndDistribute(cohortId);
      messages[0].body!.signalBytesHex = bytesToHex(new Uint8Array(32).fill(0xbe));
      toParts(messages);

      const validation = parts[0].getValidation(cohortId)!;
      // The proof itself still verifies: only the announced root is foreign.
      expect(validation.smtProof!.id).to.be.a('string');
      expect(validation.matches).to.be.false;
    });

    it('SMT: accepts the announcement equal to the proof root', () => {
      const { service, parts, cohortId, toParts } = formCohort('SMTBeacon');
      toParts(service.buildAndDistribute(cohortId));

      const validation = parts[0].getValidation(cohortId)!;
      expect(validation.matches).to.be.true;
      expect(validation.signalBytesHex).to.equal(bytesToHex(service.getCohort(cohortId)!.signalBytes!));
    });

    it('fails closed when no signal is announced at all', () => {
      const { service, parts, cohortId, toParts } = formCohort('CASBeacon');
      const messages = service.buildAndDistribute(cohortId);
      delete messages[0].body!.signalBytesHex;
      toParts(messages);

      expect(parts[0].getValidation(cohortId)!.matches).to.be.false;
    });

    it('CAS: a decliner binds its non-inclusion to the announced signal', () => {
      // A decliner validates absence from the map, which every map it is absent
      // from satisfies; without the binding its signature is the easiest to
      // redirect onto an unrelated announcement.
      const tampered = formCohort('CASBeacon', [ 1 ]);
      const tamperedMessages = tampered.service.buildAndDistribute(tampered.cohortId);
      tamperedMessages.find(m => m.to === tampered.dids[1])!.body!.signalBytesHex =
        bytesToHex(new Uint8Array(32).fill(0x11));
      tampered.toParts(tamperedMessages);
      expect(tampered.parts[1].getValidation(tampered.cohortId)!.matches, 'foreign signal').to.be.false;

      const honest = formCohort('CASBeacon', [ 1 ]);
      honest.toParts(honest.service.buildAndDistribute(honest.cohortId));
      const validation = honest.parts[1].getValidation(honest.cohortId)!;
      expect(validation.included, 'decliner').to.be.false;
      expect(validation.matches, 'honest signal').to.be.true;
    });

    it('the strategies derive the signal the cohort anchors', () => {
      const cas = formCohort('CASBeacon');
      cas.service.buildAndDistribute(cas.cohortId);
      const casCohort = cas.service.getCohort(cas.cohortId)!;
      const casDerived = getBeaconStrategy('CASBeacon')!.deriveSignal({ matches: true, casAnnouncement: casCohort.casAnnouncement });
      expect(bytesToHex(casDerived!)).to.equal(bytesToHex(casCohort.signalBytes!));

      const smt = formCohort('SMTBeacon');
      smt.service.buildAndDistribute(smt.cohortId);
      const smtCohort = smt.service.getCohort(smt.cohortId)!;
      const smtDerived = getBeaconStrategy('SMTBeacon')!.deriveSignal({
        matches  : true,
        smtProof : smtCohort.smtProofs!.get(smt.dids[0]),
      });
      expect(bytesToHex(smtDerived!)).to.equal(bytesToHex(smtCohort.signalBytes!));

      // Nothing to derive from: fail closed rather than bind to nothing.
      expect(getBeaconStrategy('CASBeacon')!.deriveSignal({ matches: true })).to.be.undefined;
      expect(getBeaconStrategy('SMTBeacon')!.deriveSignal({ matches: true })).to.be.undefined;
    });

    it('refuses to sign after an unbound announcement, even if the member approved it', () => {
      const { service, parts, dids, cohortId, toParts, toService } = formCohort('CASBeacon');
      const messages = service.buildAndDistribute(cohortId);
      const honestMap = { ...service.getCohort(cohortId)!.casAnnouncement! };
      const excludingMap = { ...honestMap };
      delete excludingMap[dids[0]];
      const excludingSignal = hash(canonicalize(excludingMap));
      messages[0].body!.signalBytesHex = bytesToHex(excludingSignal);
      toParts(messages);

      // The member (or its UI) approves anyway; the signature boundary still holds.
      parts.forEach(p => toService(p.approveValidation(cohortId)));
      const script = beaconScript(service, cohortId);
      const tx = beaconTx(script, { signals: [ excludingSignal ] });
      toParts(service.startSigning(cohortId, { tx, prevOutScripts: [ script ], prevOutValues: [ VALUE ] }));

      expectRefusal(() => parts[0].approveNonce(cohortId), 'UNVALIDATED_DATA', /did not validate/);
    });
  });

  describe('beacon transaction structure (audit H3)', () => {

    /** Form, validate and hand the cohort a transaction, ready for approveNonce. */
    function readyToSign(options: Omit<BeaconTxOptions, 'signals'> & { signals?: (signal: Uint8Array) => Uint8Array[] }) {
      const harness = formCohort('CASBeacon');
      const { service, parts, cohortId, toParts, toService } = harness;
      toParts(service.buildAndDistribute(cohortId));
      parts.forEach(p => toService(p.approveValidation(cohortId)));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Validated);

      const signal = service.getCohort(cohortId)!.signalBytes!;
      const script = beaconScript(service, cohortId);
      const { signals, ...rest } = options;
      const tx = beaconTx(script, { ...rest, signals: signals ? signals(signal) : [ signal ] });
      toParts(service.startSigning(cohortId, { tx, prevOutScripts: [ script ], prevOutValues: [ VALUE ] }));
      return { ...harness, signal, script, tx };
    }

    it('refuses a tx whose LAST output announces a foreign signal', () => {
      // The member's own signal is present, just not where resolution reads it:
      // every resolver takes the signal from the last output.
      const foreign = new Uint8Array(32).fill(0xbe);
      const { parts, cohortId } = readyToSign({ signals: signal => [ signal, foreign ] });

      expectRefusal(() => parts[0].approveNonce(cohortId), 'SIGNAL_MISMATCH', /last output/);
    });

    it('signs a well-formed beacon tx (change, then the signal last)', () => {
      const { parts, cohortId } = readyToSign({});
      const messages = parts[0].approveNonce(cohortId);

      expect(messages).to.have.lengthOf(1);
      expect(parts[0].getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.NonceSent);
    });

    it('refuses a tx that burns value in the signal output', () => {
      const { parts, cohortId } = readyToSign({ signalAmount: 1_000n });

      expectRefusal(() => parts[0].approveNonce(cohortId), 'INVALID_TX_STRUCTURE', /burns value/);
    });

    it('refuses a tx carrying a second OP_RETURN output', () => {
      const { parts, cohortId } = readyToSign({ signals: signal => [ new Uint8Array(32).fill(0x77), signal ] });

      expectRefusal(() => parts[0].approveNonce(cohortId), 'INVALID_TX_STRUCTURE', /2 OP_RETURN outputs/);
    });

    it('refuses a tx that spends more than one input', () => {
      // The protocol conveys a single prevout, so the member cannot see, check
      // or correctly sign a second input.
      const { parts, cohortId } = readyToSign({ inputs: 2 });

      expectRefusal(() => parts[0].approveNonce(cohortId), 'INVALID_TX_STRUCTURE', /spends 2 inputs/);
    });

    it('refuses a tx whose outputs exceed the value of the input', () => {
      const { parts, cohortId } = readyToSign({ changeAmount: VALUE + 1n });

      expectRefusal(() => parts[0].approveNonce(cohortId), 'INVALID_TX_STRUCTURE', /from an input of/);
    });

    it('refuses a malformed prevOutValue', () => {
      const { service, parts, serviceDid, dids, cohortId, toParts, toService } = formCohort('CASBeacon');
      toParts(service.buildAndDistribute(cohortId));
      parts.forEach(p => toService(p.approveValidation(cohortId)));
      const script = beaconScript(service, cohortId);
      const tx = beaconTx(script, { signals: [ service.getCohort(cohortId)!.signalBytes! ] });
      // Start the session but deliver a hand-built request instead, so the
      // member's stored prevOutValue is the junk one.
      service.startSigning(cohortId, { tx, prevOutScripts: [ script ], prevOutValues: [ VALUE ] });

      parts[0].receive(createAuthorizationRequestMessage({
        from             : serviceDid,
        to               : dids[0],
        cohortId,
        sessionId        : service.getSigningSessionId(cohortId)!,
        pendingTx        : tx.hex,
        prevOutScriptHex : bytesToHex(script),
        prevOutValue     : 'not-a-number',
      }) as never);

      expectRefusal(() => parts[0].approveNonce(cohortId), 'INVALID_PREVOUT_VALUE', /malformed prevOutValue/);
    });

    it('applies the same checks on the fallback path', () => {
      // A member still in ValidationSent has no optimistic tx to compare
      // against, so only the structural checks stand between it and a signature.
      const { service, parts, serviceDid, dids, cohortId, toParts, toService } = formCohort('CASBeacon');
      toParts(service.buildAndDistribute(cohortId));
      parts.forEach(p => toService(p.approveValidation(cohortId)));
      const cohort = service.getCohort(cohortId)!;
      const script = beaconScript(service, cohortId);
      const tx = beaconTx(script, { signals: [ cohort.signalBytes! ] });
      service.startSigning(cohortId, { tx, prevOutScripts: [ script ], prevOutValues: [ VALUE ] });
      expect(parts[0].getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.ValidationSent);

      const foreign = beaconTx(script, { signals: [ new Uint8Array(32).fill(0xbe) ] });
      const leaf = buildFallbackLeaf({ cohortKeys: cohort.cohortKeys, fallbackThreshold: cohort.effectiveFallbackThreshold });
      parts[0].receive(createFallbackAuthorizationRequestMessage({
        from                  : serviceDid,
        to                    : dids[0],
        cohortId,
        sessionId             : service.getSigningSessionId(cohortId)!,
        pendingTx             : foreign.hex,
        prevOutScriptHex      : bytesToHex(script),
        prevOutValue          : VALUE.toString(),
        fallbackLeafScriptHex : bytesToHex(leaf),
      }) as never);

      expect(parts[0].getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.AwaitingFallbackSig);
      expectRefusal(() => parts[0].approveFallback(cohortId), 'SIGNAL_MISMATCH', /last output/);
    });
  });

  describe('fallback binds to the optimistic transaction (audit H4)', () => {

    /** Form, validate, start signing and contribute a nonce for both members. */
    function noncesContributed() {
      const harness = formCohort('CASBeacon');
      const { service, parts, cohortId, toParts, toService } = harness;
      toParts(service.buildAndDistribute(cohortId));
      parts.forEach(p => toService(p.approveValidation(cohortId)));
      const cohort = service.getCohort(cohortId)!;
      const script = beaconScript(service, cohortId);
      const optimisticTx = beaconTx(script, { signals: [ cohort.signalBytes! ] });
      toParts(service.startSigning(cohortId, { tx: optimisticTx, prevOutScripts: [ script ], prevOutValues: [ VALUE ] }));
      parts.forEach(p => toService(p.approveNonce(cohortId)));
      return { ...harness, cohort, script, optimisticTx };
    }

    function fallbackRequest(
      harness: ReturnType<typeof noncesContributed>,
      pendingTx: Transaction,
      sessionId?: string,
    ): BaseMessage {
      const { service, serviceDid, dids, cohortId, cohort, script } = harness;
      const leaf = buildFallbackLeaf({ cohortKeys: cohort.cohortKeys, fallbackThreshold: cohort.effectiveFallbackThreshold });
      return createFallbackAuthorizationRequestMessage({
        from                  : serviceDid,
        to                    : dids[0],
        cohortId,
        sessionId             : sessionId ?? service.getSigningSessionId(cohortId)!,
        pendingTx             : pendingTx.hex,
        prevOutScriptHex      : bytesToHex(script),
        prevOutValue          : VALUE.toString(),
        fallbackLeafScriptHex : bytesToHex(leaf),
      });
    }

    it('ignores a fallback request carrying a different transaction', () => {
      const harness = noncesContributed();
      const { parts, cohortId, cohort, script } = harness;

      // Same validated signal, different outputs: signing it would give the
      // coordinator a script-path witness for a spend competing with the
      // key-path signature this member is midway through producing.
      const competing = beaconTx(script, { signals: [ cohort.signalBytes! ], changeScript: outsiderScript() });
      parts[0].receive(fallbackRequest(harness, competing) as never);

      expect(parts[0].getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.NonceSent);
      expect(parts[0].pendingFallbackRequests.get(cohortId)).to.be.undefined;
    });

    it('leaves the optimistic round intact after a rejected fallback request', () => {
      const harness = noncesContributed();
      const { service, parts, cohortId, cohort, script, toParts, toService } = harness;

      const competing = beaconTx(script, { signals: [ cohort.signalBytes! ], changeScript: outsiderScript() });
      parts[0].receive(fallbackRequest(harness, competing, 'not-the-session') as never);

      // The secret nonce survived: the honest key-path round still completes.
      toParts(service.sendAggregatedNonce(cohortId));
      parts.forEach(p => toService(p.generatePartialSignature(cohortId)));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
      expect(service.getResult(cohortId)!.path).to.equal('key-path');
    });

    it('accepts and signs the fallback for the optimistic transaction', () => {
      const harness = noncesContributed();
      const { parts, cohortId, optimisticTx } = harness;

      parts[0].receive(fallbackRequest(harness, optimisticTx) as never);
      expect(parts[0].getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.AwaitingFallbackSig);

      const messages = parts[0].approveFallback(cohortId);
      expect(messages).to.have.lengthOf(1);
      expect(parts[0].getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.Complete);
    });

    it('ignores a fallback request that differs only in its change amount', () => {
      const harness = noncesContributed();
      const { parts, cohortId, cohort, script } = harness;

      const higherFee = beaconTx(script, { signals: [ cohort.signalBytes! ], changeAmount: VALUE - 50_000n });
      parts[0].receive(fallbackRequest(harness, higherFee) as never);

      expect(parts[0].getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.NonceSent);
    });
  });
});
