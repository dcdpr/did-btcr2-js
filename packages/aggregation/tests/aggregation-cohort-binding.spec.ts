import { getNetwork } from '@did-btcr2/bitcoin';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { Btcr2DataIntegrityConfig, SignedBTCR2Update, UnsignedBTCR2Update } from '@did-btcr2/method';
import { DidBtcr2 } from '@did-btcr2/method';
import { bytesToHex } from '@noble/hashes/utils';
import { Address, OutScript, Script, Transaction, p2tr } from '@scure/btc-signer';
import { expect } from 'chai';
import type {
  AggregationServiceError,
  BaseMessage,
  CohortConfig,
  PendingOptIn,
  PendingValidation,
  Rejection,
} from '../src/index.js';
import {
  AggregationCohort,
  AggregationCohortError,
  AggregationParticipant,
  AggregationParticipantError,
  AggregationParticipantRunner,
  AggregationService,
  AggregationServiceRunner,
  COHORT_OPT_IN,
  COHORT_READY,
  DISTRIBUTE_AGGREGATED_DATA,
  KeyPairAggregationSigner,
  ParticipantCohortPhase,
  ServiceCohortPhase,
  buildFallbackLeaf,
  createCohortAdvertMessage,
  createCohortOptInMessage,
  createFallbackAuthorizationRequestMessage,
  getBeaconStrategy,
} from '../src/index.js';
import { MessageBus, MockTransport } from './helpers/mock-transport.js';

/**
 * Executable coverage for ADR 152: the checks of a member bind to its cohort.
 * The tests cover these rules:
 * - the member validates with the beacon type of the advert;
 * - the membership is final at finalizeKeygen;
 * - the service runner reports an operator approval that comes too late;
 * - the service runner applies an approval only to the opt-in that the
 *   operator saw;
 * - each signature spends the beacon output of the cohort;
 * - one beacon address of a member has one beacon type.
 */

const TEST_RECOVERY_KEY = 'a'.repeat(64);
const TEST_RECOVERY_SEQUENCE = 144;
const NET = getNetwork('mutinynet');

function newDid(keys: SchnorrKeyPair): string {
  return DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
}

/** A cryptographically valid SignedBTCR2Update for the given participant. */
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
    invocationTarget   : did,
  };
  const multikey = SchnorrMultikey.fromSecretKey(verificationMethodId, did, keys.secretKey.bytes);
  return multikey.toCryptosuite().toDataIntegrityProof().addProof(unsigned, config) as SignedBTCR2Update;
}

/**
 * A two-member cohort with no transport: the test calls both state machines
 * directly. The cohort has its keys and both updates. The helper delivers each
 * message by hand, so a test can change a message before delivery.
 */
function formCohort(beaconType: string) {
  const serviceKeys = SchnorrKeyPair.generate();
  const serviceDid = newDid(serviceKeys);
  const keys = [ SchnorrKeyPair.generate(), SchnorrKeyPair.generate() ];
  const dids = keys.map(newDid);
  const service = new AggregationService({ did: serviceDid, publicKey: serviceKeys.publicKey });
  const parts = keys.map((k, i) => new AggregationParticipant({ did: dids[i]!, signer: new KeyPairAggregationSigner(k) }));

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
  parts.forEach((p, i) => toService(p.submitUpdate(cohortId, createSignedUpdate(dids[i]!, keys[i]!))));

  return { service, parts, dids, cohortId, toParts };
}

/**
 * The DISTRIBUTE_AGGREGATED_DATA messages of the cohort. The message for
 * `memberDid` has valid data of `otherType` in place of the data of the cohort
 * type. The data includes the update of the member, and the signal is the
 * signal that this data derives to. The cohort then holds this signal.
 */
function distributeOfOtherType(service: AggregationService, cohortId: string, memberDid: string, otherType: string): BaseMessage[] {
  const messages = service.buildAndDistribute(cohortId);
  const message = messages.find(m => m.to === memberDid)!;
  const cohort = service.getCohort(cohortId)!;
  const strategy = getBeaconStrategy(otherType)!;
  strategy.buildAggregatedData(cohort);
  const body = message.body as Record<string, unknown>;
  delete body.casAnnouncement;
  delete body.smtProof;
  Object.assign(body, strategy.getDistributePayload(cohort, memberDid), {
    beaconType     : otherType,
    signalBytesHex : bytesToHex(cohort.signalBytes!),
  });
  return messages;
}

/** A beacon transaction that spends the beacon output of the cohort and anchors its signal. */
function beaconTxData(cohort: AggregationCohort) {
  const script = OutScript.encode(Address(NET).decode(cohort.beaconAddress));
  const prevOutValue = 100_000n;
  const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
  tx.addInput({ txid: '00'.repeat(32), index: 0, witnessUtxo: { amount: prevOutValue, script } });
  tx.addOutput({ script, amount: prevOutValue - 500n });
  tx.addOutput({ script: Script.encode([ 'RETURN', cohort.signalBytes! ]), amount: 0n });
  return { tx, prevOutScripts: [ script ], prevOutValues: [ prevOutValue ] };
}

const CAS = (minParticipants = 1): CohortConfig => ({
  minParticipants,
  network          : 'mutinynet',
  beaconType       : 'CASBeacon',
  recoveryKey      : TEST_RECOVERY_KEY,
  recoverySequence : TEST_RECOVERY_SEQUENCE,
});

/** A service runner that funds each round with a transaction that spends the beacon output. */
function makeService(bus: MessageBus, opts: Partial<ConstructorParameters<typeof AggregationServiceRunner>[0]> = {}): AggregationServiceRunner {
  const keys = SchnorrKeyPair.generate();
  const did = newDid(keys);
  const transport = new MockTransport(bus);
  transport.registerActor(did, keys);
  // onProvideTxData reads `runner`. The runner calls onProvideTxData only after
  // the constructor returns.
  const runner: AggregationServiceRunner = new AggregationServiceRunner({
    transport,
    did,
    keys,
    advertRepeatIntervalMs : 0,
    onProvideTxData        : async ({ cohortId }) => beaconTxData(runner.session.getCohort(cohortId)!),
    ...opts,
  });
  return runner;
}

/** Participant runner options for an actor that joins each cohort it discovers. */
function participantOpts(bus: MessageBus) {
  const keys = SchnorrKeyPair.generate();
  const did = newDid(keys);
  const transport = new MockTransport(bus);
  transport.registerActor(did, keys);
  return {
    transport,
    did,
    keys,
    shouldJoin      : async () => true,
    onProvideUpdate : async () => createSignedUpdate(did, keys),
  };
}

/** Resolve with `promise`, or reject after `ms` milliseconds. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout: ${what}`)), ms)),
  ]);
}

/** Wait 20 ms so that the in-memory bus delivers the pending messages. */
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

/** Runs fn and checks the error type and the error message. */
function expectRefusal(fn: () => unknown, type: string, message: string): void {
  let error: unknown;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  expect(error, `expected ${type}`).to.be.instanceOf(Error);
  expect((error as AggregationServiceError).type).to.equal(type);
  expect((error as Error).message).to.equal(message);
}

/**
 * One member and one service, with no transport. `newService` makes another
 * service. `form` uses `svc` as the service. The default `svc` is `service`.
 *
 * Each cohort of `form` has minParticipants 1 and the same recovery terms,
 * unless `config` changes them. If `config` changes no input of the beacon
 * address, each cohort has the same beacon address. The service DID is not an
 * input of the beacon address. `form` stops before the member receives
 * COHORT_READY.
 */
function oneMemberService() {
  const newService = () => {
    const serviceKeys = SchnorrKeyPair.generate();
    return new AggregationService({ did: newDid(serviceKeys), publicKey: serviceKeys.publicKey });
  };
  const service = newService();
  const keys = SchnorrKeyPair.generate();
  const did = newDid(keys);
  const member = new AggregationParticipant({ did, signer: new KeyPairAggregationSigner(keys) });

  const form = (beaconType: string, config: Partial<CohortConfig> = {}, svc: AggregationService = service) => {
    const cohortId = svc.createCohort({ ...CAS(1), beaconType, ...config });
    svc.advertise(cohortId).forEach(m => member.receive(m));
    member.joinCohort(cohortId).forEach(m => svc.receive(m));
    svc.acceptParticipant(cohortId, did).forEach(m => member.receive(m));
    return { cohortId, ready: svc.finalizeKeygen(cohortId) };
  };
  return { service, newService, member, did, keys, form };
}

/** The data of a BEACON_TYPE_CONFLICT error. */
type TypeConflict = {
  cohortId: string;
  beaconType: string;
  beaconAddress: string;
  otherCohortId: string;
  otherBeaconType: string;
};

/** The message of a BEACON_TYPE_CONFLICT error. */
function conflictMessage(c: TypeConflict): string {
  return `Cohort ${c.cohortId} has the beacon type ${c.beaconType} and the beacon address ${c.beaconAddress} of cohort ${c.otherCohortId}, which has the beacon type ${c.otherBeaconType}.`;
}

