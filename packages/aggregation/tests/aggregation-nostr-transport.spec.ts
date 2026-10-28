import { SchnorrMultikey } from '@did-btcr2/integrity';
import { SchnorrKeyPair } from '@did-btcr2/keys';
import type { Btcr2DataIntegrityConfig, GenesisDocumentLike, SignedBTCR2Update, UnsignedBTCR2Update } from '@did-btcr2/method';
import { DidBtcr2, GenesisDocument, resolveBtcr2SenderPk } from '@did-btcr2/method';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { Script, Transaction } from '@scure/btc-signer';
import { expect } from 'chai';
import type { Event, EventTemplate } from 'nostr-tools';
import { finalizeEvent, nip44 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';

import type { BaseBody, Logger } from '../src/index.js';
import {
  AGGREGATED_NONCE,
  AUTHORIZATION_REQUEST,
  AggregationParticipant,
  AggregationParticipantRunner,
  AggregationServiceRunner,
  BaseMessage,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  COHORT_OPT_IN_ACCEPT,
  COHORT_READY,
  DEFAULT_BROADCAST_LOOKBACK_MS,
  DISTRIBUTE_AGGREGATED_DATA,
  FALLBACK_AUTHORIZATION_REQUEST,
  FALLBACK_SIGNATURE,
  KeyPairAggregationSigner,
  NONCE_CONTRIBUTION,
  NostrTransport,
  SIGNATURE_AUTHORIZATION,
  SILENT_LOGGER,
  SUBMIT_NONINCLUDED,
  SUBMIT_UPDATE,
  TransportAdapterError,
  VALIDATION_ACK,
  createCohortOptInMessage,
  createCohortReadyMessage,
} from '../src/index.js';

/**
 * NostrTransport send routing and receive guards.
 * - Send: a message with a recipient goes as kind 1059 (NIP-44 v2) with two `p` tags only.
 *   A COHORT_ADVERT with no recipient goes as kind 1 with the advert `t` tag. The
 *   transport refuses each other message with no recipient.
 * - Receive: the directed path accepts only kind 1059. A parsed value that is not a JSON
 *   object is dropped. A handler failure or a logger failure never leaves `onevent` as a
 *   rejection.
 */

const TEST_RECOVERY_KEY = 'a'.repeat(64);
const MAX_PLAINTEXT_BYTES = 65_535;

const k1Did = (keys: SchnorrKeyPair): string =>
  DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

const xHex = (keys: SchnorrKeyPair): string => bytesToHex(keys.publicKey.x);

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).byteLength;

const wireReplacer = (_key: string, value: unknown): unknown =>
  value instanceof Uint8Array ? { __bytes: bytesToHex(value) } : value;

const wireReviver = (_key: string, value: unknown): unknown =>
  value && typeof value === 'object' && '__bytes' in (value as Record<string, unknown>)
    ? hexToBytes((value as { __bytes: string }).__bytes)
    : value;

/** The value that a receiver gets from the wire form of `message`. */
const onTheWire = (message: BaseMessage): unknown => JSON.parse(JSON.stringify(message, wireReplacer), wireReviver);

const settle = (ms = 10): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** An x1 identity: keys, a genesis whose capabilityInvocation[0] is those keys, and the x1 DID. */
function externalIdentity(): { keys: SchnorrKeyPair; did: string; genesisDocument: Record<string, unknown> } {
  const keys = SchnorrKeyPair.generate();
  const genesisDocument: Record<string, unknown> = {
    'id'                 : 'did:btcr2:_',
    '@context'           : ['https://www.w3.org/ns/did/v1.1', 'https://btcr2.dev/context/v1'],
    'verificationMethod' : [{
      'id'                 : 'did:btcr2:_#key-0',
      'type'               : 'Multikey',
      'controller'         : 'did:btcr2:_',
      'publicKeyMultibase' : keys.publicKey.multibase.encoded,
    }],
    'authentication'       : ['did:btcr2:_#key-0'],
    'assertionMethod'      : ['did:btcr2:_#key-0'],
    'capabilityInvocation' : ['did:btcr2:_#key-0'],
    'capabilityDelegation' : ['did:btcr2:_#key-0'],
    'service'              : [{
      'id'              : 'did:btcr2:_#service-0',
      'type'            : 'SingletonBeacon',
      'serviceEndpoint' : 'bitcoin:mhME7XiWpho6Ft4pvT3U3h6X8hHtE58ZDJ',
    }],
  };
  const genesisBytes = GenesisDocument.toGenesisBytes(genesisDocument as GenesisDocumentLike);
  return { keys, did: DidBtcr2.create(genesisBytes, { idType: 'EXTERNAL', network: 'mutinynet' }), genesisDocument };
}

/** A signed update that the service can verify against the opt-in participantPk of the sender. */
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
    verificationMethod : verificationMethodId,
    proofPurpose       : 'capabilityInvocation',
    capability         : `urn:zcap:root:${encodeURIComponent(did)}`,
    capabilityAction   : 'Write',
    invocationTarget   : did,
  };
  const multikey = SchnorrMultikey.fromSecretKey(verificationMethodId, did, keys.secretKey.bytes);
  return multikey.toCryptosuite().toDataIntegrityProof().addProof(unsigned, config) as SignedBTCR2Update;
}

const advertBody = (cohortId: string, communicationPk: Uint8Array): BaseBody => ({
  cohortId,
  network          : 'mutinynet',
  communicationPk,
  beaconType       : 'SMTBeacon',
  minParticipants  : 2,
  recoveryKey      : TEST_RECOVERY_KEY,
  recoverySequence : 144,
  fundingModel     : 'operator-funded',
});

// ------------------------------------------------------------------ relay harness

interface Subscription {
  filter:  Record<string, unknown>;
  onevent: (event: Event) => unknown;
  closed:  boolean;
}

/**
 * Stand in for the relay pool. The harness records each subscription and each published
 * event. `deliver` gives an event to each open subscription whose filter matches it, as a
 * relay does. A test can also call `onevent` of one subscription directly.
 */
