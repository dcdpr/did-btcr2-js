import type { Btcr2DataIntegrityConfig, SignedBTCR2Update, UnsignedBTCR2Update } from '@did-btcr2/method';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { p2tr, Script, Transaction } from '@scure/btc-signer';
import * as musig2 from '@scure/btc-signer/musig2';
import { expect } from 'chai';
import {
  AggregationParticipantRunner,
  AggregationServiceRunner,
  type AggregationCohort,
  type CohortConfig,
} from '../src/index.js';
import { DidBtcr2 } from '@did-btcr2/method';
import { MessageBus, MockTransport } from './helpers/mock-transport.js';

const TEST_RECOVERY_KEY = 'a'.repeat(64);
const TEST_RECOVERY_SEQUENCE = 144;

/**
 * Executable coverage for ADR 040 (multi-cohort aggregation service runner):
 * one AggregationServiceRunner advertises and drives several cohorts at once,
 * each completing/failing in isolation, with cohortId-tagged events, plus the
 * participant multi-join helper. All cohorts are 1-of-1 CAS cohorts over an
 * in-process transport (the proven AggregationRunner.solo signing path).
 */

/** A cryptographically valid SignedBTCR2Update for the given participant. */
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
    patch           : [
      { op: 'add', path: '/service/-', value: { id: `${did}#svc`, type: 'Test', serviceEndpoint: 'https://example.com' } },
    ],
    sourceHash      : `zQmSourceHash${did.slice(-6)}`,
    targetHash      : `zQmTargetHash${did.slice(-6)}`,
    targetVersionId : version,
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

/** A dummy P2TR signing payload over the cohort's aggregate key (matches the solo/e2e demos). */
function dummyTxData(cohort: AggregationCohort) {
  const aggPk = musig2.keyAggExport(musig2.keyAggregate(cohort.cohortKeys));
  const payment = p2tr(aggPk);
  const prevOutValue = 100000n;
  const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
  tx.addInput({ txid: '00'.repeat(32), index: 0, witnessUtxo: { amount: prevOutValue, script: payment.script } });
  tx.addOutput({ script: payment.script, amount: prevOutValue - 500n });
  // Members bind their nonce approval to the validated signal: anchor it in an OP_RETURN.
  if(cohort.signalBytes) tx.addOutput({ script: Script.encode([ 'RETURN', cohort.signalBytes ]), amount: 0n });
  return { tx, prevOutScripts: [ payment.script ], prevOutValues: [ prevOutValue ] };
}

const CAS = (minParticipants = 1): CohortConfig => ({ minParticipants, network: 'mutinynet', beaconType: 'CASBeacon', recoveryKey: TEST_RECOVERY_KEY, recoverySequence: TEST_RECOVERY_SEQUENCE });

/** Build a service runner (no default config, driven via advertiseCohort). */
function makeService(bus: MessageBus, opts: Partial<ConstructorParameters<typeof AggregationServiceRunner>[0]> = {}): AggregationServiceRunner {
  const keys = SchnorrKeyPair.generate();
  const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
  const transport = new MockTransport(bus);
  transport.registerActor(did, keys);
  // `runner` is referenced inside onProvideTxData, which only runs mid-protocol
  // (long after assignment), so the self-reference is safe.
  const runner: AggregationServiceRunner = new AggregationServiceRunner({
    transport,
    did,
    keys,
    advertRepeatIntervalMs : 0,
    onProvideTxData        : async ({ cohortId }) => dummyTxData(runner.session.getCohort(cohortId)!),
    ...opts,
  });
  return runner;
}

/** Participant runner options for an actor that joins cohorts via `shouldJoin`. */
function participantOpts(bus: MessageBus, shouldJoin: () => Promise<boolean> = async () => true): ConstructorParameters<typeof AggregationParticipantRunner>[0] {
  const keys = SchnorrKeyPair.generate();
  const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
  const transport = new MockTransport(bus);
  transport.registerActor(did, keys);
  return {
    transport,
    did,
    keys,
    shouldJoin      : async () => shouldJoin(),
    onProvideUpdate : async () => createSignedUpdate(did, keys),
  };
}

