import { getNetwork } from '@did-btcr2/bitcoin';
import { SchnorrMultikey } from '@did-btcr2/integrity';
import { SchnorrKeyPair } from '@did-btcr2/keys';
import type { Btcr2DataIntegrityConfig, SignedBTCR2Update, UnsignedBTCR2Update } from '@did-btcr2/method';
import { DidBtcr2 } from '@did-btcr2/method';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, concatBytes } from '@noble/hashes/utils';
import { Address, OutScript, Script, Transaction, p2tr } from '@scure/btc-signer';
import { expect } from 'chai';
import type { AggregationServiceError, BaseMessage, CohortConditions, CohortConfig } from '../src/index.js';
import {
  AggregationCohort,
  AggregationCohortError,
  AggregationParticipant,
  AggregationParticipantError,
  AggregationParticipantRunner,
  AggregationRunner,
  AggregationService,
  AggregationServiceRunner,
  KeyPairAggregationSigner,
  ParticipantCohortPhase,
  ServiceCohortPhase,
  buildFallbackLeaf,
  buildFallbackSpend,
  buildRecoveryLeaves,
  buildRecoveryScript,
  buildRecoverySpend,
  createCohortAdvertMessage,
  createFallbackAuthorizationRequestMessage,
  fallbackSighash,
  isCohortAdvertMessage,
  recoveryLeafParams,
  validateCohortConditions,
} from '../src/index.js';
import { MessageBus, MockTransport } from './helpers/mock-transport.js';

/**
 * Executable coverage for ADR 169: the beacon address of an aggregate cohort is
 * n-of-n by default. Each script leaf is opt-in on both sides:
 * - the service names the leaf in the cohort conditions;
 * - the member allows the leaf (`allowFallbackLeaf`, `allowRecoveryLeaf`).
 */

const NET = getNetwork('mutinynet');
const RECOVERY = SchnorrKeyPair.generate();
const RECOVERY_KEY_HEX = bytesToHex(RECOVERY.publicKey.x);
const RECOVERY_SEQUENCE = 144;
const PAIR_RULE = 'recoveryKey and recoverySequence must be both present or both absent';

/** The four leaf sets: no leaf, fallback leaf A, recovery leaf B, both. */
type LeafSet = 'none' | 'A' | 'B' | 'AB';
const LEAF_SETS: readonly LeafSet[] = [ 'none', 'A', 'B', 'AB' ];

/** The cohort conditions of each leaf set (k = 1). */
function leafConfig(set: LeafSet): Partial<CohortConfig> {
  return {
    ...(set.includes('A') ? { fallbackThreshold: 1 } : {}),
    ...(set.includes('B') ? { recoveryKey: RECOVERY_KEY_HEX, recoverySequence: RECOVERY_SEQUENCE } : {}),
  };
}

/** A cohort with the keys and the leaf set, with its beacon address. */
function cohortOf(cohortKeys: Uint8Array[], set: LeafSet, fallbackThreshold = 1): AggregationCohort {
  const cohort = new AggregationCohort({
    network : 'mutinynet',
    ...(set.includes('A') ? { fallbackThreshold } : {}),
    ...(set.includes('B') ? { recoveryKey: RECOVERY.publicKey.x, recoverySequence: RECOVERY_SEQUENCE } : {}),
  });
  cohort.cohortKeys = cohortKeys;
  cohort.computeBeaconAddress();
  return cohort;
}

const newKeys = (n: number) => Array.from({ length: n }, () => SchnorrKeyPair.generate());

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

/** Runs fn and checks the error class, the type, the full message, and the data. */
function expectError(fn: () => unknown, cls: new (...args: never[]) => Error, type: string, message: string, data?: Record<string, unknown>): void {
  let error: unknown;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  expect(error, `expected ${type}`).to.be.instanceOf(cls);
  expect((error as AggregationServiceError).type).to.equal(type);
  expect((error as Error).message).to.equal(message);
  if(data) expect((error as AggregationServiceError).data).to.deep.equal(data);
}