class RelayHarness {
  readonly subscriptions: Subscription[] = [];
  readonly published: Event[] = [];
  /** The answer of the publish stub: one promise per relay. */
  publishAnswer: () => Promise<string>[] = () => [ Promise.resolve('ok') ];
  #subscribeMany?: unknown;
  #publish?: unknown;

  install(): void {
    const proto = SimplePool.prototype as unknown as Record<string, unknown>;
    this.#subscribeMany = proto.subscribeMany;
    this.#publish = proto.publish;
    const harness = this;
    proto.subscribeMany = function(_relays: string[], filter: Record<string, unknown>, handlers: { onevent: (event: Event) => unknown }) {
      const sub: Subscription = { filter, onevent: handlers.onevent, closed: false };
      harness.subscriptions.push(sub);
      return { close: (): void => { sub.closed = true; } };
    };
    proto.publish = function(_relays: string[], event: Event): Promise<string>[] {
      harness.published.push(event);
      return harness.publishAnswer();
    };
  }

  restore(): void {
    const proto = SimplePool.prototype as unknown as Record<string, unknown>;
    if(this.#subscribeMany) proto.subscribeMany = this.#subscribeMany;
    if(this.#publish) proto.publish = this.#publish;
    this.subscriptions.length = 0;
    this.published.length = 0;
  }

  /** The open broadcast subscriptions (the ones that filter on a `t` tag). */
  broadcastSubs(): Subscription[] {
    return this.subscriptions.filter(sub => !sub.closed && sub.filter['#t']);
  }

  /** The open directed subscription of the actor whose x-only key is `pkHex`. */
  directedSub(pkHex: string): Subscription {
    const sub = this.subscriptions.find(s => !s.closed && (s.filter['#p'] as string[] | undefined)?.includes(pkHex));
    if(!sub) throw new Error(`No directed subscription for ${pkHex}`);
    return sub;
  }

  /** Deliver `event` to each open subscription whose filter matches it. Returns the `onevent` results. */
  deliver(event: Event): unknown[] {
    const results: unknown[] = [];
    for(const sub of this.subscriptions) {
      if(!sub.closed && matches(sub.filter, event)) results.push(sub.onevent(event));
    }
    return results;
  }
}

/** The subset of the NIP-01 filter rules that the transport filters use. */
function matches(filter: Record<string, unknown>, event: Event): boolean {
  const kinds = filter.kinds as number[] | undefined;
  if(kinds && !kinds.includes(event.kind)) return false;
  for(const tag of [ 'p', 't' ]) {
    const values = filter[`#${tag}`] as string[] | undefined;
    if(values && !event.tags.some(t => t[0] === tag && values.includes(t[1]))) return false;
  }
  const since = filter.since as number | undefined;
  if(since !== undefined && event.created_at < since) return false;
  return true;
}

/** A plaintext (kind 1) event with the given content. */
function plainEvent(content: string, signWith: SchnorrKeyPair, tags: string[][] = [ [ 't', COHORT_ADVERT ] ]): Event {
  return finalizeEvent({
    kind       : 1,
    created_at : Math.floor(Date.now() / 1000),
    tags       : [ [ 'p', xHex(signWith) ], ...tags ],
    content,
  } as EventTemplate, signWith.secretKey.bytes);
}

/** A kind 1 event that carries `message` as plaintext JSON. */
const plainMessage = (message: BaseMessage, signWith: SchnorrKeyPair, tags?: string[][]): Event =>
  plainEvent(JSON.stringify(message, wireReplacer), signWith, tags);

/** An event of `kind` (default 1059) whose NIP-44 v2 plaintext is `plaintext`, for `recipient`. */
function sealedEvent(plaintext: string, signWith: SchnorrKeyPair, recipient: SchnorrKeyPair, kind = 1059): Event {
  const conversationKey = nip44.v2.utils.getConversationKey(signWith.secretKey.bytes, xHex(recipient));
  return finalizeEvent({
    kind,
    created_at : Math.floor(Date.now() / 1000),
    tags       : [ [ 'p', xHex(signWith) ], [ 'p', xHex(recipient) ] ],
    content    : nip44.v2.encrypt(plaintext, conversationKey),
  } as EventTemplate, signWith.secretKey.bytes);
}

/** An event of `kind` (default 1059) that carries `message` as NIP-44 v2 ciphertext for `recipient`. */
const sealedMessage = (message: BaseMessage, signWith: SchnorrKeyPair, recipient: SchnorrKeyPair, kind?: number): Event =>
  sealedEvent(JSON.stringify(message, wireReplacer), signWith, recipient, kind);

/** Decrypt a kind 1059 event as `recipient` and parse the plaintext with the wire reviver. */
function openSealed(event: Event, recipient: SchnorrKeyPair): unknown {
  const conversationKey = nip44.v2.utils.getConversationKey(recipient.secretKey.bytes, event.pubkey);
  return JSON.parse(nip44.v2.decrypt(event.content, conversationKey), wireReviver);
}

interface RecordingLogger {
  logger: Logger;
  debugs: unknown[][];
  warns:  unknown[][];
  errors: unknown[][];
}

function makeRecordingLogger(): RecordingLogger {
  const debugs: unknown[][] = [];
  const warns: unknown[][] = [];
  const errors: unknown[][] = [];
  const logger: Logger = {
    debug : (...args) => { debugs.push(args); },
    info  : () => {},
    warn  : (...args) => { warns.push(args); },
    error : (...args) => { errors.push(args); },
  };
  return { logger, debugs, warns, errors };
}

/** True if a line of `lines` has a first argument that contains `text`. */
const hasLine = (lines: unknown[][], text: string): boolean =>
  lines.some(args => typeof args[0] === 'string' && args[0].includes(text));

/** Run `fn` and return its rejection (or throw), or undefined if it settles with no error. */
async function caught(fn: () => Promise<unknown>): Promise<unknown> {
  try { await fn(); } catch(err) { return err; }
  return undefined;
}

function expectAdapterError(err: unknown, type: string): TransportAdapterError {
  expect(err).to.be.instanceOf(TransportAdapterError);
  expect((err as TransportAdapterError).type).to.equal(type);
  return err as TransportAdapterError;
}

describe('NostrTransport send routing and receive guards', () => {
  let relay: RelayHarness;
  let registered: Array<{ transport: NostrTransport; did: string }>;
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };

  let serviceKeys: SchnorrKeyPair;
  let serviceDid: string;
  let aliceKeys: SchnorrKeyPair;
  let aliceDid: string;

  beforeEach(() => {
    relay = new RelayHarness();
    relay.install();
    registered = [];
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
    serviceKeys = SchnorrKeyPair.generate();
    serviceDid = k1Did(serviceKeys);
    aliceKeys = SchnorrKeyPair.generate();
    aliceDid = k1Did(aliceKeys);
  });

  afterEach(() => {
    for(const { transport, did } of registered) transport.unregisterActor(did);
    process.removeListener('unhandledRejection', onUnhandled);
    relay.restore();
  });

  const makeTransport = (logger: Logger = SILENT_LOGGER): NostrTransport =>
    new NostrTransport({ relays: [ 'wss://relay.invalid' ], logger, resolveSenderPk: resolveBtcr2SenderPk });

  const addActor = (transport: NostrTransport, did: string, keys: SchnorrKeyPair): void => {
    transport.registerActor(did, keys);
    registered.push({ transport, did });
  };

  /** The service as the sender: a started transport with alice as a registered peer. */
  const serviceSender = (logger?: Logger): NostrTransport => {
    const t = makeTransport(logger);
    addActor(t, serviceDid, serviceKeys);
    t.registerPeer(aliceDid, aliceKeys.publicKey.compressed);
    t.start();
    return t;
  };

  /** Alice as the receiver: a started transport with a recording handler for each type in `types`. */
  const aliceReceiver = (types: string[], logger?: Logger): { transport: NostrTransport; received: Record<string, unknown>[] } => {
    const t = makeTransport(logger);
    addActor(t, aliceDid, aliceKeys);
    const received: Record<string, unknown>[] = [];
    for(const type of types) t.registerMessageHandler(aliceDid, type, (m: Record<string, unknown>) => { received.push(m); });
    t.start();
    return { transport: t, received };
  };

  const directedMessage = (type: string, from: string, to: string): BaseMessage =>
    new BaseMessage({ type, from, to, body: { cohortId: 'c1', sessionId: 's1', data: 'payload' } });

  describe('send routing', () => {
    it('sends a COHORT_OPT_IN with a genesis document as kind 1059 that only the recipient can read', async () => {
      const external = externalIdentity();
      const t = makeTransport();
      addActor(t, external.did, external.keys);
      t.registerPeer(serviceDid, serviceKeys.publicKey.compressed);
      t.start();

      const optIn = createCohortOptInMessage({
        from            : external.did,
        to              : serviceDid,
        cohortId        : 'c1',
        participantPk   : external.keys.publicKey.compressed,
        communicationPk : external.keys.publicKey.compressed,
        genesisDocument : external.genesisDocument,
      });
      await t.sendMessage(optIn, external.did, serviceDid);

      expect(relay.published).to.have.lengthOf(1);
      const event = relay.published[0];
      expect(event.kind).to.equal(1059);
      expect(() => JSON.parse(event.content)).to.throw();
      expect(event.content).to.not.include('genesis');
      expect(event.tags).to.deep.equal([ [ 'p', xHex(external.keys) ], [ 'p', xHex(serviceKeys) ] ]);

      const opened = openSealed(event, serviceKeys) as { type: string; body: Record<string, unknown> };
      expect(opened).to.deep.equal(onTheWire(optIn));
      expect(opened.type).to.equal(COHORT_OPT_IN);
      expect(opened.body.genesisDocument).to.deep.equal(external.genesisDocument);
    });

    it('sends each other directed type as kind 1059 with no t tag', async () => {
      const t = serviceSender();
      const types = [
        COHORT_ADVERT, COHORT_OPT_IN_ACCEPT, COHORT_READY,
        SUBMIT_UPDATE, SUBMIT_NONINCLUDED, DISTRIBUTE_AGGREGATED_DATA, VALIDATION_ACK,
        AUTHORIZATION_REQUEST, NONCE_CONTRIBUTION, AGGREGATED_NONCE, SIGNATURE_AUTHORIZATION,
        FALLBACK_AUTHORIZATION_REQUEST, FALLBACK_SIGNATURE,
      ];
      for(const type of types) {
        await t.sendMessage(directedMessage(type, serviceDid, aliceDid), serviceDid, aliceDid);
      }
      expect(relay.published).to.have.lengthOf(types.length);
      relay.published.forEach((event, i) => {
        expect(event.kind, types[i]).to.equal(1059);
        expect(event.tags, types[i]).to.deep.equal([ [ 'p', xHex(serviceKeys) ], [ 'p', xHex(aliceKeys) ] ]);
        expect(event.tags.some(tag => tag[0] === 't'), types[i]).to.be.false;
        expect((openSealed(event, aliceKeys) as { type: string }).type).to.equal(types[i]);
      });
    });

    it('sends a COHORT_ADVERT with no recipient as kind 1 with the advert t tag', async () => {
      const t = serviceSender();
      const advert = new BaseMessage({ type: COHORT_ADVERT, from: serviceDid, body: advertBody('c1', serviceKeys.publicKey.compressed) });
      await t.sendMessage(advert, serviceDid);

      expect(relay.published).to.have.lengthOf(1);
      const event = relay.published[0];
      expect(event.kind).to.equal(1);
      expect(JSON.parse(event.content, wireReviver)).to.deep.equal(onTheWire(advert));
      expect(event.tags).to.deep.equal([ [ 'p', xHex(serviceKeys) ], [ 't', COHORT_ADVERT ] ]);
    });

    it('publishRepeating of an advert publishes kind 1', async () => {
      const t = serviceSender();
      const advert = new BaseMessage({ type: COHORT_ADVERT, from: serviceDid, body: advertBody('c1', serviceKeys.publicKey.compressed) });
      const stop = t.publishRepeating(advert, serviceDid, 60_000);
      stop();
      await settle();
      expect(relay.published).to.have.lengthOf(1);
      expect(relay.published[0].kind).to.equal(1);
      expect(relay.published[0].tags).to.deep.equal([ [ 'p', xHex(serviceKeys) ], [ 't', COHORT_ADVERT ] ]);
    });

    it('refuses a keygen and an update message to an unregistered recipient with UNKNOWN_PEER_ERROR', async () => {
      const t = serviceSender();
      const strangerDid = k1Did(SchnorrKeyPair.generate());
      for(const type of [ COHORT_OPT_IN, SUBMIT_UPDATE ]) {
        const err = expectAdapterError(
          await caught(() => t.sendMessage(directedMessage(type, serviceDid, strangerDid), serviceDid, strangerDid)),
          'UNKNOWN_PEER_ERROR',
        );
        expect(err.data).to.deep.include({ adapter: 'nostr', did: strangerDid });
      }
      expect(relay.published).to.be.empty;
    });

    it('refuses a message other than a COHORT_ADVERT with no recipient with SEND_MESSAGE_ERROR', async () => {
      const t = serviceSender();
      for(const type of [ COHORT_OPT_IN, COHORT_READY, SUBMIT_UPDATE ]) {
        const err = expectAdapterError(
          await caught(() => t.sendMessage(new BaseMessage({ type, from: serviceDid, body: { cohortId: 'c1' } }), serviceDid)),
          'SEND_MESSAGE_ERROR',
        );
        expect(err.message).to.include(type);
        expect(err.data).to.deep.include({ adapter: 'nostr', type });
      }
      expect(relay.published).to.be.empty;
    });

    it('keeps the earlier checks: no type, an unknown sender, and an unknown type', async () => {
      const { logger, warns } = makeRecordingLogger();
      const t = serviceSender(logger);
      expectAdapterError(
        await caught(() => t.sendMessage(new BaseMessage({ type: '', from: serviceDid }), serviceDid, aliceDid)),
        'SEND_MESSAGE_ERROR',
      );
      expectAdapterError(
        await caught(() => t.sendMessage(directedMessage(SUBMIT_UPDATE, aliceDid, serviceDid), aliceDid, serviceDid)),
        'UNKNOWN_ACTOR_ERROR',
      );
      // An unknown type gives a warn line and no publish, with or without a recipient.
      const other = 'https://example.com/other';
      expect(await caught(() => t.sendMessage(new BaseMessage({ type: other, from: serviceDid }), serviceDid))).to.be.undefined;
      expect(await caught(() => t.sendMessage(directedMessage(other, serviceDid, 'did:btcr2:nobody'), serviceDid, 'did:btcr2:nobody'))).to.be.undefined;
      expect(warns.filter(args => String(args[0]).includes(other))).to.have.lengthOf(2);
      expect(relay.published).to.be.empty;
    });

    it('gives PUBLISH_ERROR if all relays refuse the event', async () => {
      const t = serviceSender();
      relay.publishAnswer = () => [ Promise.reject(new Error('blocked')) ];
      expectAdapterError(
        await caught(() => t.sendMessage(directedMessage(SUBMIT_UPDATE, serviceDid, aliceDid), serviceDid, aliceDid)),
        'PUBLISH_ERROR',
      );
    });

    it('publishRepeating of a message that the transport refuses makes no unhandled rejection with a logger that throws', async () => {
      const throwing: Logger = {
        debug : () => { throw new Error('debug failed'); },
        info  : () => {},
        warn  : () => { throw new Error('warn failed'); },
        error : () => { throw new Error('error failed'); },
      };
      const t = serviceSender(throwing);
      // An interval of 5 ms: the first send and the sends of the timer fail.
      const stop = t.publishRepeating(new BaseMessage({ type: COHORT_READY, from: serviceDid, body: { cohortId: 'c1' } }), serviceDid, 5);
      await settle(25);
      stop();
      await settle();
      expect(relay.published).to.be.empty;
      expect(unhandled).to.be.empty;
    });
  });

  describe('plaintext size (the 2-byte NIP-44 v2 length prefix)', () => {
    /** A SUBMIT_UPDATE whose wire JSON is `bytes` UTF-8 bytes, padded with `unit` characters. */
    const sizedMessage = (bytes: number, unit = 'x'): BaseMessage => {
      const make = (data: string): BaseMessage =>
        new BaseMessage({ type: SUBMIT_UPDATE, from: serviceDid, to: aliceDid, body: { cohortId: 'c1', data } });
      const baseBytes = utf8Bytes(JSON.stringify(make(''), wireReplacer));
      const unitBytes = utf8Bytes(unit);
      return make(unit.repeat((bytes - baseBytes) / unitBytes));
    };

    it('publishes a plaintext of exactly 65,535 UTF-8 bytes', async () => {
      const t = serviceSender();
      const message = sizedMessage(MAX_PLAINTEXT_BYTES);
      expect(utf8Bytes(JSON.stringify(message, wireReplacer))).to.equal(MAX_PLAINTEXT_BYTES);
      await t.sendMessage(message, serviceDid, aliceDid);
      expect(relay.published).to.have.lengthOf(1);
      expect(openSealed(relay.published[0], aliceKeys)).to.deep.equal(onTheWire(message));
    });

    it('refuses a plaintext of 65,536 UTF-8 bytes with MESSAGE_TOO_LARGE and publishes nothing', async () => {
      const t = serviceSender();
      const message = sizedMessage(MAX_PLAINTEXT_BYTES + 1);
      expect(utf8Bytes(JSON.stringify(message, wireReplacer))).to.equal(MAX_PLAINTEXT_BYTES + 1);
      const err = expectAdapterError(await caught(() => t.sendMessage(message, serviceDid, aliceDid)), 'MESSAGE_TOO_LARGE');
      expect(err.data).to.deep.equal({
        adapter           : 'nostr',
        type              : SUBMIT_UPDATE,
        plaintextBytes    : MAX_PLAINTEXT_BYTES + 1,
        maxPlaintextBytes : MAX_PLAINTEXT_BYTES,
      });
      expect(relay.published).to.be.empty;
    });

    it('counts UTF-8 bytes, not characters', async () => {
      const t = serviceSender();
      // Each 'é' is 1 UTF-16 code unit and 2 UTF-8 bytes.
      const message = new BaseMessage({ type: SUBMIT_UPDATE, from: serviceDid, to: aliceDid, body: { cohortId: 'c1', data: 'é'.repeat(40_000) } });
      const plaintext = JSON.stringify(message, wireReplacer);
      expect(plaintext.length).to.be.at.most(MAX_PLAINTEXT_BYTES);
      expect(utf8Bytes(plaintext)).to.be.above(MAX_PLAINTEXT_BYTES);
      const err = expectAdapterError(await caught(() => t.sendMessage(message, serviceDid, aliceDid)), 'MESSAGE_TOO_LARGE');
      expect(err.data?.plaintextBytes).to.equal(utf8Bytes(plaintext));
      expect(relay.published).to.be.empty;
    });

    it('publishes a COHORT_ADVERT with no recipient above 65,535 UTF-8 bytes as kind 1 (no size check)', async () => {
      const t = serviceSender();
      const advert = new BaseMessage({
        type : COHORT_ADVERT,
        from : serviceDid,
        body : { ...advertBody('c1', serviceKeys.publicKey.compressed), pad: 'x'.repeat(70_000) } as BaseBody,
      });
      expect(utf8Bytes(JSON.stringify(advert, wireReplacer))).to.be.above(MAX_PLAINTEXT_BYTES);
      await t.sendMessage(advert, serviceDid);
      expect(relay.published).to.have.lengthOf(1);
      expect(relay.published[0].kind).to.equal(1);
      expect(relay.published[0].tags).to.deep.equal([ [ 'p', xHex(serviceKeys) ], [ 't', COHORT_ADVERT ] ]);
    });

    it('refuses a COHORT_READY with 900 cohort keys with MESSAGE_TOO_LARGE', async () => {
      const t = serviceSender();
      const key = SchnorrKeyPair.generate().publicKey.compressed;
      const ready = createCohortReadyMessage({
        from          : serviceDid,
        to            : aliceDid,
        cohortId      : 'c1',
        beaconAddress : 'tb1p'.padEnd(62, 'q'),
        cohortKeys    : Array.from({ length: 900 }, () => key),
      });
      const err = expectAdapterError(await caught(() => t.sendMessage(ready, serviceDid, aliceDid)), 'MESSAGE_TOO_LARGE');
      expect(err.data?.type).to.equal(COHORT_READY);
      expect(err.data?.plaintextBytes).to.be.above(MAX_PLAINTEXT_BYTES);
      expect(relay.published).to.be.empty;
    });
  });

  describe('receive paths', () => {
    it('subscribes the directed path to kind 1059 only and keeps the broadcast filter', () => {
      const before = Date.now();
      const { transport } = aliceReceiver([]);
      const after = Date.now();
      // An actor registered after start() gets the same directed filter.
      const bobKeys = SchnorrKeyPair.generate();
      addActor(transport, k1Did(bobKeys), bobKeys);

      expect(relay.subscriptions).to.have.lengthOf(3);
      const [ broadcast, ...directed ] = relay.subscriptions;
      expect(Object.keys(broadcast.filter)).to.have.members([ 'kinds', '#t', 'since' ]);
      expect(broadcast.filter.kinds).to.deep.equal([ 1 ]);
      expect(broadcast.filter['#t']).to.deep.equal([ COHORT_ADVERT ]);
      expect(broadcast.filter.since).to.be.within(
        Math.floor((before - DEFAULT_BROADCAST_LOOKBACK_MS) / 1000),
        Math.floor((after - DEFAULT_BROADCAST_LOOKBACK_MS) / 1000),
      );
      expect(directed.map(sub => sub.filter)).to.deep.equal([
        { kinds: [ 1059 ], '#p': [ xHex(aliceKeys) ] },
        { kinds: [ 1059 ], '#p': [ xHex(bobKeys) ] },
      ]);
    });

    it('drops a correctly signed kind 1 event from a registered peer on the directed path', () => {
      const { logger, debugs } = makeRecordingLogger();
      const { transport, received } = aliceReceiver([ FALLBACK_AUTHORIZATION_REQUEST ], logger);
      transport.registerPeer(serviceDid, serviceKeys.publicKey.compressed);
      const message = directedMessage(FALLBACK_AUTHORIZATION_REQUEST, serviceDid, aliceDid);
      const sub = relay.directedSub(xHex(aliceKeys));

      sub.onevent(plainMessage(message, serviceKeys, []));
      expect(received).to.be.empty;
      expect(hasLine(debugs, 'kind 1 is not 1059')).to.be.true;

      // Valid NIP-44 v2 ciphertext for alice in an event of another kind: dropped.
      for(const kind of [ 4, 14, 1060 ]) {
        sub.onevent(sealedMessage(message, serviceKeys, aliceKeys, kind));
        expect(received, `kind ${kind}`).to.be.empty;
        expect(hasLine(debugs, `kind ${kind} is not 1059`), `kind ${kind}`).to.be.true;
      }

      // The same message as kind 1059 passes.
      sub.onevent(sealedMessage(message, serviceKeys, aliceKeys));
      expect(received).to.have.lengthOf(1);
      expect(received[0].from).to.equal(serviceDid);
    });

    it('round trip of an x1 COHORT_OPT_IN with a genesis document', async () => {
      const external = externalIdentity();
      const a = makeTransport();
      addActor(a, external.did, external.keys);
      a.registerPeer(serviceDid, serviceKeys.publicKey.compressed);
      a.start();

      const b = makeTransport();
      addActor(b, serviceDid, serviceKeys);
      const received: Record<string, unknown>[] = [];
      b.registerMessageHandler(serviceDid, COHORT_OPT_IN, (m: Record<string, unknown>) => { received.push(m); });
      b.start();
      // B knows no key for the x1 DID: only the genesis document in the opt-in can give it.
      expect(b.getPeerPk(external.did)).to.be.undefined;

      await a.sendMessage(createCohortOptInMessage({
        from            : external.did,
        to              : serviceDid,
        cohortId        : 'c1',
        participantPk   : external.keys.publicKey.compressed,
        communicationPk : external.keys.publicKey.compressed,
        genesisDocument : external.genesisDocument,
      }), external.did, serviceDid);
      expect(relay.published).to.have.lengthOf(1);

      // The relay gives the event to the directed subscription of B and back to A (the self-echo).
      const results = relay.deliver(relay.published[0]);
      expect(results).to.have.lengthOf(2);
      expect(results.every(r => r === undefined)).to.be.true;
      await settle();

      expect(received).to.have.lengthOf(1);
      expect(received[0].type).to.equal(COHORT_OPT_IN);
      expect(received[0].from).to.equal(external.did);
      expect(received[0].genesisDocument).to.deep.equal(external.genesisDocument);
      expect(received[0].communicationPk).to.deep.equal(external.keys.publicKey.compressed);
    });

    describe('a body member inside body', () => {
      const foreignPk = (): Uint8Array => SchnorrKeyPair.generate().publicKey.compressed;

      it('broadcast: the participant records the authenticated key of the advert, not the key in body.body', async () => {
        const { received } = aliceReceiver([ COHORT_ADVERT ]);
        const other = foreignPk();
        const outer = advertBody('c1', serviceKeys.publicKey.compressed);
        const advert = new BaseMessage({
          type : COHORT_ADVERT,
          from : serviceDid,
          body : { ...outer, body: advertBody('c1', other) } as BaseBody,
        });
        relay.broadcastSubs()[0].onevent(plainMessage(advert, serviceKeys));
        await settle();

        expect(received).to.have.lengthOf(1);
        const body = received[0].body as Record<string, unknown>;
        expect(body.communicationPk).to.deep.equal(serviceKeys.publicKey.compressed);
        const participant = new AggregationParticipant({ did: aliceDid, signer: new KeyPairAggregationSigner(aliceKeys) });
        participant.receive(received[0] as unknown as BaseMessage);
        expect(participant.discoveredCohorts.get('c1')?.serviceCommunicationPk).to.deep.equal(serviceKeys.publicKey.compressed);
      });

      it('broadcast: an outer body with no communicationPk does not give the key in body.body', async () => {
        const { received } = aliceReceiver([ COHORT_ADVERT ]);
        const { communicationPk: _omitted, ...outer } = advertBody('c1', serviceKeys.publicKey.compressed);
        const advert = new BaseMessage({
          type : COHORT_ADVERT,
          from : serviceDid,
          body : { ...outer, body: advertBody('c1', foreignPk()) } as BaseBody,
        });
        relay.broadcastSubs()[0].onevent(plainMessage(advert, serviceKeys));
        await settle();

        expect(received).to.have.lengthOf(1);
        expect(received[0].communicationPk).to.equal(undefined);
        expect((received[0].body as Record<string, unknown>).communicationPk).to.equal(undefined);
        const participant = new AggregationParticipant({ did: aliceDid, signer: new KeyPairAggregationSigner(aliceKeys) });
        participant.receive(received[0] as unknown as BaseMessage);
        expect(participant.discoveredCohorts.has('c1')).to.equal(false);
      });

      it('directed: an opt-in keeps its outer body, so the communicationPk of body is the authenticated key', async () => {
        const { received } = aliceReceiver([ COHORT_OPT_IN ]);
        const own = serviceKeys.publicKey.compressed;
        const other = foreignPk();
        const optIn = new BaseMessage({
          type : COHORT_OPT_IN,
          from : serviceDid,
          to   : aliceDid,
          body : {
            cohortId        : 'c1',
            participantPk   : own,
            communicationPk : own,
            body            : { cohortId: 'c1', participantPk: other, communicationPk: other },
          } as BaseBody,
        });
        relay.directedSub(xHex(aliceKeys)).onevent(sealedMessage(optIn, serviceKeys, aliceKeys));
        await settle();

        expect(received).to.have.lengthOf(1);
        const body = received[0].body as Record<string, unknown>;
        expect(received[0].communicationPk).to.deep.equal(own);
        expect(body.communicationPk).to.deep.equal(own);
        expect(body.participantPk).to.deep.equal(own);
      });
    });

    it('drops an event whose sender key resolution throws, with a debug line', () => {
      const { logger, debugs, errors } = makeRecordingLogger();
      const t = new NostrTransport({
        relays          : [ 'wss://relay.invalid' ],
        logger,
        resolveSenderPk : () => { throw new Error('resolver failed'); },
      });
      addActor(t, aliceDid, aliceKeys);
      const received: unknown[] = [];
      t.registerMessageHandler(aliceDid, FALLBACK_AUTHORIZATION_REQUEST, (m: unknown) => { received.push(m); });
      t.start();
      relay.directedSub(xHex(aliceKeys)).onevent(
        sealedMessage(directedMessage(FALLBACK_AUTHORIZATION_REQUEST, serviceDid, aliceDid), serviceKeys, aliceKeys),
      );
      expect(received).to.be.empty;
      expect(hasLine(debugs, 'Sender key resolution failed')).to.be.true;
      expect(errors).to.be.empty;
    });

    describe('receive guards', () => {
      const nonObjects = [ 'null', '5', '[]', '"s"' ];

      it('drops a broadcast content that is not a JSON object, then dispatches a valid advert', async () => {
        const { logger, debugs, errors } = makeRecordingLogger();
        const { received } = aliceReceiver([ COHORT_ADVERT ], logger);
        const [ sub ] = relay.broadcastSubs();
        for(const content of nonObjects) {
          expect(sub.onevent(plainEvent(content, serviceKeys)), content).to.equal(undefined);
        }
        await settle();
        expect(received).to.be.empty;
        expect(debugs.filter(args => String(args[0]).includes('not a JSON object'))).to.have.lengthOf(nonObjects.length);

        const advert = new BaseMessage({ type: COHORT_ADVERT, from: serviceDid, body: advertBody('c1', serviceKeys.publicKey.compressed) });
        expect(sub.onevent(plainMessage(advert, serviceKeys))).to.equal(undefined);
        await settle();
        expect(received).to.have.lengthOf(1);
        expect(received[0].cohortId).to.equal('c1');
        expect(errors).to.be.empty;
        expect(unhandled).to.be.empty;
      });

      it('drops a directed plaintext that is not a JSON object, then dispatches a valid message', async () => {
        const { logger, debugs, errors } = makeRecordingLogger();
        const { transport, received } = aliceReceiver([ SUBMIT_UPDATE ], logger);
        transport.registerPeer(serviceDid, serviceKeys.publicKey.compressed);
        const sub = relay.directedSub(xHex(aliceKeys));
        for(const plaintext of nonObjects) {
          expect(sub.onevent(sealedEvent(plaintext, serviceKeys, aliceKeys)), plaintext).to.equal(undefined);
        }
        await settle();
        expect(received).to.be.empty;
        expect(debugs.filter(args => String(args[0]).includes('not a JSON object'))).to.have.lengthOf(nonObjects.length);

        expect(sub.onevent(sealedMessage(directedMessage(SUBMIT_UPDATE, serviceDid, aliceDid), serviceKeys, aliceKeys))).to.equal(undefined);
        await settle();
        expect(received).to.have.lengthOf(1);
        expect(errors).to.be.empty;
        expect(unhandled).to.be.empty;
      });

      it('drops a bad __bytes value inside the parse step', async () => {
        const { logger, debugs, errors } = makeRecordingLogger();
        const { transport, received } = aliceReceiver([ SUBMIT_UPDATE, COHORT_ADVERT ], logger);
        transport.registerPeer(serviceDid, serviceKeys.publicKey.compressed);
        const bad = JSON.stringify({ type: SUBMIT_UPDATE, from: serviceDid, body: { cohortId: 'c1', key: { __bytes: 'zz' } } });
        relay.directedSub(xHex(aliceKeys)).onevent(sealedEvent(bad, serviceKeys, aliceKeys));
        relay.broadcastSubs()[0].onevent(plainEvent(bad, serviceKeys));
        await settle();
        expect(received).to.be.empty;
        expect(debugs.filter(args => String(args[0]).includes('Failed to parse'))).to.have.lengthOf(2);
        expect(errors).to.be.empty;
        expect(unhandled).to.be.empty;
      });

      it('an unexpected throw inside an event handler gives one error line and no rejection', async () => {
        const { logger, errors } = makeRecordingLogger();
        aliceReceiver([ SUBMIT_UPDATE, COHORT_ADVERT ], logger);
        const hostile = { get kind(): number { throw new Error('kind getter failed'); } } as unknown as Event;
        expect(relay.directedSub(xHex(aliceKeys)).onevent(hostile)).to.equal(undefined);
        expect(relay.broadcastSubs()[0].onevent(hostile)).to.equal(undefined);
        await settle();
        expect(errors).to.have.lengthOf(2);
        expect(hasLine(errors, `Directed event for ${aliceDid}`)).to.be.true;
        expect(hasLine(errors, 'Broadcast event')).to.be.true;
        expect(unhandled).to.be.empty;
      });
    });

    describe('handler failures', () => {
      const failures: Array<[ string, () => unknown ]> = [
        [ 'rejects', () => Promise.reject(new Error('handler rejected')) ],
        [ 'throws', () => { throw new Error('handler threw'); } ],
      ];

      for(const [ label, failing ] of failures) {
        it(`directed: a handler that ${label} gives a warn line with the type and the sender`, async () => {
          const { logger, warns, errors } = makeRecordingLogger();
          const t = makeTransport(logger);
          addActor(t, aliceDid, aliceKeys);
          t.registerPeer(serviceDid, serviceKeys.publicKey.compressed);
          t.registerMessageHandler(aliceDid, AGGREGATED_NONCE, failing);
          t.start();

          const result = relay.directedSub(xHex(aliceKeys)).onevent(
            sealedMessage(directedMessage(AGGREGATED_NONCE, serviceDid, aliceDid), serviceKeys, aliceKeys),
          );
          expect(result).to.equal(undefined);
          await settle();
          expect(warns).to.have.lengthOf(1);
          expect(String(warns[0][0])).to.include(AGGREGATED_NONCE).and.include(serviceDid);
          expect(errors).to.be.empty;
          expect(unhandled).to.be.empty;
        });

        it(`broadcast: a handler that ${label} gives a warn line, and the handler of a later actor still runs`, async () => {
          const { logger, warns, errors } = makeRecordingLogger();
          const t = makeTransport(logger);
          addActor(t, aliceDid, aliceKeys);
          const bobKeys = SchnorrKeyPair.generate();
          const bobDid = k1Did(bobKeys);
          addActor(t, bobDid, bobKeys);
          t.registerMessageHandler(aliceDid, COHORT_ADVERT, failing);
          const bobReceived: unknown[] = [];
          t.registerMessageHandler(bobDid, COHORT_ADVERT, (m: unknown) => { bobReceived.push(m); });
          t.start();

          const advert = new BaseMessage({ type: COHORT_ADVERT, from: serviceDid, body: advertBody('c1', serviceKeys.publicKey.compressed) });
          expect(relay.broadcastSubs()[0].onevent(plainMessage(advert, serviceKeys))).to.equal(undefined);
          await settle();
          expect(bobReceived).to.have.lengthOf(1);
          expect(warns).to.have.lengthOf(1);
          expect(String(warns[0][0])).to.include(COHORT_ADVERT).and.include(serviceDid);
          expect(errors).to.be.empty;
          expect(unhandled).to.be.empty;
        });
      }
    });

    it('each onevent call settles with no rejection if all logger methods throw', async () => {
      const calls = { debug: 0, warn: 0, error: 0 };
      let throwing = false;
      const logger: Logger = {
        debug : () => { calls.debug++; if(throwing) throw new Error('debug failed'); },
        info  : () => { if(throwing) throw new Error('info failed'); },
        warn  : () => { calls.warn++; if(throwing) throw new Error('warn failed'); },
        error : () => { calls.error++; if(throwing) throw new Error('error failed'); },
      };
      const t = makeTransport(logger);
      addActor(t, aliceDid, aliceKeys);
      t.registerPeer(serviceDid, serviceKeys.publicKey.compressed);
      t.registerMessageHandler(aliceDid, COHORT_ADVERT, () => Promise.reject(new Error('handler rejected')));
      t.registerMessageHandler(aliceDid, SUBMIT_UPDATE, () => { throw new Error('handler threw'); });
      t.start();
      // start() writes an info line. The logger throws from here on.
      throwing = true;

      const attackerKeys = SchnorrKeyPair.generate();
      const advert = new BaseMessage({ type: COHORT_ADVERT, from: serviceDid, body: advertBody('c1', serviceKeys.publicKey.compressed) });
      const hostile = { get kind(): number { throw new Error('kind getter failed'); } } as unknown as Event;
      const broadcast = relay.broadcastSubs()[0];
      const directed = relay.directedSub(xHex(aliceKeys));
      const deliveries: Array<[ Subscription, Event ]> = [
        [ broadcast, plainEvent('{', serviceKeys) ],
        [ broadcast, plainEvent('null', serviceKeys) ],
        [ broadcast, plainMessage(advert, attackerKeys) ],
        [ broadcast, plainMessage(advert, serviceKeys) ],
        [ broadcast, hostile ],
        [ directed, plainMessage(directedMessage(SUBMIT_UPDATE, serviceDid, aliceDid), serviceKeys, []) ],
        [ directed, { ...sealedEvent('{}', serviceKeys, aliceKeys), content: 'not ciphertext' } ],
        [ directed, sealedEvent('[]', serviceKeys, aliceKeys) ],
        [ directed, sealedMessage(directedMessage(SUBMIT_UPDATE, serviceDid, aliceDid), serviceKeys, aliceKeys) ],
        [ directed, hostile ],
      ];
      for(const [ sub, event ] of deliveries) {
        let result: unknown = 'not called';
        expect(() => { result = sub.onevent(event); }).to.not.throw();
        expect(result).to.equal(undefined);
      }
      await settle();
      expect(unhandled).to.be.empty;
      // Each path wrote (and the logger threw): parse and guard lines, two handler lines, two unexpected lines.
      expect(calls.debug).to.be.at.least(6);
      expect(calls.warn).to.equal(2);
      expect(calls.error).to.equal(2);
    });
  });

  describe('runners', () => {
    it('complete a k1 + x1 cohort with no peer registered before: each message with a recipient is kind 1059', async function() {
      this.timeout(10_000);
      // The relay gives each published event to each open subscription whose filter matches it.
      relay.publishAnswer = () => {
        const event = relay.published[relay.published.length - 1]!;
        setTimeout(() => relay.deliver(event), 0);
        return [ Promise.resolve('ok') ];
      };

      // The runners must register each recipient key from the advert and the opt-in.
      const bob = externalIdentity();
      const serviceTransport = makeTransport();
      const aliceTransport = makeTransport();
      const bobTransport = makeTransport();
      addActor(serviceTransport, serviceDid, serviceKeys);
      addActor(aliceTransport, aliceDid, aliceKeys);
      addActor(bobTransport, bob.did, bob.keys);
      for(const t of [ serviceTransport, aliceTransport, bobTransport ]) t.start();

      const service = new AggregationServiceRunner({
        transport       : serviceTransport,
        did             : serviceDid,
        keys            : serviceKeys,
        config          : { minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon', recoveryKey: TEST_RECOVERY_KEY, recoverySequence: 144 },
        onProvideTxData : async () => {
          const cohort = service.session.cohorts[0];
          const script: Uint8Array = cohort.beaconScript;
          const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
          tx.addInput({ txid: '00'.repeat(32), index: 0, witnessUtxo: { amount: 100_000n, script } });
          tx.addOutput({ script, amount: 99_500n });
          tx.addOutput({ script: Script.encode([ 'RETURN', cohort.signalBytes! ]), amount: 0n });
          return { tx, prevOutScripts: [ script ], prevOutValues: [ 100_000n ] };
        },
      });
      const participants = [
        new AggregationParticipantRunner({
          transport       : aliceTransport,
          did             : aliceDid,
          keys            : aliceKeys,
          shouldJoin      : async () => true,
          onProvideUpdate : async () => createSignedUpdate(aliceDid, aliceKeys),
        }),
        new AggregationParticipantRunner({
          transport       : bobTransport,
          did             : bob.did,
          keys            : bob.keys,
          genesisDocument : bob.genesisDocument,
          shouldJoin      : async () => true,
          onProvideUpdate : async () => createSignedUpdate(bob.did, bob.keys),
        }),
      ];

      let timer: ReturnType<typeof setTimeout> | undefined;
      const failure = new Promise<never>((_resolve, reject) => {
        service.on('error', reject);
        for(const runner of participants) runner.on('error', reject);
        timer = setTimeout(() => reject(new Error('The cohort did not complete in 8 s')), 8_000);
      });
      try {
        for(const runner of participants) await runner.start();
        const bobComplete = new Promise<void>((resolve) => participants[1]!.on('cohort-complete', () => resolve()));
        const [ result ] = await Promise.race([ Promise.all([ service.run(), bobComplete ]), failure ]);
        expect(result.signature.length).to.equal(64);
      } finally {
        clearTimeout(timer);
        service.stop();
        for(const runner of participants) runner.stop();
      }

      // The service got each peer key from the protocol messages.
      expect(serviceTransport.getPeerPk(aliceDid)).to.deep.equal(aliceKeys.publicKey.compressed);
      expect(serviceTransport.getPeerPk(bob.did)).to.deep.equal(bob.keys.publicKey.compressed);
      // Only the advert is kind 1. Each other event is kind 1059 with the two p tags only.
      const adverts = relay.published.filter(event => event.kind === 1);
      expect(adverts).to.have.length.at.least(1);
      for(const advert of adverts) {
        expect(advert.tags).to.deep.equal([ [ 'p', xHex(serviceKeys) ], [ 't', COHORT_ADVERT ] ]);
      }
      const directed = relay.published.filter(event => event.kind !== 1);
      expect(directed.length).to.be.at.least(10);
      for(const event of directed) {
        expect(event.kind).to.equal(1059);
        expect(event.tags.map(tag => tag[0])).to.deep.equal([ 'p', 'p' ]);
      }
      expect(unhandled).to.be.empty;
    });
  });
});
