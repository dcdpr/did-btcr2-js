import type { DataIntegrityConfig, SignedBTCR2Update, UnsignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { getNetwork } from '@did-btcr2/bitcoin';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { schnorr } from '@noble/curves/secp256k1.js';
import { Script, SigHash, Transaction, p2tr } from '@scure/btc-signer';
import { expect } from 'chai';
import {
  AggregationParticipant,
  AggregationParticipantRunner,
  AggregationService,
  AggregationServiceRunner,
  InMemoryBus,
  InMemoryTransport,
  AGGREGATED_NONCE,
  AUTHORIZATION_REQUEST,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  COHORT_OPT_IN_ACCEPT,
  COHORT_READY,
  DISTRIBUTE_AGGREGATED_DATA,
  FALLBACK_AUTHORIZATION_REQUEST,
  FALLBACK_SIGNATURE,
  KeyPairAggregationSigner,
  NONCE_CONTRIBUTION,
  ParticipantCohortPhase,
  SIGNATURE_AUTHORIZATION,
  ServiceCohortPhase,
  SUBMIT_UPDATE,
  VALIDATION_ACK,
  buildFallbackLeaf,
  buildRecoveryLeaves,
  createFallbackAuthorizationRequestMessage,
  createFallbackSignatureMessage,
} from '../src/index.js';
import { DidBtcr2 } from '@did-btcr2/method';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { MessageBus, MockTransport } from './helpers/mock-transport.js';

const TEST_RECOVERY_KEY = 'a'.repeat(64);
const TEST_RECOVERY_SEQUENCE = 144;
const NET = getNetwork('mutinynet');

function createSignedUpdate(did: string, keys: SchnorrKeyPair, version = 2): SignedBTCR2Update {
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
    targetVersionId : version,
  };
  const config: DataIntegrityConfig = {
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

describe('Aggregate beacon fallback protocol (ADR 042)', () => {
  let bus: MessageBus;
  let service: AggregationService;
  let parts: AggregationParticipant[];
  let serviceTransport: MockTransport;
  let partTransports: MockTransport[];
  let serviceDid: string;
  let dids: string[];
  let keys: SchnorrKeyPair[];

  const N = 3;

  beforeEach(() => {
    const serviceKeys = SchnorrKeyPair.generate();
    serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
    keys = Array.from({ length: N }, () => SchnorrKeyPair.generate());
    dids = keys.map(k => DidBtcr2.create(k.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' }));

    service = new AggregationService({ did: serviceDid, publicKey: serviceKeys.publicKey });
    parts = keys.map((k, i) => new AggregationParticipant({ did: dids[i], signer: new KeyPairAggregationSigner(k) }));

    bus = new MessageBus();
    serviceTransport = new MockTransport(bus);
    serviceTransport.registerActor(serviceDid, serviceKeys);
    partTransports = keys.map((k, i) => {
      const t = new MockTransport(bus);
      t.registerActor(dids[i], k);
      return t;
    });

    const wire = (t: MockTransport, did: string, machine: AggregationService | AggregationParticipant, types: string[]) => {
      for(const type of types) t.registerMessageHandler(did, type, msg => machine.receive(msg as never));
    };
    wire(serviceTransport, serviceDid, service, [
      COHORT_OPT_IN, SUBMIT_UPDATE, VALIDATION_ACK, NONCE_CONTRIBUTION, SIGNATURE_AUTHORIZATION, FALLBACK_SIGNATURE,
    ]);
    const participantTypes = [
      COHORT_ADVERT, COHORT_OPT_IN_ACCEPT, COHORT_READY, DISTRIBUTE_AGGREGATED_DATA,
      AUTHORIZATION_REQUEST, AGGREGATED_NONCE, FALLBACK_AUTHORIZATION_REQUEST,
    ];
    parts.forEach((p, i) => wire(partTransports[i], dids[i], p, participantTypes));
  });

  async function send(transport: MockTransport, senderDid: string, msgs: { to?: string }[]): Promise<void> {
    for(const m of msgs) await transport.sendMessage(m as never, senderDid, m.to as never);
  }

  /** The real script-tree beacon output script the cohort's address commits to. */
  function beaconScript(cohortId: string): Uint8Array {
    const cohort = service.getCohort(cohortId)!;
    const leaves = buildRecoveryLeaves('operator-funded', {
      recoveryKey       : cohort.recoveryKey!,
      recoverySequence  : cohort.recoverySequence!,
      cohortKeys        : cohort.cohortKeys,
      fallbackThreshold : cohort.effectiveFallbackThreshold,
    });
    return p2tr(cohort.internalKey, leaves, NET, true).script;
  }

  async function formAndValidate(beaconType: string): Promise<{ cohortId: string; script: Uint8Array; value: bigint }> {
    const cohortId = service.createCohort({ minParticipants: N, network: 'mutinynet', beaconType, recoveryKey: TEST_RECOVERY_KEY, recoverySequence: TEST_RECOVERY_SEQUENCE });
    await send(serviceTransport, serviceDid, service.advertise(cohortId));
    for(let i = 0; i < N; i++) await send(partTransports[i], dids[i], parts[i].joinCohort(cohortId));
    for(let i = 0; i < N; i++) await send(serviceTransport, serviceDid, service.acceptParticipant(cohortId, dids[i]));
    await send(serviceTransport, serviceDid, service.finalizeKeygen(cohortId));
    for(let i = 0; i < N; i++) await send(partTransports[i], dids[i], parts[i].submitUpdate(cohortId, createSignedUpdate(dids[i], keys[i])));
    await send(serviceTransport, serviceDid, service.buildAndDistribute(cohortId));
    for(let i = 0; i < N; i++) await send(partTransports[i], dids[i], parts[i].approveValidation(cohortId));
    expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Validated);

    const cohort = service.getCohort(cohortId)!;
    const script = beaconScript(cohortId);
    const value = 100000n;
    // The OP_RETURN must carry the cohort's validated signal: members bind their
    // fallback signatures to it.
    const tx = beaconTx(script, cohort.internalKey, value, cohort.signalBytes!);
    await send(serviceTransport, serviceDid, service.startSigning(cohortId, { tx, prevOutScripts: [ script ], prevOutValues: [ value ] }));
    expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.SigningStarted);
    return { cohortId, script, value };
  }

  /** A beacon announcement tx: input spends the script-tree UTXO, OP_RETURN carries the signal. */
  function beaconTx(script: Uint8Array, internalKey: Uint8Array, value: bigint, signal: Uint8Array): Transaction {
    const tx = new Transaction({ version: 2, allowUnknownInputs: true, allowUnknownOutputs: true });
    tx.addInput({ txid: '22'.repeat(32), index: 0, witnessUtxo: { script, amount: value }, tapInternalKey: internalKey });
    tx.addOutput({ script: Script.encode([ 'RETURN', signal ]), amount: 0n });
    return tx;
  }

  it('falls back from the optimistic key path to a k-of-n script-path spend', async () => {
    const { cohortId, script, value } = await formAndValidate('CASBeacon');

    // Service abandons the optimistic round and requests fallback signatures.
    await send(serviceTransport, serviceDid, service.startFallbackSigning(cohortId));
    expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.FallbackRequested);
    for(let i = 0; i < N; i++) {
      expect(parts[i].getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.AwaitingFallbackSig);
    }

    // Only k = n-1 = 2 members sign the fallback; that is enough to complete.
    await send(partTransports[0], dids[0], parts[0].approveFallback(cohortId));
    expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.FallbackRequested);
    await send(partTransports[1], dids[1], parts[1].approveFallback(cohortId));

    expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
    const result = service.getResult(cohortId)!;
    expect(result.path).to.equal('script-path');

    // The finalized fallback tx carries a verifiable k-of-n script-path witness.
    const witness = result.signedTx.getInput(0).finalScriptWitness!;
    const leaf = buildFallbackLeaf({ cohortKeys: service.getCohort(cohortId)!.cohortKeys, fallbackThreshold: service.getCohort(cohortId)!.effectiveFallbackThreshold });
    expect(witness[witness.length - 2]).to.deep.equal(leaf);
    const sighash = result.signedTx.preimageWitnessV1(0, [ script ], SigHash.DEFAULT, [ value ], undefined, leaf, 0xc0);
    const sigEntries = witness.slice(0, witness.length - 2).filter(e => e.length === 64);
    expect(sigEntries).to.have.lengthOf(2);
    const xonly = service.getCohort(cohortId)!.cohortKeys.map(k => k.slice(1));
    for(const sig of sigEntries) expect(xonly.some(xk => schnorr.verify(sig, sighash, xk))).to.be.true;
  });

  it('ignores a late optimistic partial signature once committed to fallback', async () => {
    const { cohortId } = await formAndValidate('CASBeacon');

    // Begin the optimistic round: all members contribute nonces, service aggregates.
    for(let i = 0; i < N; i++) await send(partTransports[i], dids[i], parts[i].approveNonce(cohortId));
    await send(serviceTransport, serviceDid, service.sendAggregatedNonce(cohortId));
    expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.AwaitingPartialSigs);

    // Two members send their optimistic partial sigs (not yet enough for n-of-n).
    await send(partTransports[0], dids[0], parts[0].generatePartialSignature(cohortId));
    await send(partTransports[1], dids[1], parts[1].generatePartialSignature(cohortId));
    expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.AwaitingPartialSigs);

    // Service falls back. The remaining optimistic signer's partial sig must now
    // be ignored: only one path may finalize the single beacon UTXO.
    await send(serviceTransport, serviceDid, service.startFallbackSigning(cohortId));
    // The third participant is now AwaitingFallbackSig, not AwaitingPartialSig, so
    // it cannot emit a stale optimistic partial sig. Complete via fallback.
    await send(partTransports[0], dids[0], parts[0].approveFallback(cohortId));
    await send(partTransports[1], dids[1], parts[1].approveFallback(cohortId));
    expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
    expect(service.getResult(cohortId)!.path).to.equal('script-path');
  });

  it('drops a fallback signature from a non-member without failing the cohort', async () => {
    const { cohortId } = await formAndValidate('SMTBeacon');
    await send(serviceTransport, serviceDid, service.startFallbackSigning(cohortId));

    // A non-member sends a FALLBACK_SIGNATURE with the right sessionId. It must be
    // dropped as a rejection, never fail the whole cohort (DoS guard).
    const outsider = SchnorrKeyPair.generate();
    const outsiderDid = DidBtcr2.create(outsider.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
    const sessionId = service.getSigningSessionId(cohortId)!;
    service.receive(createFallbackSignatureMessage({
      from              : outsiderDid,
      to                : serviceDid,
      cohortId,
      sessionId,
      signerPk          : outsider.publicKey.compressed.slice(1),
      fallbackSignature : new Uint8Array(64).fill(9),
    }) as never);
    expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.FallbackRequested);
    expect(service.drainRejections(cohortId).some(r => /non-member/i.test(r.reason))).to.be.true;

    // Real members still complete it.
    await send(partTransports[0], dids[0], parts[0].approveFallback(cohortId));
    await send(partTransports[1], dids[1], parts[1].approveFallback(cohortId));
    expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
  });

  it('refuses to sign a fallback tx that anchors a different signal (malicious service)', async () => {
    const { cohortId, script, value } = await formAndValidate('CASBeacon');
    const cohort = service.getCohort(cohortId)!;
    const sessionId = service.getSigningSessionId(cohortId)!;

    // A coordinator hands the member a tx whose OP_RETURN carries a DIFFERENT
    // signal than the one the member validated. The member must refuse to sign.
    const tampered = beaconTx(script, cohort.internalKey, value, new Uint8Array(32).fill(0xbe));
    const leaf = buildFallbackLeaf({ cohortKeys: cohort.cohortKeys, fallbackThreshold: cohort.effectiveFallbackThreshold });
    parts[0].receive(createFallbackAuthorizationRequestMessage({
      from                  : serviceDid,
      to                    : dids[0],
      cohortId,
      sessionId,
      pendingTx             : tampered.hex,
      prevOutScriptHex      : bytesToHex(script),
      prevOutValue          : value.toString(),
      fallbackLeafScriptHex : bytesToHex(leaf),
    }) as never);
    expect(parts[0].getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.AwaitingFallbackSig);
    expect(() => parts[0].approveFallback(cohortId)).to.throw(/SIGNAL_MISMATCH|does not anchor/);
  });

  it('SMT: fallback completes and the witness verifies', async () => {
    const { cohortId, script, value } = await formAndValidate('SMTBeacon');
    await send(serviceTransport, serviceDid, service.startFallbackSigning(cohortId));
    await send(partTransports[0], dids[0], parts[0].approveFallback(cohortId));
    await send(partTransports[2], dids[2], parts[2].approveFallback(cohortId));
    expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
    const result = service.getResult(cohortId)!;
    const witness = result.signedTx.getInput(0).finalScriptWitness!;
    const leaf = buildFallbackLeaf({ cohortKeys: service.getCohort(cohortId)!.cohortKeys, fallbackThreshold: service.getCohort(cohortId)!.effectiveFallbackThreshold });
    const sighash = result.signedTx.preimageWitnessV1(0, [ script ], SigHash.DEFAULT, [ value ], undefined, leaf, 0xc0);
    const sigEntries = witness.slice(0, witness.length - 2).filter(e => e.length === 64);
    const xonly = service.getCohort(cohortId)!.cohortKeys.map(k => k.slice(1));
    for(const sig of sigEntries) expect(xonly.some(xk => schnorr.verify(sig, sighash, xk))).to.be.true;
  });
});

