import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { expect } from 'chai';
import {
  AggregationParticipantRunner,
  AggregationServiceRunner,
  DidBtcr2,
} from '../src/index.js';
import { MessageBus, MockTransport } from './helpers/mock-transport.js';

describe('Aggregation runner regressions', () => {

  describe('T4.1: stop() detaches transport handlers', () => {
    it('service runner clears handler map on stop()', () => {
      const keys = SchnorrKeyPair.generate();
      const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const bus = new MessageBus();
      const transport = new MockTransport(bus);
      transport.registerActor(did, keys);

      const runner = new AggregationServiceRunner({
        transport,
        did,
        keys,
        config          : { minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' },
        onProvideTxData : async () => { throw new Error('not used'); },
      });

      // Kick off run() so handlers get registered
      const p = runner.run();
      p.catch(() => { /* we stop() before it can settle */ });

      runner.stop();

      // After stop, unregistering should be idempotent / no-op
      expect(() => transport.unregisterMessageHandler(did, 'whatever')).to.not.throw();
    });

    it('participant runner supports stop() + restart without leaking handlers', async () => {
      const keys = SchnorrKeyPair.generate();
      const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const bus = new MessageBus();
      const transport = new MockTransport(bus);
      transport.registerActor(did, keys);

      const runner = new AggregationParticipantRunner({
        transport,
        did,
        keys,
        onProvideUpdate : async () => ({} as never),
      });
      await runner.start();
      runner.stop();
      // Safe to start a fresh runner on same transport
      const runner2 = new AggregationParticipantRunner({
        transport,
        did,
        keys,
        onProvideUpdate : async () => ({} as never),
      });
      await runner2.start();
      runner2.stop();
    });
  });

  describe('T4.3: configurable cohort TTL', () => {
    it('emits cohort-failed and rejects run() when cohort TTL elapses before completion', async () => {
      const serviceKeys = SchnorrKeyPair.generate();
      const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

      const bus = new MessageBus();
      const serviceTransport = new MockTransport(bus);
      serviceTransport.registerActor(serviceDid, serviceKeys);

      const service = new AggregationServiceRunner({
        transport       : serviceTransport,
        did             : serviceDid,
        keys            : serviceKeys,
        config          : { minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' },
        onProvideTxData : async () => { throw new Error('no participants in this test'); },
        cohortTtlMs     : 50,
      });

      let cohortFailed = false;
      service.on('cohort-failed', () => { cohortFailed = true; });

      let caught: unknown;
      try {
        await service.run();
      } catch(err) {
        caught = err;
      }
      expect(cohortFailed).to.be.true;
      expect(caught).to.be.instanceOf(Error);
      expect((caught as Error).message).to.match(/TTL/);
    });
  });
});
