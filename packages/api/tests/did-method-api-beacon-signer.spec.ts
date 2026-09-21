import { BeaconError } from '@did-btcr2/method';
import { expect } from 'chai';
import { DidMethodApi } from '../src/index.js';
import { mockBitcoin, recorders, TXID, updateArgs, updateFixture } from './support/update-fixtures.js';

describe('DidMethodApi update() beaconSigner (ADR 119)', () => {
  it('signs the beacon input with beaconSigner when the beacon key differs from the DID key', async () => {
    const fixture = updateFixture('SingletonBeacon', { separateBeaconKey: true });
    const { order, counters } = recorders();
    const result = await new DidMethodApi().update({
      ...updateArgs(fixture, order, counters),
      beaconSigner : fixture.beaconSigner,
    });
    expect(result.txid).to.equal(TXID);
    expect(counters.sent).to.have.length(1);
    expect(result.signedUpdate.proof.verificationMethod).to.equal(fixture.verificationMethodId);
  });

  it('refuses the beacon input with the DID key when no beaconSigner is set', async () => {
    const fixture = updateFixture('SingletonBeacon', { separateBeaconKey: true });
    const { order, counters } = recorders();
    let thrown: unknown;
    try {
      await new DidMethodApi().update(updateArgs(fixture, order, counters));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).to.be.instanceOf(BeaconError);
    expect((thrown as BeaconError).type).to.equal('SIGNER_KEY_MISMATCH');
    expect(counters.sent).to.have.length(0);
  });

  it('the builder passes beaconSigner through', async () => {
    const fixture = updateFixture('SingletonBeacon', { separateBeaconKey: true });
    const { order, counters } = recorders();
    const result = await new DidMethodApi().buildUpdate(fixture.sourceDocument)
      .version(1)
      .verificationMethodId(fixture.verificationMethodId)
      .beacon(fixture.beaconId)
      .signer(fixture.signer)
      .beaconSigner(fixture.beaconSigner)
      .bitcoin(mockBitcoin(fixture.beaconAddress, order, counters))
      .execute();
    expect(result.txid).to.equal(TXID);
    expect(counters.sent).to.have.length(1);
  });

  it('deactivate passes beaconSigner through', async () => {
    const fixture = updateFixture('SingletonBeacon', { separateBeaconKey: true });
    const { order, counters } = recorders();
    const { patches: _patches, ...args } = updateArgs(fixture, order, counters);
    const result = await new DidMethodApi().deactivate({ ...args, beaconSigner: fixture.beaconSigner });
    expect(result.txid).to.equal(TXID);
    expect(result.signedUpdate.patch).to.deep.equal([DidMethodApi.DEACTIVATION_PATCH]);
  });
});
