import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { getNetwork } from '@did-btcr2/bitcoin';
import type { Btcr2DataIntegrityConfig, SignedBTCR2Update, UnsignedBTCR2Update } from '@did-btcr2/method';
import { DidBtcr2 } from '@did-btcr2/method';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { p2tr, Script, Transaction } from '@scure/btc-signer';
import { expect } from 'chai';

import type {
  BaseMessage} from '../src/index.js';
import {
  AggregationParticipant,
  AggregationService,
  KeyPairAggregationSigner,
  ParticipantCohortPhase,
  ServiceCohortPhase,
  buildFallbackLeaf,
  createFallbackAuthorizationRequestMessage,
} from '../src/index.js';
import { beaconOutputScript } from './helpers/beacon-script.js';

const TEST_RECOVERY_KEY = 'a'.repeat(64);
const TEST_RECOVERY_SEQUENCE = 144;

function makeIdentity(network = 'mutinynet'): { keys: SchnorrKeyPair; did: string } {
  const keys = SchnorrKeyPair.generate();
  const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network });
  return { keys, did };
}

function createSignedUpdate(did: string, keys: SchnorrKeyPair): SignedBTCR2Update {
  const context = [
    'https://w3id.org/security/v2',
    'https://w3id.org/zcap/v1',
    'https://w3id.org/json-ld-patch/v1',
    'https://btcr2.dev/context/v1',
  ];
  const unsigned: UnsignedBTCR2Update = {
    '@context'      : context,
    patch           : [
      { op: 'add', path: '/service/-', value: { id: `${did}#svc`, type: 'Test', serviceEndpoint: 'https://example.com' } },
    ],
    sourceHash      : `zQmSourceHash${did.slice(-6)}`,
    targetHash      : `zQmTargetHash${did.slice(-6)}`,
    targetVersionId : 2,
  };
  const config: Btcr2DataIntegrityConfig = {
    '@context'         : context,
    cryptosuite        : 'bip340-jcs-2025',
    type               : 'DataIntegrityProof',
    verificationMethod : `${did}#initialKey`,
    proofPurpose       : 'capabilityInvocation',
    capability         : `urn:zcap:root:${encodeURIComponent(did)}`,
    capabilityAction   : 'Write',
  };
  const multikey = SchnorrMultikey.fromSecretKey(`${did}#initialKey`, did, keys.secretKey.bytes);
  return multikey.toCryptosuite().toDataIntegrityProof().addProof(unsigned, config);
}

/** A script that is NOT the cohort beacon output (a foreign taproot key). */
function foreignScript(): Uint8Array {
  return p2tr(schnorr.getPublicKey(hexToBytes('77'.repeat(32))), undefined, getNetwork('mutinynet')).script;
}

/** How the signing tx handed to the participant should be shaped. */
interface TxSpec {
  /** Input 0 prevout script; defaults to the cohort beacon script. */
  prevOutScript?: Uint8Array;
  prevOutValue?: bigint;
  /** Add a second (foreign) input. */
  extraInput?: boolean;
  /** Self-change amount back to the beacon script; omit for no change output. */
  selfChange?: bigint;
  /** Attach the validated signal as a zero-value OP_RETURN. Defaults to true. */
  withSignal?: boolean;
  /** Sats carried by the OP_RETURN output (must be 0 for a well-formed tx). */
  signalAmount?: bigint;
  /** Change output paying a foreign script. */
  foreignChange?: bigint;
}

interface Drive {
  service: AggregationService;
  participant: AggregationParticipant;
  cohortId: string;
  serviceDid: string;
  memberDid: string;
  script: Uint8Array;
  value: bigint;
}

/**
 * Drive a 1-member cohort to the member's AwaitingSigning phase with a signing
 * tx built from `spec`. All protocol messages are cryptographically real; only
 * the final tx shape varies.
 */
function driveToAwaitingSigning(spec: TxSpec, participantOpts?: { maxFeeSats?: bigint | number }): Drive {
  const serviceId = makeIdentity();
  const member = makeIdentity();
  const service = new AggregationService({ did: serviceId.did, publicKey: serviceId.keys.publicKey });
  const participant = new AggregationParticipant({
    did    : member.did,
    signer : new KeyPairAggregationSigner(member.keys),
    ...participantOpts,
  });
  const route = (msgs: BaseMessage[]): void => {
    for(const m of msgs) {
      // Broadcasts (the cohort advert) reach the listening member; addressed
      // messages reach their named recipient.
      if(m.to === undefined) { participant.receive(m); continue; }
      (m.to === member.did ? participant : service).receive(m);
    }
  };

  const cohortId = service.createCohort({
    minParticipants  : 1,
    network          : 'mutinynet',
    beaconType       : 'CASBeacon',
    recoveryKey      : TEST_RECOVERY_KEY,
    recoverySequence : TEST_RECOVERY_SEQUENCE,
  });
  route(service.advertise(cohortId));
  route(participant.joinCohort(cohortId));
  route(service.acceptParticipant(cohortId, member.did));
  route(service.finalizeKeygen(cohortId));
  route(participant.submitUpdate(cohortId, createSignedUpdate(member.did, member.keys)));
  route(service.buildAndDistribute(cohortId));
  route(participant.approveValidation(cohortId));
  expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Validated);

  const cohort = service.getCohort(cohortId)!;
  const script = beaconOutputScript(cohort);
  const value = spec.prevOutValue ?? 100000n;
  const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
  tx.addInput({
    txid        : '00'.repeat(32),
    index       : 0,
    witnessUtxo : { amount: value, script: spec.prevOutScript ?? script },
  });
  if(spec.extraInput) {
    tx.addInput({ txid: '11'.repeat(32), index: 1, witnessUtxo: { amount: 1000n, script: foreignScript() } });
  }
  if(spec.selfChange !== undefined) tx.addOutput({ script, amount: spec.selfChange });
  if(spec.foreignChange !== undefined) tx.addOutput({ script: foreignScript(), amount: spec.foreignChange });
  if(spec.withSignal !== false) {
    tx.addOutput({ script: Script.encode([ 'RETURN', cohort.signalBytes! ]), amount: spec.signalAmount ?? 0n });
  }

  const prevOutScript = spec.prevOutScript ?? script;
  route(service.startSigning(cohortId, { tx, prevOutScripts: [ prevOutScript ], prevOutValues: [ value ] }));
  expect(participant.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.AwaitingSigning);
  return { service, participant, cohortId, serviceDid: serviceId.did, memberDid: member.did, script, value };
}

