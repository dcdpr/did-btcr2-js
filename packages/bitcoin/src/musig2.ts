import { Hex } from '@did-btc1/common';
import { SecretKey } from '@did-btc1/keypair';
import { ProjPointType } from '@noble/curves/abstract/weierstrass';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { CURVE, ProjectivePoint } from '@noble/secp256k1';
import { payments, Psbt } from 'bitcoinjs-lib';
import { taggedHash } from 'bitcoinjs-lib/src/crypto';

interface MuSig2Session {
  sessionId: string;
  beaconAddress: string;
  participants: Hex[];
  publicNonces: Map<Hex, Hex>; // pubkey => nonce
  aggregatedNonce?: Hex;
  messageToSign?: Uint8Array;
  partialSigs: Map<Hex, Hex>; // pubkey => sig
}

interface MuSig2NonceContribution {
  sessionId: string;
  beaconAddress: string;
  noncePoints: Hex;
}

interface AggregatedMuSig2Nonce {
  sessionId: string;
  beaconAddress: string;
  aggregatedNoncePoints: Hex;
}

interface BeaconSignalAuthorization {
  sessionId: string;
  beaconAddress: string;
  txSig: Hex;
}

export class MuSig2Participant {
  public secretKey: Uint8Array;
  public publicKey: Uint8Array;
  public nonce?: Uint8Array;
  public noncePub?: ProjPointType<bigint>;

  constructor(secretKey?: Uint8Array) {
    this.secretKey = secretKey ?? SecretKey.random();
    this.publicKey = schnorr.getPublicKey(this.secretKey);
  }

  public generateNonce(): MuSig2NonceContribution {
    this.nonce = SecretKey.random();
    this.noncePub = secp256k1.ProjectivePoint.fromPrivateKey(this.nonce);

    return {
      sessionId     : 'SESSION_ID',
      beaconAddress : 'BEACON_ADDRESS',
      noncePoints   : this.noncePub.toHex(true), // compressed
    };
  }

  public sign(message: Uint8Array, aggregatedNonceHex: string): BeaconSignalAuthorization {
    const R = ProjectivePoint.fromHex(aggregatedNonceHex);
    const L = ProjectivePoint.fromHex(this.publicKey);

    const e = taggedHash('BIP0340/challenge', new Uint8Array([
      ...R.toRawBytes(true),
      ...L.toRawBytes(true),
      ...message,
    ]));

    const eNum = BigInt('0x' + bytesToHex(e));
    const rNum = BigInt('0x' + bytesToHex(this.nonce!));
    const xNum = BigInt('0x' + bytesToHex(this.secretKey));

    const s = (rNum + eNum * xNum) % CURVE.n;

    return {
      sessionId     : crypto.randomUUID(),
      beaconAddress : payments.p2tr({ internalPubkey: this.publicKey }).address || '',
      txSig         : s.toString(16).padStart(64, '0'),
    };
  }
}

export class MuSig2Coordinator {
  public sessions: Map<string, MuSig2Session> = new Map();

  public receiveNonce(contrib: MuSig2NonceContribution) {
    const session = this.sessions.get(contrib.sessionId);
    session?.publicNonces.set(contrib.beaconAddress, contrib.noncePoints);
  }

  public aggregateNonces(sessionId: string): AggregatedMuSig2Nonce {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const points = Array.from(session.publicNonces.values()).map(nonceHex => ProjectivePoint.fromHex(nonceHex));
    const aggregated = points.reduce((acc, pt) => acc.add(pt), ProjectivePoint.ZERO);
    session.aggregatedNonce = aggregated.toHex();

    return {
      sessionId,
      beaconAddress         : session.beaconAddress,
      aggregatedNoncePoints : session.aggregatedNonce,
    };
  }

  public collectSignature(auth: BeaconSignalAuthorization) {
    const session = this.sessions.get(auth.sessionId);
    if (session) {
      session.partialSigs.set(auth.beaconAddress, auth.txSig);
    }
  }

  public finalizeTransaction(psbt: Psbt): string {
    // Combine partial signatures (assuming MuSig2 multi-party logic handled externally)
    return psbt.toHex(); // simplified placeholder
  }
}
