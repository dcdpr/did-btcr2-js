import { canonicalHashBytes } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { expect } from 'chai';
import type { Event, EventTemplate } from 'nostr-tools';
import { finalizeEvent } from 'nostr-tools';

import { DidBtcr2, resolveBtcr2SenderPk } from '@did-btcr2/method';

import {
  BaseMessage,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  HTTP_ENVELOPE_VERSION,
  MAX_CLOCK_SKEW_SEC,
  NostrTransport,
  SILENT_LOGGER,
  TransportAdapterError,
  TransportFactory,
  signEnvelope,
} from '../src/index.js';
import {
  fakeNostrRelay,
  installFakeRelaySockets,
  uninstallFakeRelaySockets,
} from './helpers/fake-nostr-relay.js';

/**
 * NostrTransport integration tests over an in-process fake relay: the real
 * transport event handlers run against real (validly signed) Nostr events,
 * with no network. Covers malformed wire content (must be dropped, never an
 * unhandled rejection), factory-built transports (bootstrap first-advert
 * discovery via an injected sender resolver), and clockSkewSec clamping.
 */

interface Identity { keys: SchnorrKeyPair; did: string }

let relaySeq = 0;
function freshRelayUrl(): string {
  relaySeq += 1;
  return `ws://nostr.test/r${relaySeq}`;
}

function makeIdentity(network = 'mutinynet'): Identity {
  const keys = SchnorrKeyPair.generate();
  const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network });
  return { keys, did };
}

function makeAdvert(sender: Identity): BaseMessage {
  return new BaseMessage({
    type : COHORT_ADVERT,
    from : sender.did,
    body : {
      cohortId        : 'c-bootstrap',
      minParticipants : 2,
      beaconType      : 'CASBeacon',
      network         : 'mutinynet',
    },
  });
}

/** Wrap envelope JSON in a real, validly-signed kind-1 relay event. */
function toRelayEvent(sender: Identity, content: string, tags: string[][]): Event {
  return finalizeEvent({
    kind       : 1,
    created_at : Math.floor(Date.now() / 1000),
    tags,
    content,
  } as EventTemplate, sender.keys.secretKey.bytes);
}

/**
 * Envelope JSON whose message carries a malformed `__bytes` sentinel, signed
 * with the sender's real key: the envelope signature is valid, so only the
 * malformed content can cause a drop.
 */
function signedMalformedEnvelope(sender: Identity, sentinel: string, opts?: { to?: string }): string {
  const unsigned = {
    v         : HTTP_ENVELOPE_VERSION,
    from      : sender.did,
    ...(opts?.to !== undefined ? { to: opts.to } : {}),
    timestamp : Math.floor(Date.now() / 1000),
    nonce     : bytesToHex(randomBytes(16)),
    message   : {
      type : COHORT_ADVERT,
      from : sender.did,
      body : { cohortId: 'c1', blob: { __bytes: sentinel } },
    },
  };
  const sig = sender.keys.secretKey.sign(canonicalHashBytes(unsigned), { scheme: 'schnorr' });
  return JSON.stringify({ ...unsigned, sig: bytesToHex(sig) });
}

