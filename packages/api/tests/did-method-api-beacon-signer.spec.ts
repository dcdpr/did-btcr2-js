import { BeaconError } from '@did-btcr2/method';
import { expect } from 'chai';
import { DidMethodApi } from '../src/index.js';
import { recorders, TXID, updateArgs, updateFixture } from './support/update-fixtures.js';

describe('DidMethodApi update() announce.signer (ADR 119)', () => {
  it('signs the beacon input with announce.signer when the beacon key differs from the DID key', async () => {
    const fixture = updateFixture('SingletonBeacon', { separateBeaconKey: true });
    const { order, counters } = recorders();
    const result = await new DidMethodApi().update(
      ...updateArgs(fixture, order, counters, { announce: { signer: fixture.beaconSigner } })
    );
    expect(result.txid).to.equal(TXID);
    expect(counters.sent).to.have.length(1);
    expect(result.signedUpdate.proof.verificationMethod).to.equal(fixture.verificationMethodId);
  });

  it('refuses the beacon input with the DID key when no announce.signer is set', async () => {
    const fixture = updateFixture('SingletonBeacon', { separateBeaconKey: true });
    const { order, counters } = recorders();
    let thrown: unknown;
    try {
      await new DidMethodApi().update(...updateArgs(fixture, order, counters));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).to.be.instanceOf(BeaconError);
    expect((thrown as BeaconError).type).to.equal('SIGNER_KEY_MISMATCH');
    expect(counters.sent).to.have.length(0);
  });

  it('deactivate passes announce.signer through', async () => {
    const fixture = updateFixture('SingletonBeacon', { separateBeaconKey: true });
    const { order, counters } = recorders();
    const [source, _patch, signer, options] = updateArgs(
      fixture, order, counters, { announce: { signer: fixture.beaconSigner } }
    );
    const result = await new DidMethodApi().deactivate(source, signer, options);
    expect(result.txid).to.equal(TXID);
    expect(result.signedUpdate.patch).to.deep.equal([DidMethodApi.DEACTIVATION_PATCH]);
  });
});
