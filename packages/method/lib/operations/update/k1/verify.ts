import input from '../../../data/regtest/k1/qgpzvae5/update/input.json' with { type: 'json' };
import { DidBtcr2 } from '../../../../src/did-btcr2.js';

const sourceDocument = input.sourceDocument;

const patches = input.patches;

const verificationMethodId = input.verificationMethodId;

const beaconId = input.beaconId;

const sourceVersionId = input.sourceVersionId;

const signingMaterial = input.signingMaterial;

const signedUpdate = await DidBtcr2.update(
  {
    sourceDocument,
    patches,
    sourceVersionId,
    verificationMethodId,
    beaconId,
    signingMaterial
  }
);

console.log('Signed Update:', JSON.stringify(signedUpdate, null, 2));