describe('Participant beacon-tx validation', () => {

  it('accepts a well-formed beacon spend (control)', () => {
    const d = driveToAwaitingSigning({ selfChange: 100000n - 500n });
    const msgs = d.participant.approveNonce(d.cohortId);
    expect(msgs).to.have.lengthOf(1);
    expect(d.participant.getCohortPhase(d.cohortId)).to.equal(ParticipantCohortPhase.NonceSent);
  });

  it('refuses a prevOutScript that is not the cohort beacon script', () => {
    const d = driveToAwaitingSigning({ prevOutScript: foreignScript(), selfChange: 100000n - 500n });
    expect(() => d.participant.approveNonce(d.cohortId)).to.throw(/PREVOUT_SCRIPT_MISMATCH|beacon UTXO/);
  });

  it('refuses a spend with more than one input', () => {
    const d = driveToAwaitingSigning({ selfChange: 100000n - 500n, extraInput: true });
    expect(() => d.participant.approveNonce(d.cohortId)).to.throw(/UNEXPECTED_INPUT_COUNT|exactly one/);
  });

  it('refuses change paid to a foreign script', () => {
    const d = driveToAwaitingSigning({ foreignChange: 100000n - 500n });
    expect(() => d.participant.approveNonce(d.cohortId)).to.throw(/FOREIGN_OUTPUT|beacon address/);
  });

  it('refuses a spend with no self-change output (whole UTXO burned)', () => {
    const d = driveToAwaitingSigning({});
    expect(() => d.participant.approveNonce(d.cohortId)).to.throw(/MISSING_SELF_CHANGE|carried forward/);
  });

  it('refuses a dust self-change output', () => {
    const d = driveToAwaitingSigning({ selfChange: 100n });
    expect(() => d.participant.approveNonce(d.cohortId)).to.throw(/DUST_SELF_CHANGE|dust/);
  });

  it('refuses a value-carrying OP_RETURN output', () => {
    const d = driveToAwaitingSigning({ selfChange: 100000n - 1500n, signalAmount: 1000n });
    expect(() => d.participant.approveNonce(d.cohortId)).to.throw(/SIGNAL_OUTPUT_CARRIES_VALUE|zero-value/);
  });

  it('refuses a fee above the default ceiling', () => {
    const d = driveToAwaitingSigning({ prevOutValue: 300000n, selfChange: 150000n });
    expect(() => d.participant.approveNonce(d.cohortId)).to.throw(/FEE_TOO_HIGH|ceiling/);
  });

  it('honors a custom maxFeeSats ceiling', () => {
    const d = driveToAwaitingSigning({ selfChange: 100000n - 500n }, { maxFeeSats: 400 });
    expect(() => d.participant.approveNonce(d.cohortId)).to.throw(/FEE_TOO_HIGH|ceiling/);
  });

  it('refuses a fallback spend whose change pays a foreign script', () => {
    // The optimistic request is well-formed; the tampered tx arrives on the
    // fallback authorization request.
    const d = driveToAwaitingSigning({ selfChange: 100000n - 500n });
    const cohort = d.service.getCohort(d.cohortId)!;
    const sessionId = d.service.getSigningSessionId(d.cohortId)!;

    const tampered = new Transaction({ version: 2, allowUnknownOutputs: true });
    tampered.addInput({ txid: '00'.repeat(32), index: 0, witnessUtxo: { amount: d.value, script: d.script } });
    tampered.addOutput({ script: foreignScript(), amount: d.value - 500n });
    tampered.addOutput({ script: Script.encode([ 'RETURN', cohort.signalBytes! ]), amount: 0n });

    const leaf = buildFallbackLeaf({
      cohortKeys        : cohort.cohortKeys,
      fallbackThreshold : cohort.effectiveFallbackThreshold,
    });
    d.participant.receive(createFallbackAuthorizationRequestMessage({
      from                  : d.serviceDid,
      to                    : d.memberDid,
      cohortId              : d.cohortId,
      sessionId,
      pendingTx             : tampered.hex,
      prevOutScriptHex      : bytesToHex(d.script),
      prevOutValue          : d.value.toString(),
      fallbackLeafScriptHex : bytesToHex(leaf),
    }));
    expect(d.participant.getCohortPhase(d.cohortId)).to.equal(ParticipantCohortPhase.AwaitingFallbackSig);
    expect(() => d.participant.approveFallback(d.cohortId)).to.throw(/FOREIGN_OUTPUT|beacon address/);
  });
});