async function waitForSubscriptions(url: string, count: number): Promise<void> {
  const relay = fakeNostrRelay(url);
  const start = Date.now();
  while(relay.subscriptionCount < count) {
    if(Date.now() - start > 2000) {
      throw new Error(`timed out waiting for ${count} subscription(s), saw ${relay.subscriptionCount}`);
    }
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe('NostrTransport (fake relay)', () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown): void => { rejections.push(reason); };

  before(() => installFakeRelaySockets());

  after(() => uninstallFakeRelaySockets());

  beforeEach(() => {
    rejections.length = 0;
    process.on('unhandledRejection', onRejection);
  });

  afterEach(() => {
    process.removeListener('unhandledRejection', onRejection);
  });

  describe('malformed wire content', () => {
    function setupTransport(url: string): { alice: Identity; transport: NostrTransport; delivered: Record<string, unknown>[] } {
      const alice = makeIdentity();
      const transport = new NostrTransport({
        relays          : [url],
        logger          : SILENT_LOGGER,
        resolveSenderPk : resolveBtcr2SenderPk,
      });
      const delivered: Record<string, unknown>[] = [];
      transport.registerActor(alice.did, alice.keys);
      transport.registerMessageHandler(alice.did, COHORT_ADVERT, (msg) => { delivered.push(msg); });
      transport.registerMessageHandler(alice.did, COHORT_OPT_IN, (msg) => { delivered.push(msg); });
      transport.start();
      return { alice, transport, delivered };
    }

    it('drops a broadcast event carrying a non-hex __bytes sentinel, with no unhandled rejection', async () => {
      const url = freshRelayUrl();
      const mallory = makeIdentity();
      const { delivered } = setupTransport(url);
      await waitForSubscriptions(url, 2);

      const event = toRelayEvent(mallory, signedMalformedEnvelope(mallory, 'zz'), [['t', COHORT_ADVERT]]);
      fakeNostrRelay(url).inject(event);
      await new Promise((r) => setTimeout(r, 50));

      expect(delivered).to.deep.equal([]);
      expect(rejections).to.deep.equal([]);
    });

    it('drops a broadcast event carrying an odd-length-hex __bytes sentinel, with no unhandled rejection', async () => {
      const url = freshRelayUrl();
      const mallory = makeIdentity();
      const { delivered } = setupTransport(url);
      await waitForSubscriptions(url, 2);

      const event = toRelayEvent(mallory, signedMalformedEnvelope(mallory, 'abc'), [['t', COHORT_ADVERT]]);
      fakeNostrRelay(url).inject(event);
      await new Promise((r) => setTimeout(r, 50));

      expect(delivered).to.deep.equal([]);
      expect(rejections).to.deep.equal([]);
    });

    it('drops a directed event carrying a malformed __bytes sentinel, with no unhandled rejection', async () => {
      const url = freshRelayUrl();
      const mallory = makeIdentity();
      const { alice, delivered } = setupTransport(url);
      await waitForSubscriptions(url, 2);

      const tags = [['p', bytesToHex(alice.keys.publicKey.x)], ['t', COHORT_OPT_IN]];
      const content = signedMalformedEnvelope(mallory, 'zz', { to: alice.did });
      fakeNostrRelay(url).inject(toRelayEvent(mallory, content, tags));
      await new Promise((r) => setTimeout(r, 50));

      expect(delivered).to.deep.equal([]);
      expect(rejections).to.deep.equal([]);
    });

    it('delivers a valid signed advert through the broadcast path (control)', async () => {
      const url = freshRelayUrl();
      const mallory = makeIdentity();
      const { delivered } = setupTransport(url);
      await waitForSubscriptions(url, 2);

      const envelope = signEnvelope(makeAdvert(mallory), { did: mallory.did, keys: mallory.keys });
      fakeNostrRelay(url).inject(toRelayEvent(mallory, JSON.stringify(envelope), [['t', COHORT_ADVERT]]));

      await new Promise((r) => setTimeout(r, 50));
      expect(delivered).to.have.lengthOf(1);
      expect(delivered[0].from).to.equal(mallory.did);
      expect(delivered[0].cohortId).to.equal('c-bootstrap');
      expect(rejections).to.deep.equal([]);
    });
  });

  describe('TransportFactory bootstrap', () => {
    it('bootstraps first-advert discovery between factory-built transports with no pre-registration', async () => {
      const url = freshRelayUrl();
      const service = makeIdentity();
      const participant = makeIdentity();

      const serviceTransport = TransportFactory.establish({
        type            : 'nostr',
        relays          : [url],
        logger          : SILENT_LOGGER,
        resolveSenderPk : resolveBtcr2SenderPk,
      });
      const participantTransport = TransportFactory.establish({
        type            : 'nostr',
        relays          : [url],
        logger          : SILENT_LOGGER,
        resolveSenderPk : resolveBtcr2SenderPk,
      });

      serviceTransport.registerActor(service.did, service.keys);
      participantTransport.registerActor(participant.did, participant.keys);
      const received = new Promise<Record<string, unknown>>((resolve) => {
        participantTransport.registerMessageHandler(participant.did, COHORT_ADVERT, (msg) => resolve(msg));
      });

      serviceTransport.start();
      participantTransport.start();
      await waitForSubscriptions(url, 4);

      // No registerPeer calls anywhere: the participant authenticates the
      // service's first advert purely through the injected DID resolver.
      await serviceTransport.sendMessage(makeAdvert(service), service.did);

      const advert = await received;
      expect(advert.from).to.equal(service.did);
      expect(advert.cohortId).to.equal('c-bootstrap');
    });

    it('drops the first advert when no sender resolver is configured (documents the bootstrap gap)', async () => {
      const url = freshRelayUrl();
      const service = makeIdentity();
      const participant = makeIdentity();

      const serviceTransport = TransportFactory.establish({ type: 'nostr', relays: [url], logger: SILENT_LOGGER });
      const participantTransport = TransportFactory.establish({ type: 'nostr', relays: [url], logger: SILENT_LOGGER });

      serviceTransport.registerActor(service.did, service.keys);
      participantTransport.registerActor(participant.did, participant.keys);
      let delivered = false;
      participantTransport.registerMessageHandler(participant.did, COHORT_ADVERT, () => { delivered = true; });

      serviceTransport.start();
      participantTransport.start();
      await waitForSubscriptions(url, 4);

      await serviceTransport.sendMessage(makeAdvert(service), service.did);
      await new Promise((r) => setTimeout(r, 50));

      expect(delivered).to.be.false;
    });

    it('forwards clockSkewSec to the Nostr transport', () => {
      expect(() => TransportFactory.establish({ type: 'nostr', clockSkewSec: 0 }))
        .to.throw(TransportAdapterError).with.property('type', 'INVALID_CLOCK_SKEW');
    });
  });

  describe('clockSkewSec clamping', () => {
    it('rejects zero', () => {
      expect(() => new NostrTransport({ clockSkewSec: 0 }))
        .to.throw(TransportAdapterError).with.property('type', 'INVALID_CLOCK_SKEW');
    });

    it('rejects a negative value', () => {
      expect(() => new NostrTransport({ clockSkewSec: -60 }))
        .to.throw(TransportAdapterError).with.property('type', 'INVALID_CLOCK_SKEW');
    });

    it('rejects non-finite values', () => {
      for(const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => new NostrTransport({ clockSkewSec: value }))
          .to.throw(TransportAdapterError).with.property('type', 'INVALID_CLOCK_SKEW');
      }
    });

    it('drops an advert older than the default timestamp window', async () => {
      const url = freshRelayUrl();
      const mallory = makeIdentity();
      const alice = makeIdentity();
      const transport = new NostrTransport({
        relays          : [url],
        logger          : SILENT_LOGGER,
        resolveSenderPk : resolveBtcr2SenderPk,
      });
      transport.registerActor(alice.did, alice.keys);
      let delivered = false;
      transport.registerMessageHandler(alice.did, COHORT_ADVERT, () => { delivered = true; });
      transport.start();
      await waitForSubscriptions(url, 2);

      const stale = Math.floor(Date.now() / 1000) - 250;
      const envelope = signEnvelope(makeAdvert(mallory), { did: mallory.did, keys: mallory.keys }, { timestamp: stale });
      fakeNostrRelay(url).inject(toRelayEvent(mallory, JSON.stringify(envelope), [['t', COHORT_ADVERT]]));
      await new Promise((r) => setTimeout(r, 50));

      expect(delivered).to.be.false;
    });

    it('honors a custom clockSkewSec within the maximum', async () => {
      const url = freshRelayUrl();
      const mallory = makeIdentity();
      const alice = makeIdentity();
      const transport = new NostrTransport({
        relays          : [url],
        logger          : SILENT_LOGGER,
        resolveSenderPk : resolveBtcr2SenderPk,
        clockSkewSec    : MAX_CLOCK_SKEW_SEC,
      });
      transport.registerActor(alice.did, alice.keys);
      const received = new Promise<Record<string, unknown>>((resolve) => {
        transport.registerMessageHandler(alice.did, COHORT_ADVERT, (msg) => resolve(msg));
      });
      transport.start();
      await waitForSubscriptions(url, 2);

      // 250s old: beyond the 60s default but inside the configured 300s window.
      const stale = Math.floor(Date.now() / 1000) - 250;
      const envelope = signEnvelope(makeAdvert(mallory), { did: mallory.did, keys: mallory.keys }, { timestamp: stale });
      fakeNostrRelay(url).inject(toRelayEvent(mallory, JSON.stringify(envelope), [['t', COHORT_ADVERT]]));

      const advert = await received;
      expect(advert.from).to.equal(mallory.did);
    });

    it(`clamps an excessive clockSkewSec to the ${MAX_CLOCK_SKEW_SEC}s maximum`, async () => {
      const url = freshRelayUrl();
      const mallory = makeIdentity();
      const alice = makeIdentity();
      const transport = new NostrTransport({
        relays          : [url],
        logger          : SILENT_LOGGER,
        resolveSenderPk : resolveBtcr2SenderPk,
        clockSkewSec    : 10_000,
      });
      transport.registerActor(alice.did, alice.keys);
      let delivered = false;
      transport.registerMessageHandler(alice.did, COHORT_ADVERT, () => { delivered = true; });
      transport.start();
      await waitForSubscriptions(url, 2);

      // 400s old: inside the configured 10000s but beyond the 300s clamp, so
      // the advert is dropped only if the configured value was clamped.
      const stale = Math.floor(Date.now() / 1000) - 400;
      const envelope = signEnvelope(makeAdvert(mallory), { did: mallory.did, keys: mallory.keys }, { timestamp: stale });
      fakeNostrRelay(url).inject(toRelayEvent(mallory, JSON.stringify(envelope), [['t', COHORT_ADVERT]]));
      await new Promise((r) => setTimeout(r, 50));

      expect(delivered).to.be.false;
    });
  });
});
