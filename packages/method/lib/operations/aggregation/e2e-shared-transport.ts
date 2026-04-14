/**
 * E2E Demo: Shared In-Process Transport (Runner API)
 *
 * Demonstrates the full Aggregate Beacon protocol end-to-end using the
 * AggregationServiceRunner and AggregationParticipantRunner facades. All
 * three actors (service + two participants) live in one process and share
 * a MessageBus — no relay required.
 *
 * Usage:
 *   npx tsx lib/operations/aggregation/e2e-shared-transport.ts
 */
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { p2tr, Transaction } from '@scure/btc-signer';
import type {
  BaseMessage,
  MessageHandler,
  Transport} from '../../../src/index.js';
import {
  AggregationParticipantRunner,
  AggregationServiceRunner,
  DidBtcr2,
  Resolver,
  Updater,
} from '../../../src/index.js';

interface ActorEntry {
  keys: SchnorrKeyPair;
  handlers: Map<string, MessageHandler>;
}

class MessageBus {
  services: Set<MockTransport> = new Set();

  register(service: MockTransport): void {
    this.services.add(service);
  }

  async deliver(message: BaseMessage, _sender: string, recipient?: string): Promise<void> {
    const type = (message as { type?: string }).type;
    if(!type) return;

    const replacer = (_k: string, v: unknown) => v instanceof Uint8Array ? { __bytes: bytesToHex(v) } : v;
    const reviver = (_k: string, v: unknown) =>
      v && typeof v === 'object' && '__bytes' in (v as Record<string, unknown>)
        ? hexToBytes((v as { __bytes: string }).__bytes)
        : v;
    const raw = JSON.parse(JSON.stringify(message, replacer), reviver);
    const serialized = { ...raw, ...(raw.body ?? {}) };

    if(!recipient) {
      for(const svc of this.services) await svc.dispatchBroadcast(type, serialized);
    } else {
      for(const svc of this.services) {
        if(svc.hasActor(recipient)) {
          await svc.dispatchDirected(recipient, type, serialized);
          return;
        }
      }
    }
  }
}

class MockTransport implements Transport {
  name = 'mock';
  #actors: Map<string, ActorEntry> = new Map();
  #peers: Map<string, Uint8Array> = new Map();

  constructor(public bus: MessageBus) {
    this.bus.register(this);
  }