describe('Aggregation Multi-Cohort (AGG-4)', () => {
  it('one service drives two cohorts to completion concurrently, each with its own cohortId', async () => {
    const bus = new MessageBus();
    const service = makeService(bus);
    // One participant subscribes to every advert and drives both cohorts.
    const alice = new AggregationParticipantRunner(participantOpts(bus));
    await alice.start();

    const a = service.advertiseCohort(CAS());
    const b = service.advertiseCohort(CAS());
    expect(a.cohortId).to.not.equal(b.cohortId);

    const [ ra, rb ] = await Promise.all([ a.completion, b.completion ]);

    expect(ra.cohortId).to.equal(a.cohortId);
    expect(rb.cohortId).to.equal(b.cohortId);
    expect(ra.signature.length).to.equal(64);
    expect(rb.signature.length).to.equal(64);
    // Both completed cohorts remain readable in the session post-completion.
    expect(service.session.getCohort(a.cohortId)!.beaconAddress).to.match(/^tb1p/);
    expect(service.session.getCohort(b.cohortId)!.beaconAddress).to.match(/^tb1p/);

    alice.stop();
    service.stop();
  });

  it('a runner stays alive after a cohort completes and drives further cohorts', async () => {
    const bus = new MessageBus();
    const service = makeService(bus);
    const alice = new AggregationParticipantRunner(participantOpts(bus));
    await alice.start();

    const a = service.advertiseCohort(CAS());
    const ra = await a.completion;
    expect(ra.cohortId).to.equal(a.cohortId);

    // Completion must not have torn down the shared transport handlers: a second
    // cohort advertised afterwards still runs to completion on the same runner.
    const b = service.advertiseCohort(CAS());
    const rb = await b.completion;
    expect(rb.cohortId).to.equal(b.cohortId);
    expect(a.cohortId).to.not.equal(b.cohortId);

    alice.stop();
    service.stop();
  });

  it('enriches service events with the originating cohortId', async () => {
    const bus = new MessageBus();
    const service = makeService(bus);
    const alice = new AggregationParticipantRunner(participantOpts(bus));
    await alice.start();

    const accepted = new Set<string>();
    const updates = new Set<string>();
    const signing = new Set<string>();
    service.on('participant-accepted', ({ cohortId }) => accepted.add(cohortId));
    service.on('update-received', ({ cohortId }) => updates.add(cohortId));
    service.on('signing-started', ({ cohortId }) => signing.add(cohortId));

    const a = service.advertiseCohort(CAS());
    const b = service.advertiseCohort(CAS());
    await Promise.all([ a.completion, b.completion ]);

    const both = [ a.cohortId, b.cohortId ].sort();
    expect([ ...accepted ].sort()).to.deep.equal(both);
    expect([ ...updates ].sort()).to.deep.equal(both);
    expect([ ...signing ].sort()).to.deep.equal(both);

    alice.stop();
    service.stop();
  });

  it('isolates per-cohort failure: a stalled cohort fails via TTL without affecting a completing one', async () => {
    const bus = new MessageBus();
    const service = makeService(bus, { cohortTtlMs: 200 });
    service.on('error', () => { /* failCohort emits error; swallow in-test */ });

    const failedCohorts: string[] = [];
    service.on('cohort-failed', ({ cohortId }) => failedCohorts.push(cohortId));

    // joinFirst stops the participant after one cohort completes, so it will NOT
    // join the second (stalled) cohort advertised afterwards.
    const alicePromise = AggregationParticipantRunner.joinFirst(participantOpts(bus));

    const a = service.advertiseCohort(CAS());
    const ra = await a.completion;          // completes; participant stops
    await alicePromise;
    expect(ra.cohortId).to.equal(a.cohortId);

    // No participant remains to join B - it stalls and its own TTL fails it.
    const b = service.advertiseCohort(CAS());
    let err: unknown;
    try { await b.completion; } catch(e) { err = e; }
    expect(err, 'cohort B completion should reject on TTL').to.be.an('error');
    expect((err as Error).message).to.match(/TTL/i);
    expect(failedCohorts).to.deep.equal([ b.cohortId ]);

    // A is unaffected and still readable; B was reclaimed from the session.
    expect(service.session.getCohort(a.cohortId)).to.exist;
    expect(service.session.getCohort(b.cohortId)).to.equal(undefined);

    service.stop();
  });

  it('stopCohort tears down one cohort and leaves siblings intact', async () => {
    const bus = new MessageBus();
    const service = makeService(bus);

    const alicePromise = AggregationParticipantRunner.joinFirst(participantOpts(bus));
    const a = service.advertiseCohort(CAS());
    const ra = await a.completion;
    await alicePromise;

    // B has no participant; stop it explicitly rather than waiting for a timeout.
    const b = service.advertiseCohort(CAS());
    expect(service.session.getCohort(b.cohortId)).to.exist;

    service.stopCohort(b.cohortId);
    let err: unknown;
    try { await b.completion; } catch(e) { err = e; }
    expect(err, 'stopped cohort completion should reject').to.be.an('error');
    expect((err as Error).message).to.match(/stopped/i);

    expect(service.session.getCohort(b.cohortId)).to.equal(undefined);
    expect(service.session.getCohort(a.cohortId)).to.exist;      // sibling intact
    expect(ra.cohortId).to.equal(a.cohortId);

    service.stop();
  });

  it('runAll() resolves with every outstanding cohort, including ones advertised mid-drain', async () => {
    const bus = new MessageBus();
    const service = makeService(bus);
    const alice = new AggregationParticipantRunner(participantOpts(bus));
    await alice.start();

    const a = service.advertiseCohort(CAS());
    // Start draining with only A outstanding, then advertise B before A settles:
    // runAll re-snapshots each round, so the dynamically-added cohort is included.
    const drained = service.runAll();
    const b = service.advertiseCohort(CAS());

    const results = await drained;
    expect(results.map(r => r.cohortId).sort()).to.deep.equal([ a.cohortId, b.cohortId ].sort());

    alice.stop();
    service.stop();
  });

  it('AggregationParticipantRunner.joinMatching collects N cohort completions', async () => {
    const bus = new MessageBus();
    const service = makeService(bus);

    // One participant joins the next two adverts and resolves with both sidecars.
    const joined = AggregationParticipantRunner.joinMatching(participantOpts(bus), 2);

    const a = service.advertiseCohort(CAS());
    const b = service.advertiseCohort(CAS());

    const infos = await joined;
    expect(infos).to.have.length(2);
    expect(infos.map(i => i.cohortId).sort()).to.deep.equal([ a.cohortId, b.cohortId ].sort());
    // Each completion carries the participant's resolution sidecar (beaconType +
    // CAS Announcement map), retained through the Complete phase.
    for(const info of infos) {
      expect(info.beaconAddress).to.match(/^tb1p/);
      expect(info.beaconType).to.equal('CASBeacon');
      expect(info.casAnnouncement).to.be.an('object');
      expect(Object.keys(info.casAnnouncement!)).to.have.length.greaterThan(0);
    }

    service.stop();
  });
});
