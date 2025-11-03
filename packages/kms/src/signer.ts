import type { KeyHandle } from './types.js';
import type { AvailableNetworks } from '@did-btcr2/bitcoin';
import type { KeyBytes, SignatureBytes, Bytes } from '@did-btcr2/common';

export class Signer {
  public network: keyof AvailableNetworks;
  private handle: KeyHandle;

  constructor(params: { handle: KeyHandle; network: keyof AvailableNetworks }) {
    this.handle = params.handle;
    this.network = params.network;
  }

  get publicKey(): KeyBytes {
    return this.handle.getPublic() as unknown as KeyBytes;
  }

  public sign(hash: Bytes): SignatureBytes {
    return this.signSchnorr(hash);
  }

  public signSchnorr(hash: Bytes): SignatureBytes {
    const p = this.handle.sign!(hash) as unknown as SignatureBytes;
    return p;
  }
}