  start(): void {}
  registerActor(did: string, keys: SchnorrKeyPair): void {
    this.#actors.set(did, { keys, handlers: new Map() });
  }
  getActorPk(did: string): Uint8Array | undefined {
    return this.#actors.get(did)?.keys.publicKey.compressed;
  }
  hasActor(did: string): boolean { return this.#actors.has(did); }
  registerPeer(did: string, pk: Uint8Array): void { this.#peers.set(did, pk); }
  getPeerPk(did: string): Uint8Array | undefined { return this.#peers.get(did); }
  registerMessageHandler(actorDid: string, type: string, handler: MessageHandler): void {
    const actor = this.#actors.get(actorDid);
    if(actor) actor.handlers.set(type, handler);
  }
  async sendMessage(message: BaseMessage, sender: string, recipient?: string): Promise<void> {
    await this.bus.deliver(message, sender, recipient);
  }
  async dispatchBroadcast(type: string, message: unknown): Promise<void> {
    for(const actor of this.#actors.values()) {
      const handler = actor.handlers.get(type);
      if(handler) await handler(message);
    }
  }
  async dispatchDirected(recipientDid: string, type: string, message: unknown): Promise<void> {
    const actor = this.#actors.get(recipientDid);
    if(!actor) return;
    const handler = actor.handlers.get(type);
    if(handler) await handler(message);
  }
}

const serviceKeys = SchnorrKeyPair.generate();
const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

const aliceKeys = SchnorrKeyPair.generate();
const aliceDid = DidBtcr2.create(aliceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

const bobKeys = SchnorrKeyPair.generate();
const bobDid = DidBtcr2.create(bobKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

const bus = new MessageBus();
const serviceTransport = new MockTransport(bus);
const aliceTransport = new MockTransport(bus);
const bobTransport = new MockTransport(bus);

serviceTransport.registerActor(serviceDid, serviceKeys);
aliceTransport.registerActor(aliceDid, aliceKeys);
bobTransport.registerActor(bobDid, bobKeys);

function buildSignedUpdate(did: string, kp: SchnorrKeyPair, beaconAddress: string) {
  const doc = Resolver.deterministic({
    genesisBytes : kp.publicKey.compressed,
    hrp          : 'k',
    idType       : 'KEY',
    version      : 1,
    network      : 'mutinynet',
  });
  const vm = doc.verificationMethod![0];
  const unsigned = Updater.construct(doc, [{
    op    : 'add', path  : '/service/-', value : {
      id              : `${did}#beacon-cas`,
      type            : 'CASBeacon',
      serviceEndpoint : `bitcoin:${beaconAddress}`,
    }
  }], 1);
  return Updater.sign(did, unsigned, vm, kp.raw.secret!);
}

const service = new AggregationServiceRunner({
  transport : serviceTransport,
  did       : serviceDid,
  keys      : serviceKeys,
  config    : { minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' },

  onProvideTxData : async () => {
    // Build a dummy P2TR transaction since we don't have a real funded UTXO
    const cohort = service.session.getCohort(service.session.cohorts[0].id)!;
    const { keyAggExport, keyAggregate } = await import('@scure/btc-signer/musig2');
    const aggPk = keyAggExport(keyAggregate(cohort.cohortKeys));
    const payment = p2tr(aggPk);
    const prevOutValue = 100000n;
    const tx = new Transaction({ version: 2 });
    tx.addInput({
      txid        : '00'.repeat(32),
      index       : 0,
      witnessUtxo : { amount: prevOutValue, script: payment.script },
    });
    tx.addOutput({ script: payment.script, amount: prevOutValue - 500n });
    return { tx, prevOutScripts: [payment.script], prevOutValues: [prevOutValue] };
  },
});

// Optional: monitor progress
service.on('cohort-advertised', ({ cohortId }) => console.log(`[service] cohort ${cohortId} advertised`));
service.on('opt-in-received', (optIn) => console.log(`[service] opt-in from ${optIn.participantDid}`));
service.on('participant-accepted', ({ participantDid }) => console.log(`[service] accepted ${participantDid}`));
service.on('keygen-complete', ({ beaconAddress }) => console.log(`[service] keygen complete: ${beaconAddress}`));
service.on('update-received', ({ participantDid }) => console.log(`[service] update from ${participantDid}`));
service.on('data-distributed', () => console.log('[service] data distributed for validation'));
service.on('validation-received', ({ participantDid, approved }) => console.log(`[service] validation from ${participantDid}: ${approved}`));
service.on('signing-complete', ({ signature }) => console.log(`[service] signature: ${bytesToHex(signature)}`));
service.on('error', (err) => console.error('[service] error:', err.message));

function makeParticipantRunner(name: string, did: string, keys: SchnorrKeyPair, transport: Transport) {
  const runner = new AggregationParticipantRunner({
    transport,
    did,
    keys,
    shouldJoin      : async () => true,
    onProvideUpdate : async ({ beaconAddress }) => buildSignedUpdate(did, keys, beaconAddress),
  });

  runner.on('cohort-discovered', (advert) => console.log(`[${name}] discovered cohort ${advert.cohortId}`));
  runner.on('cohort-joined', ({ cohortId }) => console.log(`[${name}] joined ${cohortId}`));
  runner.on('cohort-ready', ({ beaconAddress }) => console.log(`[${name}] cohort ready: ${beaconAddress}`));
  runner.on('update-submitted', () => console.log(`[${name}] update submitted`));
  runner.on('cohort-complete', ({ beaconAddress }) => console.log(`[${name}] complete: ${beaconAddress}`));
  runner.on('cohort-failed', ({ reason }) => console.log(`[${name}] failed: ${reason}`));
  runner.on('error', (err) => console.error(`[${name}] error:`, err.message));

  return runner;
}

const alice = makeParticipantRunner('alice', aliceDid, aliceKeys, aliceTransport);
const bob = makeParticipantRunner('bob', bobDid, bobKeys, bobTransport);

console.log('\n══ Starting protocol ══\n');

// Participants start listening, then service runs (advertises and drives to completion)
await alice.start();
await bob.start();
const result = await service.run();

console.log('\n══ Result ══');
console.log('Beacon address (add to DID document as CASBeacon serviceEndpoint):');
console.log(`  bitcoin:${service.session.getCohort(result.cohortId)!.beaconAddress}`);
console.log(`Signature length: ${result.signature.length} bytes`);

process.exit(0);
