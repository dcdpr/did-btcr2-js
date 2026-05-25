/**
 * Keypair generation + per-network address derivation.
 *
 * Derives the three address types used by did:btcr2 beacons (P2PKH, P2WPKH,
 * P2TR) on each supported test network. Same secret, four sets of addresses.
 */
import { getNetwork } from '@did-btcr2/bitcoin';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { hex } from '@scure/base';
import { p2pkh, p2tr, p2wpkh } from '@scure/btc-signer';

import type { AddressBundle, Key, Network } from './store.js';
import { NETWORKS } from './store.js';

export function deriveAddresses(publicKey: Uint8Array, network: Network): AddressBundle {
  const net = getNetwork(network);
  const xOnly = publicKey.slice(1);
  return {
    p2pkh  : p2pkh(publicKey, net).address!,
    p2wpkh : p2wpkh(publicKey, net).address!,
    p2tr   : p2tr(xOnly, undefined, net).address!,
  };
}

export function deriveAllNetworks(publicKey: Uint8Array): Record<Network, AddressBundle> {
  const result = {} as Record<Network, AddressBundle>;
  for (const net of NETWORKS) {
    result[net] = deriveAddresses(publicKey, net);
  }
  return result;
}

export function newKey(label: string, opts: {
  scenarioId?: string | null;
  notes?: string;
  secretHex?: string;
} = {}): Key {
  const kp = opts.secretHex
    ? SchnorrKeyPair.fromSecret(hex.decode(opts.secretHex))
    : SchnorrKeyPair.generate();

  const publicKey = kp.publicKey.compressed;
  return {
    label,
    secretHex  : hex.encode(kp.secretKey.bytes),
    pubkeyHex  : hex.encode(publicKey),
    addresses  : deriveAllNetworks(publicKey),
    scenarioId : opts.scenarioId ?? null,
    createdAt  : new Date().toISOString(),
    notes      : opts.notes,
  };
}

/** Recreate the keypair from a stored Key for signing. */
export function keypairFromKey(key: Key): SchnorrKeyPair {
  return SchnorrKeyPair.fromSecret(hex.decode(key.secretHex));
}