/**
 * A service and two members with no transport, up to finalizeKeygen. The member
 * has not received COHORT_READY. Each member allows the leaves of `config`.
 */
function untilReady(config: Partial<CohortConfig> = {}) {
  const serviceKeys = SchnorrKeyPair.generate();
  const service = new AggregationService({ did: newDid(serviceKeys), publicKey: serviceKeys.publicKey });
  const keys = newKeys(2);
  const dids = keys.map(newDid);
  const parts = keys.map((k, i) => new AggregationParticipant({
    did               : dids[i]!,
    signer            : new KeyPairAggregationSigner(k),
    allowFallbackLeaf : config.fallbackThreshold !== undefined,
    allowRecoveryLeaf : config.recoveryKey !== undefined,
  }));
  const toParts = (msgs: BaseMessage[]) => msgs.forEach(m => parts.forEach(p => {
    if(!m.to || m.to === p.did) p.receive(m);
  }));
  const toService = (msgs: BaseMessage[]) => msgs.forEach(m => service.receive(m));

  const cohortId = service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon', ...config });
  toParts(service.advertise(cohortId));
  parts.forEach(p => toService(p.joinCohort(cohortId)));
  dids.forEach(did => toParts(service.acceptParticipant(cohortId, did)));
  const ready = service.finalizeKeygen(cohortId);
  return { service, parts, keys, dids, cohortId, ready, toParts, toService };
}

/** A beacon transaction that spends the output of the beacon address and anchors the signal. */
function beaconTxData(beaconAddress: string, signalBytes: Uint8Array) {
  const script = OutScript.encode(Address(NET).decode(beaconAddress));
  const prevOutValue = 100_000n;
  const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
  tx.addInput({ txid: '00'.repeat(32), index: 0, witnessUtxo: { amount: prevOutValue, script } });
  tx.addOutput({ script, amount: prevOutValue - 500n });
  tx.addOutput({ script: Script.encode([ 'RETURN', signalBytes ]), amount: 0n });
  return { tx, prevOutScripts: [ script ], prevOutValues: [ prevOutValue ] };
}

/** A cohort of {@link untilReady} in the SigningStarted phase. */
function signingCohort(config: Partial<CohortConfig> = {}) {
  const formed = untilReady(config);
  const { service, parts, keys, dids, cohortId, ready, toParts, toService } = formed;
  toParts(ready);
  parts.forEach((p, i) => toService(p.submitUpdate(cohortId, createSignedUpdate(dids[i]!, keys[i]!))));
  toParts(service.buildAndDistribute(cohortId));
  parts.forEach(p => toService(p.approveValidation(cohortId)));
  const cohort = service.getCohort(cohortId)!;
  const txData = beaconTxData(cohort.beaconAddress, cohort.signalBytes!);
  toParts(service.startSigning(cohortId, txData));
  expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.SigningStarted);
  return { ...formed, cohort, txData };
}

/** A service runner on the bus. Each round spends the beacon output of the cohort. */
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
    onProvideTxData        : async ({ beaconAddress, signalBytes }) => beaconTxData(beaconAddress, signalBytes),
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