/** Runs fn and checks the BEACON_TYPE_CONFLICT error: the class, the type, the full message, and each data field. */
function expectTypeConflict(fn: () => unknown, data: TypeConflict): void {
  let error: unknown;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  expect(error, 'expected BEACON_TYPE_CONFLICT').to.be.instanceOf(AggregationParticipantError);
  expect((error as AggregationParticipantError).type).to.equal('BEACON_TYPE_CONFLICT');
  expect((error as Error).message).to.equal(conflictMessage(data));
  expect((error as AggregationParticipantError).data).to.deep.equal(data);
}

/**
 * Watch the transport of a runner member. `sent` lists each message that the
 * member sends, as "<type> <cohortId>". `handled` resolves after the member
 * handler returns for a directed message of `type` for the cohort.
 */
function watchMember(transport: MockTransport) {
  const sent: string[] = [];
  const send = transport.sendMessage.bind(transport);
  transport.sendMessage = async (message, sender, recipient) => {
    sent.push(`${message.type} ${message.body?.cohortId as string}`);
    return send(message, sender, recipient);
  };
  const waiters: Array<{ type: string; cohortId: string; resolve: () => void }> = [];
  const dispatch = transport.dispatchDirected.bind(transport);
  transport.dispatchDirected = async (recipientDid, type, message) => {
    await dispatch(recipientDid, type, message);
    const cohortId = (message as BaseMessage).body?.cohortId;
    waiters.filter(w => w.type === type && w.cohortId === cohortId).forEach(w => w.resolve());
  };
  const handled = (type: string, cohortId: string) => new Promise<void>(resolve => { waiters.push({ type, cohortId, resolve }); });
  return { sent, handled };
}

/** A cohort of {@link formCohort} after distribution, with both members in ValidationSent. */
function validatedCohort(beaconType = 'CASBeacon') {
  const formed = formCohort(beaconType);
  const { service, parts, cohortId, toParts } = formed;
  toParts(service.buildAndDistribute(cohortId));
  parts.forEach(p => p.approveValidation(cohortId).forEach(m => service.receive(m)));
  expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Validated);
  return { ...formed, cohort: service.getCohort(cohortId)! };
}

/** The output script of a key-path-only P2TR output of the internal key: not the beacon output. */
function keyPathOnlyScript(cohort: AggregationCohort): Uint8Array {
  return p2tr(cohort.internalKey, undefined, NET).script;
}

