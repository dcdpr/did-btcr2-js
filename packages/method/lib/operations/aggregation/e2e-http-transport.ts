/**
 * E2E Demo: HTTP/REST Transport (Runner API)
 *
 * Full Aggregate Beacon protocol running over real HTTP on localhost.
 * A Node.js HTTP server hosts the aggregation service; two participants
 * (Alice and Bob) connect as clients via HttpClientTransport and real fetch.
 * No mocks beyond a throwaway P2TR transaction for signing (same as the
 * Nostr E2E demos).
 *
 * This demonstrates the "framework-agnostic server" pattern from ADR-005:
 * the transport exposes handleRequest / handleSse as pure primitives, and
 * a ~30-line node:http adapter mounts them. Swap Hono / Fastify / Workers
 * in without touching the transport.
 *
 * Usage:
 *   PORT=8080 npx tsx lib/operations/aggregation/e2e-http-transport.ts
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';

import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils';
import { p2tr, Transaction } from '@scure/btc-signer';
import * as musig2 from '@scure/btc-signer/musig2';

import type { HttpRequestLike, SseStream, Transport } from '../../../src/index.js';
import {
  AggregationParticipantRunner,
  AggregationServiceRunner,
  DidBtcr2,
  HttpClientTransport,
  HttpServerTransport,
  Resolver,
  Updater,
  formatSseComment,
  formatSseEvent,
} from '../../../src/index.js';

const PORT    = Number(process.env.PORT ?? 8080);
const BASE_URL = `http://localhost:${PORT}/`;

// ────────────────────────────────────────────────
// Keys + DIDs (all KEY DIDs; pubkeys derive from the DID string so no
// pre-registerPeer dance is needed — see ADR-002)
// ────────────────────────────────────────────────

const serviceKeys = SchnorrKeyPair.generate();
const serviceDid  = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

const aliceKeys   = SchnorrKeyPair.generate();
const aliceDid    = DidBtcr2.create(aliceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

const bobKeys     = SchnorrKeyPair.generate();
const bobDid      = DidBtcr2.create(bobKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

// ────────────────────────────────────────────────
// Service-side HTTP server (node:http adapter + HttpServerTransport)
// ────────────────────────────────────────────────

const serviceTransport = new HttpServerTransport({ heartbeatIntervalMs: 15_000 });
serviceTransport.registerActor(serviceDid, serviceKeys);

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function toReq(req: IncomingMessage, body: string): HttpRequestLike {
  const headers: Record<string, string> = {};
  for(const [k, v] of Object.entries(req.headers)) {
    if(Array.isArray(v)) headers[k.toLowerCase()] = v.join(',');
    else if(typeof v === 'string') headers[k.toLowerCase()] = v;
  }
  return {
    method     : req.method ?? 'GET',
    url        : req.url ?? '/',
    headers,
    body       : body.length > 0 ? body : undefined,
    remoteAddr : req.socket.remoteAddress ?? undefined,
  };
}

function sseAdapter(res: ServerResponse): SseStream {
  res.writeHead(200, {
    'content-type'  : 'text/event-stream',
    'cache-control' : 'no-cache',
    'connection'    : 'keep-alive',
  });
  res.flushHeaders();

  const closeHandlers: Array<() => void> = [];
  let   closed = false;
  const fireClose = (): void => {
    if(closed) return;
    closed = true;
    for(const cb of closeHandlers) cb();
  };
  res.on('close', fireClose);

  return {
    writeEvent(event, data, id) {
      if(closed) return;
      try { res.write(formatSseEvent(event, data, id)); } catch { fireClose(); }
    },
    writeComment(comment) {
      if(closed) return;
      try { res.write(formatSseComment(comment)); } catch { fireClose(); }
    },
    close() {
      if(closed) return;
      try { res.end(); } catch { /* already closed */ }
      fireClose();
    },
    onClose(cb) { if(closed) cb(); else closeHandlers.push(cb); },
  };
}

const httpServer = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const isInbox = path.startsWith('/v1/actors/') && path.endsWith('/inbox');
  const isAdvertsSse = req.method === 'GET' && path === '/v1/adverts';

  if(req.method === 'GET' && (isInbox || isAdvertsSse)) {
    serviceTransport.handleSse(toReq(req, ''), sseAdapter(res));
    return;
  }

  const body = await readBody(req);
  const response = await serviceTransport.handleRequest(toReq(req, body));
  res.writeHead(response.status, response.headers);
  res.end(response.body);
});

// ────────────────────────────────────────────────
// Participant transports — real fetch against the real server
// ────────────────────────────────────────────────

const aliceTransport = new HttpClientTransport({ baseUrl: BASE_URL });
aliceTransport.registerActor(aliceDid, aliceKeys);

const bobTransport = new HttpClientTransport({ baseUrl: BASE_URL });
bobTransport.registerActor(bobDid, bobKeys);

// ────────────────────────────────────────────────
// Signed update helper (same as Nostr E2E demos)
// ────────────────────────────────────────────────

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
    op    : 'add',
    path  : '/service/-',
    value : {
      id              : `${did}#beacon-cas`,
      type            : 'CASBeacon',
      serviceEndpoint : `bitcoin:${beaconAddress}`,
    },
  }], 1);
  return Updater.sign(did, unsigned, vm, kp.raw.secret!);
}

// ────────────────────────────────────────────────
// Service + participant runners (identical to the Nostr demos —
// the transport swap is the ONLY difference)
// ────────────────────────────────────────────────

const service = new AggregationServiceRunner({
  transport : serviceTransport,
  did       : serviceDid,
  keys      : serviceKeys,
  config    : { minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' },

  onProvideTxData : async () => {
    const cohort = service.session.getCohort(service.session.cohorts[0].id)!;
    const aggPk = musig2.keyAggExport(musig2.keyAggregate(cohort.cohortKeys));
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
const bob   = makeParticipantRunner('bob',   bobDid,   bobKeys,   bobTransport);

// ────────────────────────────────────────────────
// Wire everything up and run
// ────────────────────────────────────────────────

await new Promise<void>((resolve) => httpServer.listen(PORT, resolve));
console.log(`\n══ HTTP server listening at ${BASE_URL} ══\n`);

aliceTransport.start();
bobTransport.start();

await alice.start();
await bob.start();

const result = await service.run();

console.log('\n══ Result ══');
console.log('Beacon address (add to DID document as CASBeacon serviceEndpoint):');
console.log(`  bitcoin:${service.session.getCohort(result.cohortId)!.beaconAddress}`);
console.log(`Signature length: ${result.signature.length} bytes`);

// Graceful teardown
aliceTransport.stop();
bobTransport.stop();
serviceTransport.stop();
httpServer.close(() => process.exit(0));
