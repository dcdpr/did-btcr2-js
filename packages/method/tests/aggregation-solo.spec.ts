import { getNetwork } from '@did-btcr2/bitcoin';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import { schnorr } from '@noble/curves/secp256k1.js';
import { Address, OutScript, SigHash, Transaction } from '@scure/btc-signer';
import { expect } from 'chai';
import { AggregationRunner, DidBtcr2, Resolver, Updater } from '../src/index.js';

describe('AggregationRunner.solo (cohort of one)', () => {
  it('drives a single-participant SMT cohort to a verifiable MuSig2 signature', async function() {
    this.timeout(15_000);

    // Service (coordinator) + the lone participant (the cohort's only signer).
    const serviceKeys = SchnorrKeyPair.generate();
    const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
    const participantKeys = SchnorrKeyPair.generate();
    const participantDid = DidBtcr2.create(participantKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

    // The participant's signed update adds an SMT beacon service.
    const buildSignedUpdate = (beaconAddress: string) => {
      const doc = Resolver.deterministic({
        genesisBytes : participantKeys.publicKey.compressed,
        hrp          : 'k',
        idType       : 'KEY',
        version      : 1,
        network      : 'mutinynet',
      });
      const vm = doc.verificationMethod![0]!;
      const unsigned = Updater.construct(doc, [{
        op    : 'add',
        path  : '/service/-',
        value : {
          id              : `${participantDid}#beacon-smt`,
          type            : 'SMTBeacon',
          serviceEndpoint : `bitcoin:${beaconAddress}`,
        },
      }], 1);
      return Updater.sign(participantDid, unsigned, vm, new LocalSigner(participantKeys.raw.secret!));
    };

    // Capture signing artefacts for cryptographic verification after the run.
    let capturedSighash: Uint8Array | undefined;
    let capturedTweakedPk: Uint8Array | undefined;
    let capturedBeaconAddress: string | undefined;

    const result = await AggregationRunner.solo({
      service        : { did: serviceDid, keys: serviceKeys },
      participant    : { did: participantDid, keys: participantKeys },
      config         : { network: 'mutinynet', beaconType: 'SMTBeacon' },
      phaseTimeoutMs : 10_000,

      onProvideUpdate : async ({ beaconAddress }) => buildSignedUpdate(beaconAddress),

      onProvideTxData : async ({ beaconAddress }) => {
        // The cohort beacon address is a P2TR key-path output of the aggregated
        // cohort key. AggregationCohort.computeBeaconAddress() derives it for the
        // cohort's network (here mutinynet → tb1p), so decode it with the same
        // network. From the scriptPubKey we get the tweaked output key to verify.
        const script = OutScript.encode(Address(getNetwork('mutinynet')).decode(beaconAddress));
        const tweakedPk = script.slice(2); // P2TR: OP_1 (0x51) OP_PUSHBYTES_32 (0x20) <32-byte x-only key>
        const prevOutValue = 100_000n;

        const tx = new Transaction({ version: 2 });
        tx.addInput({
          txid        : '00'.repeat(32),
          index       : 0,
          witnessUtxo : { amount: prevOutValue, script },
        });
        tx.addOutputAddress(beaconAddress, prevOutValue - 500n, getNetwork('mutinynet'));

        capturedSighash = tx.preimageWitnessV1(0, [script], SigHash.DEFAULT, [prevOutValue]);
        capturedTweakedPk = tweakedPk;
        capturedBeaconAddress = beaconAddress;

        return { tx, prevOutScripts: [script], prevOutValues: [prevOutValue] };
      },
    });

    expect(result.cohortId, 'cohortId').to.be.a('string').and.not.empty;
    expect(result.signature, 'signature is bytes').to.be.instanceOf(Uint8Array);
    expect(result.signature.length, 'signature is 64 bytes').to.equal(64);
    expect(result.signedTx, 'signedTx present').to.exist;

    expect(capturedSighash, 'onProvideTxData ran').to.not.be.undefined;
    expect(capturedTweakedPk, 'tweaked key captured').to.not.be.undefined;
    expect(capturedBeaconAddress, 'beacon address captured').to.be.a('string');

    // The aggregated MuSig2 signature must verify against the Taproot-tweaked
    // output key + BIP-341 sighash — the ground truth a broadcast relies on.
    const ok = schnorr.verify(result.signature, capturedSighash!, capturedTweakedPk!);
    expect(ok, 'aggregated MuSig2 signature verifies under the tweaked cohort key').to.equal(true);
  });
});