describe('Aggregate beacon leaves are opt-in (ADR 169)', () => {

  describe('the beacon address of each leaf set', () => {
    const keys = newKeys(3).map(k => k.publicKey.compressed);

    for(const set of LEAF_SETS) {
      it(`leaf set ${set}: the tree has only the named leaves, and internal key + tweak*G is the output key`, () => {
        const cohort = cohortOf(keys, set);
        const expected: Uint8Array[] = [
          ...(set.includes('A') ? [ buildFallbackLeaf({ cohortKeys: keys, fallbackThreshold: 1 }) ] : []),
          ...(set.includes('B') ? [ buildRecoveryScript({ recoveryKey: RECOVERY.publicKey.x, recoverySequence: RECOVERY_SEQUENCE }) ] : []),
        ];
        const leaves = buildRecoveryLeaves('operator-funded', {
          cohortKeys        : keys,
          fallbackThreshold : cohort.fallbackThreshold,
          recoveryKey       : cohort.recoveryKey,
          recoverySequence  : cohort.recoverySequence,
        });
        expect(leaves.map(l => bytesToHex(l.script))).to.deep.equal(expected.map(bytesToHex));

        // With no leaf, the root is empty and the tweak is taggedHash("TapTweak", P) (BIP-86 form).
        expect(cohort.tapMerkleRoot).to.have.length(set === 'none' ? 0 : 32);
        expect(bytesToHex(cohort.tapTweak))
          .to.equal(bytesToHex(schnorr.utils.taggedHash('TapTweak', concatBytes(cohort.internalKey, cohort.tapMerkleRoot))));
        const internal = secp256k1.Point.fromHex(`02${bytesToHex(cohort.internalKey)}`);
        const output = internal.add(secp256k1.Point.BASE.multiply(BigInt(`0x${bytesToHex(cohort.tapTweak)}`)));
        expect(bytesToHex(output.toBytes(true).slice(1))).to.equal(bytesToHex(cohort.beaconScript.slice(2)));

        const payment = leaves.length > 0
          ? p2tr(cohort.internalKey, leaves, NET, true)
          : p2tr(cohort.internalKey, undefined, NET);
        expect(cohort.beaconAddress).to.equal(payment.address);
      });
    }

    it('the four leaf sets give four beacon addresses for one key set', () => {
      const addresses = new Set(LEAF_SETS.map(set => cohortOf(keys, set).beaconAddress));
      expect(addresses.size).to.equal(4);
    });

    for(const [ name, half, hasRecoveryKey ] of [
      [ 'recoveryKey only', { recoveryKey: RECOVERY.publicKey.x }, true ],
      [ 'recoverySequence only', { recoverySequence: RECOVERY_SEQUENCE }, false ],
    ] as const) {
      it(`computeBeaconAddress refuses ${name} with INCOMPLETE_RECOVERY_PARAMS`, () => {
        const cohort = new AggregationCohort({ network: 'mutinynet', ...half });
        cohort.cohortKeys = keys;
        expectError(() => cohort.computeBeaconAddress(), AggregationCohortError, 'INCOMPLETE_RECOVERY_PARAMS',
          'The recovery leaf needs both a recovery key and a recovery sequence.',
          { hasRecoveryKey, hasRecoverySequence: !hasRecoveryKey });
      });
    }

    it('recoveryLeafParams returns undefined for no recovery params', () => {
      expect(recoveryLeafParams({})).to.equal(undefined);
    });

    it('recoveryLeafParams returns both recovery params', () => {
      const params = { recoveryKey: RECOVERY.publicKey.x, recoverySequence: RECOVERY_SEQUENCE };
      expect(recoveryLeafParams(params)).to.deep.equal(params);
    });

    for(const set of [ 'none', 'AB' ] as const) {
      it(`participant-funded throws UNSUPPORTED_FUNDING_MODEL with leaf set ${set}`, () => {
        const cohort = new AggregationCohort({
          network      : 'mutinynet',
          fundingModel : 'participant-funded',
          ...(set === 'AB' ? { fallbackThreshold: 1, recoveryKey: RECOVERY.publicKey.x, recoverySequence: RECOVERY_SEQUENCE } : {}),
        });
        cohort.cohortKeys = keys;
        expectError(() => cohort.computeBeaconAddress(), AggregationCohortError, 'UNSUPPORTED_FUNDING_MODEL',
          'Funding model \'participant-funded\' is reserved and not yet implemented.', { fundingModel: 'participant-funded' });
      });
    }
  });

  describe('the recovery pair rule: both terms or neither', () => {
    const conditionRows: Array<[ string, Partial<CohortConditions>, string[] ]> = [
      [ 'no leaf terms', {}, [] ],
      [ 'fallbackThreshold only', { fallbackThreshold: 2 }, [] ],
      [ 'fallbackThreshold 0', { fallbackThreshold: 0 }, [ 'fallbackThreshold must be an integer >= 1' ] ],
      [ 'fallbackThreshold above maxParticipants', { fallbackThreshold: 3, maxParticipants: 2 }, [ 'fallbackThreshold must be <= maxParticipants' ] ],
      [ 'both recovery terms', { recoveryKey: RECOVERY_KEY_HEX, recoverySequence: RECOVERY_SEQUENCE }, [] ],
      [ 'recoveryKey only', { recoveryKey: RECOVERY_KEY_HEX }, [ PAIR_RULE ] ],
      [ 'recoverySequence only', { recoverySequence: RECOVERY_SEQUENCE }, [ PAIR_RULE ] ],
    ];
    for(const [ name, terms, problems ] of conditionRows) {
      it(`validateCohortConditions: ${name} gives ${problems.length} problems`, () => {
        expect(validateCohortConditions({ beaconType: 'CASBeacon', minParticipants: 2, ...terms })).to.deep.equal(problems);
      });
    }

    it('createCohort refuses recoveryKey only with INVALID_COHORT_CONDITIONS', () => {
      const keys = SchnorrKeyPair.generate();
      const service = new AggregationService({ did: newDid(keys), publicKey: keys.publicKey });
      expectError(() => service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon', recoveryKey: RECOVERY_KEY_HEX }),
        Error, 'INVALID_COHORT_CONDITIONS', `Invalid cohort conditions: ${PAIR_RULE}`, { problems: [ PAIR_RULE ] });
    });

    const advertRows: Array<[ string, Record<string, unknown>, boolean ]> = [
      [ 'no leaf terms', {}, true ],
      [ 'both recovery terms', { recoveryKey: RECOVERY_KEY_HEX, recoverySequence: RECOVERY_SEQUENCE }, true ],
      [ 'recoveryKey only', { recoveryKey: RECOVERY_KEY_HEX }, false ],
      [ 'recoverySequence only', { recoverySequence: RECOVERY_SEQUENCE }, false ],
      [ 'a recoveryKey of 63 hex characters', { recoveryKey: RECOVERY_KEY_HEX.slice(1), recoverySequence: RECOVERY_SEQUENCE }, false ],
      [ 'a recoveryKey of 66 hex characters', { recoveryKey: `02${RECOVERY_KEY_HEX}`, recoverySequence: RECOVERY_SEQUENCE }, false ],
      [ 'a recoveryKey that is not hex', { recoveryKey: 'g'.repeat(64), recoverySequence: RECOVERY_SEQUENCE }, false ],
      [ 'a recoveryKey in upper case', { recoveryKey: RECOVERY_KEY_HEX.toUpperCase(), recoverySequence: RECOVERY_SEQUENCE }, true ],
      [ 'recoverySequence 0', { recoveryKey: RECOVERY_KEY_HEX, recoverySequence: 0 }, false ],
      [ 'recoverySequence 0xffff', { recoveryKey: RECOVERY_KEY_HEX, recoverySequence: 0xffff }, true ],
      [ 'recoverySequence 0x10000', { recoveryKey: RECOVERY_KEY_HEX, recoverySequence: 0x10000 }, false ],
    ];
    for(const [ name, terms, accepted ] of advertRows) {
      it(`advert guard: ${name} is ${accepted ? 'accepted' : 'refused'}`, () => {
        const advert = createCohortAdvertMessage({
          from            : 'did:btcr2:service',
          cohortId        : 'cohort-1',
          network         : 'mutinynet',
          communicationPk : SchnorrKeyPair.generate().publicKey.compressed,
          beaconType      : 'CASBeacon',
          minParticipants : 2,
          ...terms,
        } as Parameters<typeof createCohortAdvertMessage>[0]);
        expect(isCohortAdvertMessage(advert)).to.equal(accepted);
      });
    }
  });

  describe('a member refuses each leaf that it does not allow', () => {
    type Allow = { allowFallbackLeaf?: boolean; allowRecoveryLeaf?: boolean };
    const rows: Array<{ set: LeafSet; allow: Allow; refusal?: 'FALLBACK_LEAF_NOT_ALLOWED' | 'RECOVERY_LEAF_NOT_ALLOWED' }> = [
      { set: 'none', allow: {} },
      { set: 'A', allow: {}, refusal: 'FALLBACK_LEAF_NOT_ALLOWED' },
      { set: 'A', allow: { allowRecoveryLeaf: true }, refusal: 'FALLBACK_LEAF_NOT_ALLOWED' },
      { set: 'A', allow: { allowFallbackLeaf: true } },
      { set: 'B', allow: {}, refusal: 'RECOVERY_LEAF_NOT_ALLOWED' },
      { set: 'B', allow: { allowFallbackLeaf: true }, refusal: 'RECOVERY_LEAF_NOT_ALLOWED' },
      { set: 'B', allow: { allowRecoveryLeaf: true } },
      { set: 'AB', allow: { allowFallbackLeaf: true }, refusal: 'RECOVERY_LEAF_NOT_ALLOWED' },
      { set: 'AB', allow: { allowRecoveryLeaf: true }, refusal: 'FALLBACK_LEAF_NOT_ALLOWED' },
      { set: 'AB', allow: { allowFallbackLeaf: true, allowRecoveryLeaf: true } },
    ];
    for(const { set, allow, refusal } of rows) {
      it(`leaf set ${set}, allow ${JSON.stringify(allow)}: ${refusal ?? 'joins'}`, () => {
        const serviceKeys = SchnorrKeyPair.generate();
        const service = new AggregationService({ did: newDid(serviceKeys), publicKey: serviceKeys.publicKey });
        const keys = SchnorrKeyPair.generate();
        const member = new AggregationParticipant({ did: newDid(keys), signer: new KeyPairAggregationSigner(keys), ...allow });
        const cohortId = service.createCohort({ minParticipants: 1, network: 'mutinynet', beaconType: 'CASBeacon', ...leafConfig(set) });
        service.advertise(cohortId).forEach(m => member.receive(m));

        if(refusal === undefined) {
          expect(member.joinCohort(cohortId)).to.have.length(1);
          expect(member.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.OptedIn);
          return;
        }
        const [ message, data ] = refusal === 'FALLBACK_LEAF_NOT_ALLOWED'
          ? [ `Cannot join cohort ${cohortId}: the advert names a 1-of-n fallback leaf, and allowFallbackLeaf is false.`,
            { cohortId, fallbackThreshold: 1 } ]
          : [ `Cannot join cohort ${cohortId}: the advert names a recovery leaf, and allowRecoveryLeaf is false.`,
            { cohortId, recoveryKey: RECOVERY_KEY_HEX, recoverySequence: RECOVERY_SEQUENCE } ];
        expectError(() => member.joinCohort(cohortId), AggregationParticipantError, refusal, message, data);
        expect(member.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.Discovered);
      });
    }

    it('runner: a refused leaf emits error, and the member sends no opt-in', async () => {
      const bus = new MessageBus();
      const service = makeService(bus);
      const opts = participantOpts(bus);
      const sent: string[] = [];
      const send = opts.transport.sendMessage.bind(opts.transport);
      opts.transport.sendMessage = async (message, sender, recipient) => {
        sent.push(message.type);
        return send(message, sender, recipient);
      };
      const member = new AggregationParticipantRunner(opts);
      const refused = new Promise<Error>(resolve => member.on('error', resolve));
      await member.start();

      const { cohortId, completion } = service.advertiseCohort({ minParticipants: 1, network: 'mutinynet', beaconType: 'CASBeacon', fallbackThreshold: 1 });
      completion.catch(() => { /* stopped below */ });
      const error = await within(refused, 2000, 'the refusal');
      expect((error as AggregationParticipantError).type).to.equal('FALLBACK_LEAF_NOT_ALLOWED');
      expect(sent).to.deep.equal([]);
      expect(service.session.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Advertised);
      member.stop();
      service.stop();
    });
  });

  describe('a member refuses a key count n outside the advert bounds', () => {
    // The cohort has 2 members. The test changes the keys of COHORT_READY and
    // the beacon address to match, so only the bound check can refuse.
    const rows: Array<{ n: number; max?: number; refused: boolean }> = [
      { n: 1, max: 3, refused: true },
      { n: 2, max: 3, refused: false },
      { n: 3, max: 3, refused: false },
      { n: 4, max: 3, refused: true },
      { n: 1, refused: true },
      { n: 4, refused: false },
    ];
    for(const { n, max, refused } of rows) {
      it(`n = ${n}, bounds [2, ${max ?? 'none'}]: ${refused ? 'COHORT_SIZE_OUT_OF_BOUNDS' : 'accepted'}`, () => {
        const { parts, dids, cohortId, ready } = untilReady(max === undefined ? {} : { maxParticipants: max });
        const message = ready.find(m => m.to === dids[0])!;
        const own = parts[0]!.publicKey;
        const cohortKeys = [ own, ...newKeys(n - 1).map(k => k.publicKey.compressed) ];
        const changed = {
          ...message,
          body : { ...message.body, cohortKeys, beaconAddress: cohortOf(cohortKeys, 'none').beaconAddress },
        } as BaseMessage;

        if(!refused) {
          parts[0]!.receive(changed);
          expect(parts[0]!.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.CohortReady);
          return;
        }
        expectError(() => parts[0]!.receive(changed), AggregationParticipantError, 'COHORT_SIZE_OUT_OF_BOUNDS',
          `Cohort ${cohortId} has ${n} keys, outside the advertised bounds [2, ${max ?? 'none'}].`,
          { cohortId, n, minParticipants: 2, maxParticipants: max });
        expect(parts[0]!.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.OptedIn);
      });
    }
  });

  describe('a cohort with no fallback leaf has no fallback (NO_FALLBACK_LEAF)', () => {
    it('startFallbackSigning throws NO_FALLBACK_LEAF; the phase stays SigningStarted', () => {
      const { service, cohortId } = signingCohort();
      expectError(() => service.startFallbackSigning(cohortId), Error, 'NO_FALLBACK_LEAF',
        `Cannot start fallback for cohort ${cohortId}: the beacon address has no fallback leaf.`, { cohortId });
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.SigningStarted);
    });

    it('startFallbackSigning with a fallback leaf sends one request to each member', () => {
      const { service, cohortId } = signingCohort({ fallbackThreshold: 1 });
      expect(service.startFallbackSigning(cohortId)).to.have.length(2);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.FallbackRequested);
    });

    it('a member drops a fallback request for a cohort with no fallback leaf; the key path completes', () => {
      const { service, parts, dids, cohortId, cohort, txData, toParts, toService } = signingCohort();
      parts.forEach(p => toService(p.approveNonce(cohortId)));
      const leaf = buildFallbackLeaf({ cohortKeys: cohort.cohortKeys, fallbackThreshold: 1 });
      parts[0]!.receive(createFallbackAuthorizationRequestMessage({
        from                  : service.did,
        to                    : dids[0]!,
        cohortId,
        sessionId             : service.getSigningSessionId(cohortId)!,
        pendingTx             : txData.tx.hex,
        prevOutScriptHex      : bytesToHex(txData.prevOutScripts[0]!),
        prevOutValue          : txData.prevOutValues[0]!.toString(),
        fallbackLeafScriptHex : bytesToHex(leaf),
      }));
      expect(parts[0]!.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.NonceSent);
      expect(parts[0]!.pendingFallbackRequests.has(cohortId)).to.equal(false);

      // The secret nonce is still there, so the member signs the key path.
      toParts(service.sendAggregatedNonce(cohortId));
      parts.forEach(p => toService(p.generatePartialSignature(cohortId)));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
      expect(service.getResult(cohortId)!.path).to.equal('key-path');
    });

    for(const [ name, config, outcome ] of [
      [ 'no fallback leaf', {}, 'COHORT_PHASE_STALLED' ],
      [ 'a 1-of-1 fallback leaf', { fallbackThreshold: 1 }, 'script-path' ],
    ] as const) {
      it(`runner: a stall in signing with autoFallbackOnStall and ${name} gives ${outcome}`, async () => {
        const bus = new MessageBus();
        const service = makeService(bus, { autoFallbackOnStall: true, phaseTimeoutMs: 400 });
        const fallbacks: string[] = [];
        service.on('fallback-started', ({ cohortId }) => fallbacks.push(cohortId));
        // The member refuses the key-path nonce, so the round stalls in
        // signing. The member signs a fallback request.
        const member = new AggregationParticipantRunner({
          ...participantOpts(bus),
          allowFallbackLeaf : 'fallbackThreshold' in config,
          onApproveSigning  : async (req: object) => ({ approved: 'fallbackLeafScriptHex' in req }),
        });
        await member.start();

        const { cohortId, completion } = service.advertiseCohort({ minParticipants: 1, network: 'mutinynet', beaconType: 'CASBeacon', ...config });
        const result = await within(completion.then(r => r.path, (e: unknown) => (e as AggregationCohortError).type), 5000, 'the cohort outcome');
        expect(result).to.equal(outcome);
        expect(fallbacks).to.deep.equal('fallbackThreshold' in config ? [ cohortId ] : []);
        member.stop();
        service.stop();
      });
    }

    it('runner: triggerFallback rejects with NO_FALLBACK_LEAF for a cohort with no fallback leaf', async () => {
      const bus = new MessageBus();
      const service = makeService(bus);
      const member = new AggregationParticipantRunner({
        ...participantOpts(bus),
        onApproveSigning : async () => ({ approved: false }),
      });
      await member.start();
      const signing = new Promise<void>(resolve => { service.on('signing-started', () => resolve()); });
      const { cohortId, completion } = service.advertiseCohort({ minParticipants: 1, network: 'mutinynet', beaconType: 'CASBeacon' });
      completion.catch(() => { /* stopped below */ });
      await within(signing, 2000, 'the signing request');

      const error = await service.triggerFallback(cohortId).then(() => undefined, (e: unknown) => e);
      expect((error as AggregationServiceError).type).to.equal('NO_FALLBACK_LEAF');
      member.stop();
      service.stop();
    });
  });

  describe('a spend builder needs its leaf in the funded output', () => {
    const kps = newKeys(3);
    const keys = kps.map(k => k.publicKey.compressed);
    const value = 100_000n;
    const destination = p2tr(SchnorrKeyPair.generate().publicKey.x, undefined, NET).address!;

    /** A beacon transaction that spends `script` and anchors a signal. */
    function spendOf(script: Uint8Array): Transaction {
      const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
      tx.addInput({ txid: '22'.repeat(32), index: 0, witnessUtxo: { script, amount: value } });
      tx.addOutput({ script: Script.encode([ 'RETURN', new Uint8Array(32).fill(7) ]), amount: 0n });
      tx.addOutputAddress(destination, value - 1000n, NET);
      return tx;
    }

    it('buildFallbackSpend: leaf A with no recovery leaf gives a finalized k-of-n witness', () => {
      const cohort = cohortOf(keys, 'A', 2);
      const tx = spendOf(cohort.beaconScript);
      const leaf = buildFallbackLeaf({ cohortKeys: keys, fallbackThreshold: 2 });
      const sighash = fallbackSighash(tx, 0, cohort.beaconScript, value, leaf);
      const signed = buildFallbackSpend({
        pendingTx         : tx,
        cohortKeys        : keys,
        fallbackThreshold : 2,
        network           : 'mutinynet',
        prevOutScript     : cohort.beaconScript,
        prevOutValue      : value,
        signatures        : [ 0, 1 ].map(i => ({ pubKey: kps[i]!.publicKey.x, signature: schnorr.sign(sighash, kps[i]!.secretKey.bytes) })),
      });
      const witness = signed.getInput(0).finalScriptWitness!;
      expect(bytesToHex(witness[witness.length - 2]!)).to.equal(bytesToHex(leaf));
    });

    for(const [ name, set, recovery ] of [
      [ 'leaf B only', 'B', true ],
      [ 'leaf set AB without the recovery params', 'AB', false ],
    ] as const) {
      it(`buildFallbackSpend refuses ${name} with PREVOUT_SCRIPT_MISMATCH`, () => {
        const cohort = cohortOf(keys, set);
        expectError(() => buildFallbackSpend({
          pendingTx         : spendOf(cohort.beaconScript),
          cohortKeys        : keys,
          fallbackThreshold : 1,
          ...(recovery ? { recoveryKey: RECOVERY.publicKey.x, recoverySequence: RECOVERY_SEQUENCE } : {}),
          network           : 'mutinynet',
          prevOutScript     : cohort.beaconScript,
          prevOutValue      : value,
          signatures        : [],
        }), AggregationCohortError, 'PREVOUT_SCRIPT_MISMATCH', 'Reconstructed beacon output script does not match the spent prevout script.');
      });
    }

    /** The params of a recovery spend of the beacon output of `cohort`. */
    const recoveryOf = (cohort: AggregationCohort, fallbackThreshold?: number) => ({
      cohortKeys         : keys,
      recoverySecretKey  : RECOVERY.secretKey.bytes,
      recoveryKey        : RECOVERY.publicKey.x,
      recoverySequence   : RECOVERY_SEQUENCE,
      fallbackThreshold,
      network            : 'mutinynet',
      utxo               : { txid: '33'.repeat(32), vout: 0, value },
      destinationAddress : destination,
      fee                : 500n,
      beaconAddress      : cohort.beaconAddress,
    });

    it('buildRecoverySpend: leaf B with no fallback leaf spends the recovery leaf', () => {
      const tx = buildRecoverySpend(recoveryOf(cohortOf(keys, 'B')));
      const witness = tx.getInput(0).finalScriptWitness!;
      expect(bytesToHex(witness[1]!))
        .to.equal(bytesToHex(buildRecoveryScript({ recoveryKey: RECOVERY.publicKey.x, recoverySequence: RECOVERY_SEQUENCE })));
      expect(tx.getInput(0).sequence).to.equal(RECOVERY_SEQUENCE);
    });

    for(const [ name, set, fallbackThreshold ] of [
      [ 'no leaf', 'none', undefined ],
      [ 'leaf A only', 'A', 1 ],
      [ 'leaf set AB without fallbackThreshold', 'AB', undefined ],
      [ 'leaf B only with a fallbackThreshold', 'B', 1 ],
    ] as const) {
      it(`buildRecoverySpend refuses ${name} with BEACON_ADDRESS_MISMATCH`, () => {
        const cohort = cohortOf(keys, set);
        let error: unknown;
        try {
          buildRecoverySpend(recoveryOf(cohort, fallbackThreshold));
        } catch (caught) {
          error = caught;
        }
        expect(error).to.be.instanceOf(AggregationCohortError);
        expect((error as AggregationCohortError).type).to.equal('BEACON_ADDRESS_MISMATCH');
        expect((error as AggregationCohortError).data).to.include({ expected: cohort.beaconAddress });
      });
    }
  });

  describe('AggregationRunner.solo: no leaf by default; the config names each leaf', () => {
    for(const set of LEAF_SETS) {
      it(`leaf set ${set}: the cohort completes at the beacon address of the leaf set`, async function() {
        this.timeout(10_000);
        const serviceKeys = SchnorrKeyPair.generate();
        const participantKeys = SchnorrKeyPair.generate();
        const participantDid = newDid(participantKeys);
        let beaconAddress = '';
        const result = await AggregationRunner.solo({
          service         : { did: newDid(serviceKeys), keys: serviceKeys },
          participant     : { did: participantDid, keys: participantKeys },
          config          : { network: 'mutinynet', beaconType: 'CASBeacon', ...leafConfig(set) },
          phaseTimeoutMs  : 3000,
          onProvideUpdate : async () => createSignedUpdate(participantDid, participantKeys),
          onProvideTxData : async ({ beaconAddress: address, signalBytes }) => {
            beaconAddress = address;
            return beaconTxData(address, signalBytes);
          },
        });
        expect(result.path).to.equal('key-path');
        expect(beaconAddress).to.equal(cohortOf([ participantKeys.publicKey.compressed ], set).beaconAddress);
      });
    }
  });
});