describe('Aggregate beacon fallback runner: latch safety (ADR 042)', () => {
  const N = 3;
  const RKEY = 'a'.repeat(64);

  it('a premature triggerFallback rejects without poisoning the latch; the cohort still completes via the key path', async () => {
    const bus = new InMemoryBus();
    const transport = new InMemoryTransport(bus);
    const svcKeys = SchnorrKeyPair.generate();
    const svcDid = DidBtcr2.create(svcKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
    transport.registerActor(svcDid, svcKeys);
    const pKeys = Array.from({ length: N }, () => SchnorrKeyPair.generate());
    const pDids = pKeys.map(k => DidBtcr2.create(k.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' }));
    pKeys.forEach((k, i) => { transport.registerActor(pDids[i], k); transport.registerPeer(pDids[i], k.publicKey.compressed); });
    transport.registerPeer(svcDid, svcKeys.publicKey.compressed);
    transport.start();

    const dummyScript = p2tr(schnorr.getPublicKey(hexToBytes('77'.repeat(32))), undefined, getNetwork('mutinynet')).script;
    const svc = new AggregationServiceRunner({
      transport,
      did             : svcDid,
      keys            : svcKeys,
      onProvideTxData : async ({ signalBytes }) => {
        const value = 100000n;
        const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
        tx.addInput({ txid: '00'.repeat(32), index: 0, witnessUtxo: { amount: value, script: dummyScript } });
        tx.addOutput({ script: dummyScript, amount: value - 500n });
        // Members bind their nonce approval to the validated signal.
        tx.addOutput({ script: Script.encode([ 'RETURN', signalBytes ]), amount: 0n });
        return { tx, prevOutScripts: [ dummyScript ], prevOutValues: [ value ] };
      },
    });
    const participants = pKeys.map((k, i) => new AggregationParticipantRunner({
      transport,
      did             : pDids[i],
      keys            : k,
      shouldJoin      : async () => true,
      onProvideUpdate : async () => createSignedUpdate(pDids[i], k),
    }));
    await Promise.all(participants.map(p => p.start()));

    const { cohortId, completion } = svc.advertiseCohort({
      minParticipants : N, network : 'mutinynet', beaconType : 'CASBeacon', recoveryKey : RKEY, recoverySequence : 144,
    });

    // Signing has not started, so the fallback transition must reject. With the
    // latch poisoned (the pre-fix bug) the later optimistic completion would be
    // discarded and `completion` would hang; the fix keeps it intact.
    let rejected = false;
    await svc.triggerFallback(cohortId).catch(() => { rejected = true; });
    expect(rejected).to.be.true;

    const result = await completion;
    expect(result.path).to.equal('key-path');

    participants.forEach(p => p.stop());
    svc.stop();
  });
});