describe('Aggregation cohort binding (ADR 152)', () => {

  describe('the member validates with the beacon type of its cohort', () => {

    it('CAS cohort: vetoes valid SMT data under the beacon type SMTBeacon', () => {
      const { service, parts, dids, cohortId, toParts } = formCohort('CASBeacon');
      toParts(distributeOfOtherType(service, cohortId, dids[0]!, 'SMTBeacon'));

      const validation = parts[0]!.getValidation(cohortId)!;
      // The SMT root would anchor under the CAS beacon service of the member.
      expect(validation.beaconType).to.equal('CASBeacon');
      expect(validation.matches).to.equal(false);
    });

    it('SMT cohort: vetoes a valid CAS map under the beacon type CASBeacon', () => {
      const { service, parts, dids, cohortId, toParts } = formCohort('SMTBeacon');
      toParts(distributeOfOtherType(service, cohortId, dids[0]!, 'CASBeacon'));

      const validation = parts[0]!.getValidation(cohortId)!;
      expect(validation.beaconType).to.equal('SMTBeacon');
      expect(validation.matches).to.equal(false);
    });

    for(const [ beaconType, otherType ] of [ [ 'CASBeacon', 'SMTBeacon' ], [ 'SMTBeacon', 'CASBeacon' ] ]) {
      it(`${beaconType} cohort: vetoes valid data of the cohort type under the beacon type ${otherType}`, () => {
        const { service, parts, dids, cohortId, toParts } = formCohort(beaconType);
        const message = service.buildAndDistribute(cohortId).find(m => m.to === dids[0])!;
        (message.body as Record<string, unknown>).beaconType = otherType;
        toParts([ message ]);

        // The data and the signal are valid for the cohort; only the type name differs.
        expect(parts[0]!.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.AwaitingValidation);
        const validation = parts[0]!.getValidation(cohortId)!;
        expect(validation.beaconType).to.equal(beaconType);
        expect(validation.matches).to.equal(false);
      });

      it(`${beaconType} cohort: after the type veto, approveNonce refuses to sign with UNVALIDATED_DATA`, () => {
        const { service, parts, dids, cohortId, toParts } = formCohort(beaconType);
        // The first member gets valid data of the other type under the other type name.
        toParts(distributeOfOtherType(service, cohortId, dids[0]!, otherType));
        // Each member approves, also the member whose validation failed.
        parts.forEach(p => p.approveValidation(cohortId).forEach(m => service.receive(m)));
        // The transaction anchors the signal of the other type. If a member
        // validates with the type of the message, it signs this transaction.
        toParts(service.startSigning(cohortId, beaconTxData(service.getCohort(cohortId)!)));

        expectRefusal(() => parts[0]!.approveNonce(cohortId), 'UNVALIDATED_DATA',
          `Cohort ${cohortId} aggregated data did not validate; refusing to sign.`);
        expect(parts[0]!.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.AwaitingSigning);
      });
    }

    it('runner: the default onValidateData vetoes valid SMT data in a CAS cohort with a rejection ack', async () => {
      const bus = new MessageBus();
      const keys = SchnorrKeyPair.generate();
      const did = newDid(keys);
      const transport = new MockTransport(bus);
      transport.registerActor(did, keys);
      // The service sends valid SMT data of the cohort, under the beacon type
      // SMTBeacon. The signal is the signal that this data derives to.
      const send = transport.sendMessage.bind(transport);
      transport.sendMessage = async (message, sender, recipient) => {
        if(message.type !== DISTRIBUTE_AGGREGATED_DATA || !recipient) return send(message, sender, recipient);
        const cohort = service.session.getCohort(message.body!.cohortId as string)!;
        const strategy = getBeaconStrategy('SMTBeacon')!;
        strategy.buildAggregatedData(cohort);
        const body = { ...message.body } as Record<string, unknown>;
        delete body.casAnnouncement;
        delete body.smtProof;
        Object.assign(body, strategy.getDistributePayload(cohort, recipient), {
          beaconType     : 'SMTBeacon',
          signalBytesHex : bytesToHex(cohort.signalBytes!),
        });
        return send({ ...message, body } as BaseMessage, sender, recipient);
      };
      // onProvideTxData reads `service`. The runner calls onProvideTxData only
      // after the constructor returns.
      const service: AggregationServiceRunner = new AggregationServiceRunner({
        transport,
        did,
        keys,
        advertRepeatIntervalMs : 0,
        onProvideTxData        : async ({ cohortId }) => beaconTxData(service.session.getCohort(cohortId)!),
      });
      const acks: boolean[] = [];
      service.on('validation-received', ({ approved }) => acks.push(approved));
      service.on('error', () => { /* the completion rejects */ });
      const member = new AggregationParticipantRunner(participantOpts(bus));
      const validations: PendingValidation[] = [];
      member.on('validation-requested', validation => validations.push(validation));
      const failed = new Promise<{ cohortId: string; reason: string }>(resolve => { member.on('cohort-failed', resolve); });
      await member.start();

      const { cohortId, completion } = service.advertiseCohort(CAS(1));
      const outcome = completion.then(() => undefined, (error: unknown) => error);

      expect(await within(failed, 2000, 'cohort-failed')).to.deep.equal({ cohortId, reason: 'Validation rejected by participant' });
      expect(validations.map(v => [ v.beaconType, v.matches ])).to.deep.equal([ [ 'CASBeacon', false ] ]);
      expect(acks, 'approved value of each VALIDATION_ACK').to.deep.equal([ false ]);
      const error = await within(outcome, 2000, 'the completion');
      expect(error).to.be.instanceOf(Error);
      expect((error as AggregationServiceError).type).to.equal('VALIDATION_REJECTED');
      member.stop();
      service.stop();
    });

    it('vetoes data whose message names no beacon type', () => {
      const { service, parts, dids, cohortId, toParts } = formCohort('CASBeacon');
      const message = service.buildAndDistribute(cohortId).find(m => m.to === dids[0])!;
      delete (message.body as Record<string, unknown>).beaconType;
      toParts([ message ]);

      // The member records a failed validation, so a runner sends a rejection ack.
      expect(parts[0]!.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.AwaitingValidation);
      const validation = parts[0]!.getValidation(cohortId)!;
      expect(validation.beaconType).to.equal('CASBeacon');
      expect(validation.matches).to.equal(false);
    });

    it('drops an advert of a beacon type that is not an aggregate beacon type', () => {
      const keys = SchnorrKeyPair.generate();
      const participant = new AggregationParticipant({ did: newDid(keys), signer: new KeyPairAggregationSigner(keys) });
      const serviceKeys = SchnorrKeyPair.generate();
      participant.receive(createCohortAdvertMessage({
        from             : newDid(serviceKeys),
        cohortId         : 'foo-cohort',
        network          : 'mutinynet',
        communicationPk  : serviceKeys.publicKey.compressed,
        beaconType       : 'FooBeacon',
        minParticipants  : 1,
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      }));

      expect(participant.discoveredCohorts.has('foo-cohort')).to.equal(false);
      expect(() => participant.joinCohort('foo-cohort')).to.throw(/not in Discovered phase/);
    });

    for(const beaconType of [ 'CASBeacon', 'SMTBeacon' ]) {
      it(`joinedCohorts gives the beacon type of the cohort (${beaconType})`, () => {
        const { parts, cohortId } = formCohort(beaconType);
        expect(parts[0]!.joinedCohorts.get(cohortId)!.beaconType).to.equal(beaconType);
      });
    }

    it('joinFirst skips an advert of an unknown beacon type and gives the cohort type to the callbacks', async () => {
      const bus = new MessageBus();
      const service = makeService(bus);
      const fakeKeys = SchnorrKeyPair.generate();
      const fakeDid = newDid(fakeKeys);
      const fake = new MockTransport(bus);
      fake.registerActor(fakeDid, fakeKeys);
      const fakeOptIns: string[] = [];
      fake.registerMessageHandler(fakeDid, COHORT_OPT_IN, async (message) => {
        fakeOptIns.push(message.body?.cohortId as string);
      });

      const opts = participantOpts(bus);
      const provided: string[] = [];
      const joined = AggregationParticipantRunner.joinFirst({
        ...opts,
        onProvideUpdate : async (info) => {
          provided.push(info.beaconType);
          return opts.onProvideUpdate();
        },
      });
      await settle();
      await fake.sendMessage(createCohortAdvertMessage({
        from             : fakeDid,
        cohortId         : 'foo-cohort',
        network          : 'mutinynet',
        communicationPk  : fakeKeys.publicKey.compressed,
        beaconType       : 'FooBeacon',
        minParticipants  : 1,
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      }), fakeDid);
      const { cohortId } = service.advertiseCohort(CAS());

      const info = await joined;
      expect(info.cohortId).to.equal(cohortId);
      expect(info.beaconType).to.equal('CASBeacon');
      expect(provided).to.deep.equal([ 'CASBeacon' ]);
      // The member sent no opt-in for the FooBeacon advert.
      expect(fakeOptIns).to.deep.equal([]);
      service.stop();
    });
  });

  describe('the membership is final at finalizeKeygen', () => {

    it('acceptParticipant refuses an opt-in after finalizeKeygen, and pendingOptIns is empty', () => {
      const serviceKeys = SchnorrKeyPair.generate();
      const service = new AggregationService({ did: newDid(serviceKeys), publicKey: serviceKeys.publicKey });
      const cohortId = service.createCohort(CAS(1));
      service.advertise(cohortId);
      const members = [ SchnorrKeyPair.generate(), SchnorrKeyPair.generate() ].map(keys => ({ keys, did: newDid(keys) }));
      for(const { keys, did } of members) {
        service.receive(createCohortOptInMessage({
          from            : did,
          to              : service.did,
          cohortId,
          participantPk   : keys.publicKey.compressed,
          communicationPk : keys.publicKey.compressed,
        }));
      }
      const [ b, c ] = members;
      service.acceptParticipant(cohortId, b!.did);
      expect([ ...service.pendingOptIns(cohortId).keys() ]).to.deep.equal([ c!.did ]);
      service.finalizeKeygen(cohortId);

      const cohort = service.getCohort(cohortId)!;
      const before = { participants: [ ...cohort.participants ], keys: cohort.cohortKeys.map(k => bytesToHex(k)), address: cohort.beaconAddress };
      expect(service.pendingOptIns(cohortId).size).to.equal(0);
      expectRefusal(() => service.acceptParticipant(cohortId, c!.did), 'INVALID_PHASE',
        `Cannot accept participant ${c!.did} into cohort ${cohortId}: phase is ${service.getCohortPhase(cohortId)}.`);
      expect({ participants: cohort.participants, keys: cohort.cohortKeys.map(k => bytesToHex(k)), address: cohort.beaconAddress }).to.deep.equal(before);

      // The phase check runs before the ALREADY_ACCEPTED and NO_OPT_IN checks.
      const phase = service.getCohortPhase(cohortId);
      const stranger = newDid(SchnorrKeyPair.generate());
      expectRefusal(() => service.acceptParticipant(cohortId, b!.did), 'INVALID_PHASE',
        `Cannot accept participant ${b!.did} into cohort ${cohortId}: phase is ${phase}.`);
      expectRefusal(() => service.acceptParticipant(cohortId, stranger), 'INVALID_PHASE',
        `Cannot accept participant ${stranger} into cohort ${cohortId}: phase is ${phase}.`);
    });

    it('acceptParticipant refuses a cohort that is not advertised yet, with INVALID_PHASE', () => {
      const serviceKeys = SchnorrKeyPair.generate();
      const service = new AggregationService({ did: newDid(serviceKeys), publicKey: serviceKeys.publicKey });
      const cohortId = service.createCohort(CAS(1));
      const stranger = newDid(SchnorrKeyPair.generate());
      expectRefusal(() => service.acceptParticipant(cohortId, stranger), 'INVALID_PHASE',
        `Cannot accept participant ${stranger} into cohort ${cohortId}: phase is ${service.getCohortPhase(cohortId)}.`);
    });

    it('runner: drops an approval that arrives after finalizeKeygen, with MEMBERSHIP_FINAL', async () => {
      const bus = new MessageBus();
      const b = participantOpts(bus);
      const c = participantOpts(bus);
      let cReceived!: () => void;
      const received = new Promise<void>(resolve => { cReceived = resolve; });
      let keygenDone!: () => void;
      const keygen = new Promise<void>(resolve => { keygenDone = resolve; });
      const service = makeService(bus, {
        // The operator approves c only after the cohort finalized with b.
        onOptInReceived : async (optIn) => {
          if(optIn.participantDid === c.did) {
            cReceived();
            await keygen;
          }
          return { accepted: true };
        },
      });
      service.on('keygen-complete', () => keygenDone());
      const rejections: Array<Rejection & { cohortId: string }> = [];
      service.on('message-rejected', rejection => rejections.push(rejection));
      const outcome = new Promise<string>(resolve => {
        service.on('message-rejected', ({ from, code }) => { if(from === c.did) resolve(code); });
        service.on('participant-accepted', ({ participantDid }) => { if(participantDid === c.did) resolve('ACCEPTED'); });
      });
      // b joins only after the opt-in of c waits for the operator.
      const runner = new AggregationParticipantRunner({ ...b, shouldJoin: async () => { await received; return true; } });
      await runner.start();

      const { cohortId, completion } = service.advertiseCohort(CAS(1));
      // c is a bare actor: its opt-in does not wait in the advert broadcast behind b.
      void c.transport.sendMessage(createCohortOptInMessage({
        from            : c.did,
        to              : service.session.did,
        cohortId,
        participantPk   : c.keys.publicKey.compressed,
        communicationPk : c.keys.publicKey.compressed,
      }), c.did, service.session.did);

      expect(await within(outcome, 2000, 'the late approval')).to.equal('MEMBERSHIP_FINAL');
      expect(rejections).to.deep.equal([{
        cohortId,
        from   : c.did,
        code   : 'MEMBERSHIP_FINAL',
        reason : 'The operator approved the opt-in after finalizeKeygen made the membership final',
      }]);
      expect(service.session.getCohort(cohortId)!.participants).to.deep.equal([ b.did ]);
      // b alone completes the round: the key set still builds the beacon address.
      expect((await completion).signature.length).to.equal(64);
      runner.stop();
      service.stop();
    });

    it('runner: a second opt-in after finalizeKeygen reaches no operator callback', async () => {
      const bus = new MessageBus();
      const b = participantOpts(bus);
      const d = participantOpts(bus);
      const calls: string[] = [];
      let dDeclined!: () => void;
      const declined = new Promise<void>(resolve => { dDeclined = resolve; });
      let keygenDone!: () => void;
      const keygen = new Promise<void>(resolve => { keygenDone = resolve; });
      const service = makeService(bus, {
        // The operator declines the first opt-in of d. It would accept a later one.
        onOptInReceived : async (optIn) => {
          calls.push(optIn.participantDid);
          if(optIn.participantDid !== d.did) return { accepted: true };
          const first = calls.filter(did => did === d.did).length === 1;
          if(first) dDeclined();
          return { accepted: !first };
        },
      });
      service.on('keygen-complete', () => keygenDone());
      // b joins only after the operator declined d, so the cohort finalizes with b.
      const runner = new AggregationParticipantRunner({ ...b, shouldJoin: async () => { await declined; return true; } });
      await runner.start();

      const { cohortId, completion } = service.advertiseCohort(CAS(1));
      // d is a bare actor that sends the same opt-in twice: before and after finalizeKeygen.
      const optIn = () => d.transport.sendMessage(createCohortOptInMessage({
        from            : d.did,
        to              : service.session.did,
        cohortId,
        participantPk   : d.keys.publicKey.compressed,
        communicationPk : d.keys.publicKey.compressed,
      }), d.did, service.session.did);
      void optIn();
      await within(keygen, 2000, 'keygen');
      await optIn();
      await settle();

      expect(calls.filter(did => did === d.did)).to.have.length(1);
      expect(service.session.getCohort(cohortId)!.participants).to.deep.equal([ b.did ]);
      expect((await completion).signature.length).to.equal(64);
      runner.stop();
      service.stop();
    });

    for(const how of [ 'stopCohort', 'stop' ] as const) {
      it(`runner: an approval that returns after ${how}() gives no event`, async () => {
        const bus = new MessageBus();
        const c = participantOpts(bus);
        let cReceived!: () => void;
        const received = new Promise<void>(resolve => { cReceived = resolve; });
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const service = makeService(bus, {
          // The operator approves c only after the runner stopped the cohort.
          onOptInReceived : async () => {
            cReceived();
            await gate;
            return { accepted: true };
          },
        });
        const events: string[] = [];
        service.on('message-rejected', ({ code }) => events.push(`message-rejected ${code}`));
        service.on('participant-accepted', ({ participantDid }) => events.push(`participant-accepted ${participantDid}`));
        service.on('error', error => events.push(`error ${error.message}`));

        const { cohortId, completion } = service.advertiseCohort(CAS(1));
        completion.catch(() => { /* stopped below */ });
        void c.transport.sendMessage(createCohortOptInMessage({
          from            : c.did,
          to              : service.session.did,
          cohortId,
          participantPk   : c.keys.publicKey.compressed,
          communicationPk : c.keys.publicKey.compressed,
        }), c.did, service.session.did);
        await within(received, 2000, 'the operator callback');

        if(how === 'stopCohort') service.stopCohort(cohortId);
        else service.stop();
        release();
        await settle();
        expect(events).to.deep.equal([]);
        service.stop();
      });
    }

    it('runner: drops an approval past maxParticipants, with COHORT_FULL', async () => {
      const bus = new MessageBus();
      const members = [ participantOpts(bus), participantOpts(bus), participantOpts(bus) ];
      // The operator never finalizes, so the cohort stays open and full.
      const service = makeService(bus, { onReadyToFinalize: async () => ({ finalize: false }) });
      const full = new Promise<Rejection & { cohortId: string }>(resolve => {
        service.on('message-rejected', rejection => { if(rejection.code === 'COHORT_FULL') resolve(rejection); });
      });
      const runners = members.map(m => new AggregationParticipantRunner(m));
      for(const runner of runners) await runner.start();

      const { cohortId, completion } = service.advertiseCohort({ ...CAS(2), maxParticipants: 2 });
      completion.catch(() => { /* stopped below */ });

      const rejection = await within(full, 2000, 'the surplus approval');
      const participants = service.session.getCohort(cohortId)!.participants;
      expect(participants).to.have.length(2);
      expect(participants).to.not.include(rejection.from);
      expect(rejection).to.deep.equal({
        cohortId,
        from   : rejection.from,
        code   : 'COHORT_FULL',
        reason : 'The operator approved the opt-in after the cohort had 2 participants',
      });
      runners.forEach(runner => runner.stop());
      service.stop();
    });
  });

  describe('the runner applies an approval only to the opt-in that the operator saw', () => {

    /** Send an opt-in of `did` with `key` to the service, outside the advert broadcast. */
    function sendOptIn(transport: MockTransport, did: string, key: Uint8Array, service: AggregationServiceRunner, cohortId: string): Promise<void> {
      return transport.sendMessage(createCohortOptInMessage({
        from            : did,
        to              : service.session.did,
        cohortId,
        participantPk   : key,
        communicationPk : key,
      }), did, service.session.did);
    }

    /**
     * A service runner with a slow operator. The operator decides only after it
     * got two opt-ins, and `decide` gives each decision.
     */
    function slowOperatorService(bus: MessageBus, decide: (optIn: PendingOptIn) => boolean) {
      const received: PendingOptIn[] = [];
      let bothReceived!: () => void;
      const both = new Promise<void>(resolve => { bothReceived = resolve; });
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const service = makeService(bus, {
        onOptInReceived : async (optIn) => {
          received.push(optIn);
          if(received.length === 2) bothReceived();
          await gate;
          return { accepted: decide(optIn) };
        },
      });
      const events: string[] = [];
      service.on('participant-accepted', ({ participantDid }) => events.push(`participant-accepted ${participantDid}`));
      service.on('message-rejected', ({ code }) => events.push(`message-rejected ${code}`));
      service.on('error', error => events.push(`error ${error.message}`));
      // Two participants are necessary, so the cohort stays open after one member.
      const { cohortId, completion } = service.advertiseCohort(CAS(2));
      completion.catch(() => { /* stopped below */ });
      return { service, cohortId, received, both, release, events };
    }

    it('runner: two opt-ins of one DID with the same key give one participant-accepted event', async () => {
      const bus = new MessageBus();
      const d = participantOpts(bus);
      const { service, cohortId, both, release, events } = slowOperatorService(bus, () => true);

      // d is a bare actor: the two opt-ins wait for the operator at the same time.
      void sendOptIn(d.transport, d.did, d.keys.publicKey.compressed, service, cohortId);
      void sendOptIn(d.transport, d.did, d.keys.publicKey.compressed, service, cohortId);
      await within(both, 2000, 'two operator calls');
      release();
      await settle();

      // The first approval is for the old record, so the runner drops it with no event.
      expect(events).to.deep.equal([ `participant-accepted ${d.did}` ]);
      const cohort = service.session.getCohort(cohortId);
      expect(cohort, 'the cohort stays in the session').to.not.equal(undefined);
      expect(cohort!.participants).to.deep.equal([ d.did ]);
      expect(cohort!.cohortKeys.map(k => bytesToHex(k))).to.deep.equal([ bytesToHex(d.keys.publicKey.compressed) ]);
      service.stop();
    });

    it('runner: an approval of key A after an opt-in with key B seats no key', async () => {
      const bus = new MessageBus();
      const d = participantOpts(bus);
      const keyA = d.keys.publicKey.compressed;
      const keyB = SchnorrKeyPair.generate().publicKey.compressed;
      // The operator approves key A and declines key B.
      const { service, cohortId, received, both, release, events } = slowOperatorService(bus,
        optIn => bytesToHex(optIn.participantPk) === bytesToHex(keyA));

      void sendOptIn(d.transport, d.did, keyA, service, cohortId);
      void sendOptIn(d.transport, d.did, keyB, service, cohortId);
      await within(both, 2000, 'two operator calls');
      release();
      await settle();

      expect(received.map(optIn => bytesToHex(optIn.participantPk))).to.deep.equal([ bytesToHex(keyA), bytesToHex(keyB) ]);
      expect(events).to.deep.equal([]);
      const cohort = service.session.getCohort(cohortId);
      expect(cohort, 'the cohort stays in the session').to.not.equal(undefined);
      expect(cohort!.participants).to.deep.equal([]);
      expect(cohort!.cohortKeys.map(k => bytesToHex(k))).to.not.include(bytesToHex(keyB));
      expect(service.session.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Advertised);
      service.stop();
    });

    it('runner: an approval of the old opt-in after the new opt-in made the DID a member gives no event', async () => {
      const bus = new MessageBus();
      const d = participantOpts(bus);
      let bothReceived!: () => void;
      const both = new Promise<void>(resolve => { bothReceived = resolve; });
      let releaseOld!: () => void;
      const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
      let releaseNew!: () => void;
      const newGate = new Promise<void>(resolve => { releaseNew = resolve; });
      let calls = 0;
      const service = makeService(bus, {
        // The operator approves each opt-in. The decision for the old opt-in returns last.
        onOptInReceived : async () => {
          calls += 1;
          const gate = calls === 1 ? oldGate : newGate;
          if(calls === 2) bothReceived();
          await gate;
          return { accepted: true };
        },
      });
      const events: string[] = [];
      service.on('participant-accepted', ({ participantDid }) => events.push(`participant-accepted ${participantDid}`));
      service.on('keygen-complete', () => events.push('keygen-complete'));
      service.on('message-rejected', ({ from, code }) => events.push(`message-rejected ${code} ${from}`));
      service.on('error', error => events.push(`error ${error.message}`));
      const keygen = new Promise<void>(resolve => { service.on('keygen-complete', () => resolve()); });
      // One participant is sufficient, so the decision for the new opt-in finalizes the cohort.
      const { cohortId, completion } = service.advertiseCohort(CAS(1));
      completion.catch(() => { /* stopped below */ });

      // d is a bare actor: the two opt-ins wait for the operator at the same time.
      void sendOptIn(d.transport, d.did, d.keys.publicKey.compressed, service, cohortId);
      void sendOptIn(d.transport, d.did, d.keys.publicKey.compressed, service, cohortId);
      await within(both, 2000, 'two operator calls');
      releaseNew();
      await within(keygen, 2000, 'keygen');
      releaseOld();
      await settle();

      // The runner already accepted d, so it drops the old approval with no MEMBERSHIP_FINAL event.
      expect(events).to.deep.equal([ `participant-accepted ${d.did}`, 'keygen-complete' ]);
      expect(service.session.getCohort(cohortId)!.participants).to.deep.equal([ d.did ]);
      service.stop();
    });
  });

  describe('each signature spends the beacon output of the cohort', () => {

    for(const network of [ 'bitcoin', 'mutinynet', 'regtest', 'testnet4', 'signet' ]) {
      it(`beaconScript is the output script of the beacon address (${network})`, () => {
        const cohort = new AggregationCohort({
          network,
          recoveryKey      : SchnorrKeyPair.generate().publicKey.compressed.slice(1),
          recoverySequence : TEST_RECOVERY_SEQUENCE,
        });
        cohort.cohortKeys = [ SchnorrKeyPair.generate(), SchnorrKeyPair.generate() ].map(k => k.publicKey.compressed);
        expect(cohort.beaconScript).to.have.length(0);
        const address = cohort.computeBeaconAddress();

        const expected = bytesToHex(OutScript.encode(Address(getNetwork(network)).decode(address)));
        expect(bytesToHex(cohort.beaconScript)).to.equal(expected);
        // The getter returns a copy.
        cohort.beaconScript.fill(0);
        expect(bytesToHex(cohort.beaconScript)).to.equal(expected);
      });
    }

    it('approveNonce refuses a prevout script that is not the beacon script', () => {
      const { service, parts, dids, cohortId, cohort, toParts } = validatedCohort();
      const requests = service.startSigning(cohortId, beaconTxData(cohort));
      const wrong = bytesToHex(keyPathOnlyScript(cohort));
      (requests.find(m => m.to === dids[0])!.body as Record<string, unknown>).prevOutScriptHex = wrong;
      toParts(requests);

      expectRefusal(() => parts[0]!.approveNonce(cohortId), 'PREVOUT_SCRIPT_MISMATCH',
        `Transaction for cohort ${cohortId} does not spend the beacon address ${cohort.beaconAddress} of the cohort.`);
      expect(parts[0]!.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.AwaitingSigning);
      // The request with the beacon script gets a nonce.
      expect(parts[1]!.approveNonce(cohortId)).to.have.length(1);
      expect(parts[1]!.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.NonceSent);
    });

    it('approveNonce refuses a prevout script that is not hex, with PREVOUT_SCRIPT_MISMATCH', () => {
      const { service, parts, dids, cohortId, cohort, toParts } = validatedCohort();
      const requests = service.startSigning(cohortId, beaconTxData(cohort));
      (requests.find(m => m.to === dids[0])!.body as Record<string, unknown>).prevOutScriptHex = 'zz';
      toParts(requests);

      expectRefusal(() => parts[0]!.approveNonce(cohortId), 'PREVOUT_SCRIPT_MISMATCH',
        `Transaction for cohort ${cohortId} does not spend the beacon address ${cohort.beaconAddress} of the cohort.`);
    });

    /**
     * Cohort B has the same keys and k as cohort A, and another recovery key.
     * Thus its beacon address is different, and its fallback leaf is the same.
     * A coordinator asks a member of A for a fallback signature over a spend of
     * the UTXO of B. The transaction anchors the validated signal of A and sends
     * the value to an address of the coordinator.
     */
    function crossCohortFallback() {
      const validated = validatedCohort();
      const { cohort: a } = validated;
      const b = new AggregationCohort({
        network          : 'mutinynet',
        recoveryKey      : SchnorrKeyPair.generate().publicKey.compressed.slice(1),
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      });
      b.cohortKeys = a.cohortKeys;
      b.computeBeaconAddress();
      // Get the script of B from its address, so the fixture does not need the beaconScript getter.
      const scriptB = OutScript.encode(Address(NET).decode(b.beaconAddress));
      const leafA = buildFallbackLeaf({ cohortKeys: a.cohortKeys, fallbackThreshold: a.effectiveFallbackThreshold });
      const leafB = buildFallbackLeaf({ cohortKeys: b.cohortKeys, fallbackThreshold: b.effectiveFallbackThreshold });
      expect(b.beaconAddress).to.not.equal(a.beaconAddress);
      expect(bytesToHex(leafB)).to.equal(bytesToHex(leafA));

      const value = 100_000n;
      const theft = new Transaction({ version: 2, allowUnknownOutputs: true });
      theft.addInput({ txid: '11'.repeat(32), index: 0, witnessUtxo: { amount: value, script: scriptB } });
      theft.addOutput({ script: p2tr(SchnorrKeyPair.generate().publicKey.compressed.slice(1), undefined, NET).script, amount: value - 500n });
      theft.addOutput({ script: Script.encode([ 'RETURN', a.signalBytes! ]), amount: 0n });
      const request = (to: string, tx: Transaction, prevOutScriptHex: string) => createFallbackAuthorizationRequestMessage({
        from                  : validated.service.did,
        to,
        cohortId              : validated.cohortId,
        sessionId             : 'fallback-session',
        pendingTx             : tx.hex,
        prevOutScriptHex,
        prevOutValue          : value.toString(),
        fallbackLeafScriptHex : bytesToHex(leafA),
      });
      return { ...validated, scriptB, theft, request };
    }

    it('approveFallback refuses a spend of another cohort with the same keys and k', () => {
      const { parts, dids, cohortId, cohort, scriptB, theft, request } = crossCohortFallback();
      parts[0]!.receive(request(dids[0]!, theft, bytesToHex(scriptB)));
      expect(parts[0]!.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.AwaitingFallbackSig);

      expectRefusal(() => parts[0]!.approveFallback(cohortId), 'PREVOUT_SCRIPT_MISMATCH',
        `Transaction for cohort ${cohortId} does not spend the beacon address ${cohort.beaconAddress} of the cohort.`);
      expect(parts[0]!.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.AwaitingFallbackSig);

      // The same request over a spend of the beacon output of the cohort gets a signature.
      const { tx, prevOutScripts } = beaconTxData(cohort);
      parts[1]!.receive(request(dids[1]!, tx, bytesToHex(prevOutScripts[0]!)));
      expect(parts[1]!.approveFallback(cohortId)).to.have.length(1);
      expect(parts[1]!.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.Complete);
    });

    it('approveFallback refuses a prevout script that is not hex, with PREVOUT_SCRIPT_MISMATCH', () => {
      const { parts, dids, cohortId, cohort, request } = crossCohortFallback();
      parts[0]!.receive(request(dids[0]!, beaconTxData(cohort).tx, 'zz'));

      expectRefusal(() => parts[0]!.approveFallback(cohortId), 'PREVOUT_SCRIPT_MISMATCH',
        `Transaction for cohort ${cohortId} does not spend the beacon address ${cohort.beaconAddress} of the cohort.`);
    });

    it('startSigning refuses a prevout script that is not the beacon script; the phase stays Validated', () => {
      const { service, cohortId, cohort } = validatedCohort();
      const txData = beaconTxData(cohort);
      expectRefusal(() => service.startSigning(cohortId, { ...txData, prevOutScripts: [ keyPathOnlyScript(cohort) ] }), 'PREVOUT_SCRIPT_MISMATCH',
        `Cannot start signing for cohort ${cohortId}: txData.prevOutScripts[0] is not the output script of the beacon address ${cohort.beaconAddress}.`);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Validated);

      // The beacon script starts the round.
      expect(service.startSigning(cohortId, txData)).to.have.length(2);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.SigningStarted);
    });

    it('runner: a transaction that does not spend the beacon output fails the cohort', async () => {
      const bus = new MessageBus();
      // onProvideTxData reads `service`. The runner calls onProvideTxData only
      // after the constructor returns.
      const service: AggregationServiceRunner = makeService(bus, {
        onProvideTxData : async ({ cohortId }) => {
          const cohort = service.session.getCohort(cohortId)!;
          return { ...beaconTxData(cohort), prevOutScripts: [ keyPathOnlyScript(cohort) ] };
        },
      });
      const errors: string[] = [];
      service.on('error', error => errors.push((error as AggregationServiceError).type));
      const member = new AggregationParticipantRunner(participantOpts(bus));
      await member.start();

      const { cohortId, completion } = service.advertiseCohort(CAS(1));
      const outcome = completion.then(() => undefined, (error: unknown) => error);

      const error = await within(outcome, 2000, 'the cohort failure');
      expect(error).to.be.instanceOf(Error);
      expect((error as AggregationServiceError).type).to.equal('PREVOUT_SCRIPT_MISMATCH');
      expect(errors).to.deep.equal([ 'PREVOUT_SCRIPT_MISMATCH' ]);
      expect(service.session.getCohort(cohortId)).to.equal(undefined);
      member.stop();
      service.stop();
    });

    it('startSigning refuses a missing prevout script; the phase stays Validated', () => {
      const { service, cohortId, cohort } = validatedCohort();
      expectRefusal(() => service.startSigning(cohortId, { ...beaconTxData(cohort), prevOutScripts: [] }), 'MISSING_PREV_OUT_SCRIPT',
        `Cannot start signing for cohort ${cohortId}: txData.prevOutScripts[0] is missing.`);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Validated);
      expect(service.getSigningSessionId(cohortId)).to.equal(undefined);
    });
  });

  describe('one beacon address of a member has one beacon type', () => {

    for(const [ firstType, secondType ] of [ [ 'CASBeacon', 'SMTBeacon' ], [ 'SMTBeacon', 'CASBeacon' ] ]) {
      it(`refuses a ${secondType} cohort at the beacon address of a ${firstType} cohort, with BEACON_TYPE_CONFLICT`, () => {
        const { member, did, keys, form } = oneMemberService();
        const first = form(firstType);
        first.ready.forEach(m => member.receive(m));
        const beaconAddress = member.joinedCohorts.get(first.cohortId)!.beaconAddress;
        const second = form(secondType);
        expect(second.ready[0]!.body!.beaconAddress, 'one beacon address').to.equal(beaconAddress);

        // The message and the data name the beacon type of each cohort.
        expectTypeConflict(() => second.ready.forEach(m => member.receive(m)), {
          cohortId        : second.cohortId,
          beaconType      : secondType,
          beaconAddress,
          otherCohortId   : first.cohortId,
          otherBeaconType : firstType,
        });
        expect(member.getCohortPhase(second.cohortId)).to.equal(ParticipantCohortPhase.Failed);
        expect([ ...member.joinedCohorts.keys() ]).to.deep.equal([ first.cohortId ]);
        expect(() => member.submitUpdate(second.cohortId, createSignedUpdate(did, keys))).to.throw(/not in CohortReady phase/);
        // The first cohort does not change.
        expect(member.getCohortPhase(first.cohortId)).to.equal(ParticipantCohortPhase.CohortReady);
      });
    }

    for(const beaconType of [ 'CASBeacon', 'SMTBeacon' ]) {
      it(`accepts two ${beaconType} cohorts at one beacon address`, () => {
        const { member, form } = oneMemberService();
        const first = form(beaconType);
        const second = form(beaconType);
        first.ready.forEach(m => member.receive(m));
        second.ready.forEach(m => member.receive(m));

        expect(member.getCohortPhase(second.cohortId)).to.equal(ParticipantCohortPhase.CohortReady);
        const addresses = [ first.cohortId, second.cohortId ].map(id => member.joinedCohorts.get(id)!.beaconAddress);
        expect(addresses[1]).to.equal(addresses[0]);
      });
    }

    for(const [ firstType, secondType ] of [ [ 'CASBeacon', 'SMTBeacon' ], [ 'SMTBeacon', 'CASBeacon' ] ]) {
      it(`accepts a ${firstType} cohort and a ${secondType} cohort at two beacon addresses`, () => {
        const { member, form } = oneMemberService();
        const first = form(firstType);
        // Another recovery sequence gives another beacon address.
        const second = form(secondType, { recoverySequence: TEST_RECOVERY_SEQUENCE + 1 });
        first.ready.forEach(m => member.receive(m));
        second.ready.forEach(m => member.receive(m));

        expect(member.getCohortPhase(first.cohortId)).to.equal(ParticipantCohortPhase.CohortReady);
        expect(member.getCohortPhase(second.cohortId)).to.equal(ParticipantCohortPhase.CohortReady);
        const a = member.joinedCohorts.get(first.cohortId)!;
        const b = member.joinedCohorts.get(second.cohortId)!;
        expect(b.beaconAddress).to.not.equal(a.beaconAddress);
        expect([ a.beaconType, b.beaconType ]).to.deep.equal([ firstType, secondType ]);
      });
    }

    it('a cohort in the phase Complete keeps its beacon type at its beacon address', () => {
      const { service, member, did, keys, form } = oneMemberService();
      const toService = (msgs: BaseMessage[]) => msgs.forEach(m => service.receive(m));
      const toMember = (msgs: BaseMessage[]) => msgs.forEach(m => member.receive(m));
      const first = form('CASBeacon');
      toMember(first.ready);
      toService(member.submitUpdate(first.cohortId, createSignedUpdate(did, keys)));
      toMember(service.buildAndDistribute(first.cohortId));
      toService(member.approveValidation(first.cohortId));
      toMember(service.startSigning(first.cohortId, beaconTxData(service.getCohort(first.cohortId)!)));
      toService(member.approveNonce(first.cohortId));
      toMember(service.sendAggregatedNonce(first.cohortId));
      toService(member.generatePartialSignature(first.cohortId));
      expect(member.getCohortPhase(first.cohortId)).to.equal(ParticipantCohortPhase.Complete);

      const second = form('SMTBeacon');
      expect(() => toMember(second.ready)).to.throw(AggregationParticipantError, /which has the beacon type CASBeacon\.$/);
      expect(member.getCohortPhase(second.cohortId)).to.equal(ParticipantCohortPhase.Failed);
    });

    for(const phase of [ ParticipantCohortPhase.UpdateSubmitted, ParticipantCohortPhase.AwaitingValidation, ParticipantCohortPhase.Failed ]) {
      it(`a cohort in the phase ${phase} keeps its beacon type at its beacon address`, () => {
        const { service, member, did, keys, form } = oneMemberService();
        const toService = (msgs: BaseMessage[]) => msgs.forEach(m => service.receive(m));
        const toMember = (msgs: BaseMessage[]) => msgs.forEach(m => member.receive(m));
        const first = form('CASBeacon');
        toMember(first.ready);
        const beaconAddress = member.joinedCohorts.get(first.cohortId)!.beaconAddress;
        toService(member.submitUpdate(first.cohortId, createSignedUpdate(did, keys)));
        if(phase !== ParticipantCohortPhase.UpdateSubmitted) toMember(service.buildAndDistribute(first.cohortId));
        // A validation rejection sets the phase Failed. The cohort keeps its accepted address.
        if(phase === ParticipantCohortPhase.Failed) toService(member.rejectValidation(first.cohortId));
        expect(member.getCohortPhase(first.cohortId)).to.equal(phase);
        // joinedCohorts lists the cohort. Thus the DID document can already have
        // a CASBeacon service with this address.
        expect(member.joinedCohorts.get(first.cohortId)!.beaconAddress).to.equal(beaconAddress);

        const second = form('SMTBeacon');
        expectTypeConflict(() => toMember(second.ready), {
          cohortId        : second.cohortId,
          beaconType      : 'SMTBeacon',
          beaconAddress,
          otherCohortId   : first.cohortId,
          otherBeaconType : 'CASBeacon',
        });
        expect(member.getCohortPhase(second.cohortId)).to.equal(ParticipantCohortPhase.Failed);
      });
    }

    it('refuses an SMTBeacon cohort of another service at the beacon address of a CASBeacon cohort', () => {
      const { service, newService, member, form } = oneMemberService();
      const first = form('CASBeacon');
      first.ready.forEach(m => member.receive(m));
      const beaconAddress = member.joinedCohorts.get(first.cohortId)!.beaconAddress;
      // The advert gives the recovery terms. Another service can use the same
      // terms, and then it gets the same beacon address.
      const other = newService();
      const second = form('SMTBeacon', {}, other);
      expect(other.did).to.not.equal(service.did);
      expect(second.ready[0]!.from).to.equal(other.did);
      expect(second.ready[0]!.body!.beaconAddress, 'one beacon address').to.equal(beaconAddress);

      expectTypeConflict(() => second.ready.forEach(m => member.receive(m)), {
        cohortId        : second.cohortId,
        beaconType      : 'SMTBeacon',
        beaconAddress,
        otherCohortId   : first.cohortId,
        otherBeaconType : 'CASBeacon',
      });
      expect(member.getCohortPhase(second.cohortId)).to.equal(ParticipantCohortPhase.Failed);
      expect([ ...member.joinedCohorts.keys() ]).to.deep.equal([ first.cohortId ]);
    });

    it('finds the cohort at the shared beacon address among three accepted cohorts', () => {
      const { member, form } = oneMemberService();
      const accept = (beaconType: string, config: Partial<CohortConfig> = {}) => {
        const { cohortId, ready } = form(beaconType, config);
        ready.forEach(m => member.receive(m));
        return { cohortId, beaconAddress: member.joinedCohorts.get(cohortId)!.beaconAddress };
      };
      // The cohort at the shared address X is not the first accepted cohort and
      // not the last accepted cohort.
      const y = accept('SMTBeacon', { recoverySequence: TEST_RECOVERY_SEQUENCE + 1 });
      const x = accept('CASBeacon');
      const z = accept('CASBeacon', { recoverySequence: TEST_RECOVERY_SEQUENCE + 2 });
      expect(new Set([ y.beaconAddress, x.beaconAddress, z.beaconAddress ]).size, 'three beacon addresses').to.equal(3);

      const smt = form('SMTBeacon');
      expect(smt.ready[0]!.body!.beaconAddress, 'the address X').to.equal(x.beaconAddress);
      expectTypeConflict(() => smt.ready.forEach(m => member.receive(m)), {
        cohortId        : smt.cohortId,
        beaconType      : 'SMTBeacon',
        beaconAddress   : x.beaconAddress,
        otherCohortId   : x.cohortId,
        otherBeaconType : 'CASBeacon',
      });
      expect(member.getCohortPhase(smt.cohortId)).to.equal(ParticipantCohortPhase.Failed);
    });

    it('ignores a repeated COHORT_READY of a refused cohort', () => {
      const { member, form } = oneMemberService();
      form('CASBeacon').ready.forEach(m => member.receive(m));
      const second = form('SMTBeacon');
      expect(() => second.ready.forEach(m => member.receive(m))).to.throw(AggregationParticipantError);

      second.ready.forEach(m => member.receive(m));
      expect(member.getCohortPhase(second.cohortId)).to.equal(ParticipantCohortPhase.Failed);
      expect(member.joinedCohorts.has(second.cohortId)).to.equal(false);
    });

    it('a COHORT_READY with a wrong beacon address lists no cohort and blocks no beacon type', () => {
      const { member, form } = oneMemberService();
      const first = form('CASBeacon');
      const ready = first.ready[0]!;
      const beaconAddress = ready.body!.beaconAddress as string;
      // The member computes the correct address before it compares the two addresses.
      expect(() => member.receive({ ...ready, body: { ...ready.body, beaconAddress: 'tb1p-wrong' } } as BaseMessage))
        .to.throw(/does not match expected tb1p-wrong/);
      expect(member.getCohortPhase(first.cohortId)).to.equal(ParticipantCohortPhase.OptedIn);
      expect(member.joinedCohorts.has(first.cohortId)).to.equal(false);

      // The member did not accept an address for the refused CAS cohort. Thus an
      // SMT cohort can use the address.
      const second = form('SMTBeacon');
      second.ready.forEach(m => member.receive(m));
      expect(member.joinedCohorts.get(second.cohortId)!.beaconAddress).to.equal(beaconAddress);
    });

    it('checks the beacon address before the beacon type', () => {
      const { member, form } = oneMemberService();
      const first = form('CASBeacon');
      first.ready.forEach(m => member.receive(m));
      const beaconAddress = member.joinedCohorts.get(first.cohortId)!.beaconAddress;
      // The SMT cohort has another recovery sequence, so it has another beacon
      // address. Its COHORT_READY claims the address of the CAS cohort.
      const second = form('SMTBeacon', { recoverySequence: TEST_RECOVERY_SEQUENCE + 1 });
      const ready = second.ready[0]!;
      const computed = ready.body!.beaconAddress as string;
      expect(computed).to.not.equal(beaconAddress);

      expectRefusal(() => member.receive({ ...ready, body: { ...ready.body, beaconAddress } } as BaseMessage), 'BEACON_ADDRESS_MISMATCH',
        `Computed beacon address ${computed} does not match expected ${beaconAddress}.`);
      expect(member.getCohortPhase(second.cohortId)).to.equal(ParticipantCohortPhase.OptedIn);
      expect(member.joinedCohorts.has(second.cohortId)).to.equal(false);
    });

    it('runner: refuses the second beacon type with cohort-failed and no error event, and asks for no update', async () => {
      const bus = new MessageBus();
      const service = makeService(bus);
      const opts = participantOpts(bus);
      const provided: string[] = [];
      const member = new AggregationParticipantRunner({
        ...opts,
        onProvideUpdate : async (info) => {
          provided.push(info.cohortId);
          return opts.onProvideUpdate();
        },
      });
      const ready: string[] = [];
      member.on('cohort-ready', ({ cohortId }) => ready.push(cohortId));
      const errors: string[] = [];
      member.on('error', error => errors.push(error.message));
      const failures: Array<{ cohortId: string; reason: string }> = [];
      const failed = new Promise<void>(resolve => {
        member.on('cohort-failed', failure => {
          failures.push(failure);
          resolve();
        });
      });
      await member.start();

      const cas = service.advertiseCohort(CAS(1));
      await within(cas.completion, 2000, 'the CAS cohort');
      const beaconAddress = member.session.joinedCohorts.get(cas.cohortId)!.beaconAddress;
      const smt = service.advertiseCohort({ ...CAS(1), beaconType: 'SMTBeacon' });
      smt.completion.catch(() => { /* stopped below */ });

      await within(failed, 2000, 'the cohort-failed event');
      // The refusal ends only the SMT cohort, the same as a validation rejection.
      await settle();
      expect(failures).to.deep.equal([{
        cohortId : smt.cohortId,
        reason   : conflictMessage({
          cohortId        : smt.cohortId,
          beaconType      : 'SMTBeacon',
          beaconAddress,
          otherCohortId   : cas.cohortId,
          otherBeaconType : 'CASBeacon',
        }),
      }]);
      expect(errors, 'error events').to.deep.equal([]);
      expect(ready).to.deep.equal([ cas.cohortId ]);
      expect(provided).to.deep.equal([ cas.cohortId ]);
      expect(member.session.getCohortPhase(smt.cohortId)).to.equal(ParticipantCohortPhase.Failed);
      member.stop();
      service.stop();
    });

    it('runner: an AggregationParticipantError other than BEACON_TYPE_CONFLICT in the COHORT_READY handler gives an error event and no cohort-failed', async () => {
      const bus = new MessageBus();
      const service = makeService(bus);
      const opts = participantOpts(bus);
      // The app declines through the state machine and then returns an update.
      // Thus submitUpdate throws INVALID_PHASE.
      const member: AggregationParticipantRunner = new AggregationParticipantRunner({
        ...opts,
        onProvideUpdate : async ({ cohortId }) => {
          member.session.declineUpdate(cohortId);
          return opts.onProvideUpdate();
        },
      });
      const failures: string[] = [];
      member.on('cohort-failed', ({ cohortId }) => failures.push(cohortId));
      const errored = new Promise<Error>(resolve => { member.on('error', resolve); });
      await member.start();

      const cas = service.advertiseCohort(CAS(1));
      cas.completion.catch(() => { /* stopped below */ });
      const error = await within(errored, 2000, 'the error event');
      expect(error).to.be.instanceOf(AggregationParticipantError);
      expect((error as AggregationParticipantError).type).to.equal('INVALID_PHASE');
      expect(error.message).to.equal(`Cannot submit update to cohort ${cas.cohortId}: not in CohortReady phase.`);
      await settle();
      expect(failures, 'cohort-failed events').to.deep.equal([]);
      member.stop();
      service.stop();
    });

    for(const held of [ 'shouldJoin', 'onProvideUpdate', 'onValidateData', 'onApproveSigning (nonce)', 'onApproveSigning (fallback)' ] as const) {
      it(`runner: the member sends nothing if the ${held} callback returns after stop()`, async () => {
        const bus = new MessageBus();
        const service = makeService(bus);
        const opts = participantOpts(bus);
        const watch = watchMember(opts.transport);
        let entered!: () => void;
        const waiting = new Promise<void>(resolve => { entered = resolve; });
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const hold = async <T>(value: T): Promise<T> => {
          entered();
          await gate;
          return value;
        };
        const fallback = held === 'onApproveSigning (fallback)';
        // The held callback waits on the gate. For the fallback, the member also
        // holds the nonce approval, so the service can start the fallback.
        const member = new AggregationParticipantRunner({
          ...opts,
          shouldJoin       : async () => held === 'shouldJoin' ? hold(true) : true,
          onProvideUpdate  : async () => held === 'onProvideUpdate' ? hold(await opts.onProvideUpdate()) : opts.onProvideUpdate(),
          onValidateData   : async (info) => held === 'onValidateData' ? hold({ approved: info.matches }) : { approved: info.matches },
          onApproveSigning : async (req: object) => {
            if('fallbackLeafScriptHex' in req) return hold({ approved: true });
            if(fallback) return new Promise<never>(() => { /* held */ });
            return held === 'onApproveSigning (nonce)' ? hold({ approved: true }) : { approved: true };
          },
        });
        await member.start();

        const signing = new Promise<void>(resolve => { service.on('signing-started', () => resolve()); });
        const cohort = service.advertiseCohort(CAS(1));
        cohort.completion.catch(() => { /* stopped below */ });
        if(fallback) {
          await within(signing, 2000, 'the signing request');
          // The in-memory bus waits for the member handler, so do not wait for triggerFallback.
          service.triggerFallback(cohort.cohortId).catch(() => { /* stopped below */ });
        }
        await within(waiting, 2000, `the ${held} callback`);

        member.stop();
        const before = watch.sent.length;
        release();
        await settle();
        expect(watch.sent.slice(before), 'messages after stop()').to.deep.equal([]);
        service.stop();
      });
    }

    for(const [ firstType, secondType ] of [ [ 'SMTBeacon', 'CASBeacon' ], [ 'CASBeacon', 'SMTBeacon' ] ]) {
      it(`joinFirst refuses a ${secondType} cohort at the beacon address of a ${firstType} cohort and resolves with the ${firstType} sidecar`, async () => {
        const bus = new MessageBus();
        const service = makeService(bus);
        const opts = participantOpts(bus);
        const watch = watchMember(opts.transport);
        const provided: string[] = [];
        let updateRequested!: () => void;
        const requested = new Promise<void>(resolve => { updateRequested = resolve; });
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        // The member holds its update for the first cohort until it handles the
        // COHORT_READY of the second cohort.
        const joined = AggregationParticipantRunner.joinFirst({
          ...opts,
          onProvideUpdate : async (info) => {
            provided.push(info.beaconType);
            updateRequested();
            await gate;
            return opts.onProvideUpdate();
          },
        });

        const first = service.advertiseCohort({ ...CAS(1), beaconType: firstType });
        await within(requested, 2000, 'the update request of the first cohort');
        const second = service.advertiseCohort({ ...CAS(1), beaconType: secondType });
        second.completion.catch(() => { /* stopped below */ });
        await within(watch.handled(COHORT_READY, second.cohortId), 2000, 'the COHORT_READY of the second cohort');
        expect(service.session.getCohort(second.cohortId)!.beaconAddress, 'one beacon address')
          .to.equal(service.session.getCohort(first.cohortId)!.beaconAddress);
        release();

        const info = await within(joined, 2000, 'joinFirst');
        expect(info.cohortId).to.equal(first.cohortId);
        expect(info.beaconType).to.equal(firstType);
        expect(info.included).to.equal(true);
        if(firstType === 'CASBeacon') {
          expect(Object.keys(info.casAnnouncement!)).to.deep.equal([ opts.did ]);
          expect(info.smtProof).to.equal(undefined);
        } else {
          expect(info.smtProof).to.be.an('object');
          expect(info.casAnnouncement).to.equal(undefined);
        }
        // For the refused cohort, the member sent only its opt-in and got no update request.
        expect(provided).to.deep.equal([ firstType ]);
        expect(watch.sent.filter(s => s.endsWith(second.cohortId))).to.deep.equal([ `${COHORT_OPT_IN} ${second.cohortId}` ]);
        expect((await within(first.completion, 2000, 'the first cohort')).cohortId).to.equal(first.cohortId);
        service.stop();
      });
    }

    for(const helper of [ 'joinFirst', 'joinMatching' ] as const) {
      it(`${helper}: an error event stops the runner before the promise rejects, so the member sends nothing more`, async () => {
        const bus = new MessageBus();
        let txRequested!: () => void;
        const requested = new Promise<void>(resolve => { txRequested = resolve; });
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        // The operator holds the tx data of the first cohort. Thus the member
        // waits for the signing request of that cohort.
        const service: AggregationServiceRunner = makeService(bus, {
          onProvideTxData : async ({ cohortId }) => {
            txRequested();
            await gate;
            return beaconTxData(service.session.getCohort(cohortId)!);
          },
        });
        const opts = participantOpts(bus);
        const watch = watchMember(opts.transport);
        // The member gets a COHORT_READY with a wrong beacon address for each cohort in `tampered`.
        const tampered = new Set<string>();
        const dispatch = opts.transport.dispatchDirected.bind(opts.transport);
        opts.transport.dispatchDirected = async (recipientDid, type, message) => {
          const m = message as BaseMessage;
          if(type !== COHORT_READY || !tampered.has(m.body?.cohortId as string)) return dispatch(recipientDid, type, message);
          return dispatch(recipientDid, type, { ...m, beaconAddress: 'tb1p-wrong', body: { ...m.body, beaconAddress: 'tb1p-wrong' } });
        };
        const outcome = (helper === 'joinFirst'
          ? AggregationParticipantRunner.joinFirst(opts)
          : AggregationParticipantRunner.joinMatching(opts, 2)
        ).then(() => undefined, (error: unknown) => error);

        const first = service.advertiseCohort(CAS(1));
        first.completion.catch(() => { /* stopped below */ });
        await within(requested, 2000, 'the tx data request of the first cohort');
        const second = service.advertiseCohort(CAS(1));
        second.completion.catch(() => { /* stopped below */ });
        tampered.add(second.cohortId);

        // BEACON_ADDRESS_MISMATCH comes to the 'error' event of the runner.
        const error = await within(outcome, 2000, 'the rejection');
        expect(error).to.be.instanceOf(AggregationCohortError);
        expect((error as AggregationCohortError).type).to.equal('BEACON_ADDRESS_MISMATCH');
        expect((error as Error).message).to.equal(
          `Computed beacon address ${service.session.getCohort(second.cohortId)!.beaconAddress} does not match expected tb1p-wrong.`);

        // After the rejection, the service sends the signing request of the first
        // cohort and advertises a third cohort.
        const before = watch.sent.length;
        const signing = new Promise<void>(resolve => { service.on('signing-started', () => resolve()); });
        release();
        await within(signing, 2000, 'the signing request of the first cohort');
        const third = service.advertiseCohort(CAS(1));
        third.completion.catch(() => { /* stopped below */ });
        await settle();

        // The member sends no nonce for the first cohort and no opt-in for the third cohort.
        expect(watch.sent.slice(before), 'messages after the rejection').to.deep.equal([]);
        expect(service.session.getCohortPhase(first.cohortId)).to.equal(ServiceCohortPhase.SigningStarted);
        expect(service.session.getCohort(third.cohortId)!.participants).to.deep.equal([]);
        service.stop();
      });
    }

    for(const helper of [ 'joinFirst', 'joinMatching' ] as const) {
      it(`${helper}: a fallback approval that returns after the rejection sends no fallback signature`, async () => {
        const bus = new MessageBus();
        const service = makeService(bus);
        const opts = participantOpts(bus);
        const watch = watchMember(opts.transport);
        // The member gets a COHORT_READY with a wrong beacon address for each cohort in `tampered`.
        const tampered = new Set<string>();
        const dispatch = opts.transport.dispatchDirected.bind(opts.transport);
        opts.transport.dispatchDirected = async (recipientDid, type, message) => {
          const m = message as BaseMessage;
          if(type !== COHORT_READY || !tampered.has(m.body?.cohortId as string)) return dispatch(recipientDid, type, message);
          return dispatch(recipientDid, type, { ...m, beaconAddress: 'tb1p-wrong', body: { ...m.body, beaconAddress: 'tb1p-wrong' } });
        };
        let fallbackRequested!: () => void;
        const requested = new Promise<void>(resolve => { fallbackRequested = resolve; });
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        // The member holds the nonce approval. It approves the fallback request
        // only after the helper rejects.
        const memberOpts = {
          ...opts,
          onApproveSigning : async (req: object) => {
            if(!('fallbackLeafScriptHex' in req)) return new Promise<never>(() => { /* held */ });
            fallbackRequested();
            await gate;
            return { approved: true };
          },
        };
        const outcome = (helper === 'joinFirst'
          ? AggregationParticipantRunner.joinFirst(memberOpts)
          : AggregationParticipantRunner.joinMatching(memberOpts, 2)
        ).then(() => undefined, (error: unknown) => error);

        const signing = new Promise<void>(resolve => { service.on('signing-started', () => resolve()); });
        const first = service.advertiseCohort(CAS(1));
        first.completion.catch(() => { /* stopped below */ });
        await within(signing, 2000, 'the signing request of the first cohort');
        // The in-memory bus waits for the member handler, so do not wait for triggerFallback.
        service.triggerFallback(first.cohortId).catch(() => { /* stopped below */ });
        await within(requested, 2000, 'the fallback request of the first cohort');

        const second = service.advertiseCohort(CAS(1));
        second.completion.catch(() => { /* stopped below */ });
        tampered.add(second.cohortId);
        const error = await within(outcome, 2000, 'the rejection');
        expect(error).to.be.instanceOf(AggregationCohortError);
        expect((error as AggregationCohortError).type).to.equal('BEACON_ADDRESS_MISMATCH');

        // The member approves the fallback request after the rejection.
        const before = watch.sent.length;
        release();
        await settle();
        expect(watch.sent.slice(before), 'messages after the rejection').to.deep.equal([]);
        expect(service.session.getCohortPhase(first.cohortId)).to.equal(ServiceCohortPhase.FallbackRequested);
        service.stop();
      });
    }
  });
});
