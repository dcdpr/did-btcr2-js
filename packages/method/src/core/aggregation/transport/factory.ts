import { NotImplementedError } from '@did-btcr2/common';
import { NostrTransport } from './nostr.js';
import { TransportError } from './error.js';
import type { Transport, TransportType } from './transport.js';

export interface TransportConfig {
  type: TransportType;
  relays?: string[];
}

/**
 * Factory for creating Transport instances.
 * @class TransportFactory
 */
export class TransportFactory {
  static establish(config: TransportConfig): Transport {
    switch (config.type) {
      case 'nostr':
        return new NostrTransport({ relays: config.relays });
      case 'didcomm':
        throw new NotImplementedError('DIDComm transport not implemented yet.');
      default:
        throw new TransportError(
          `Invalid transport type: ${config.type}`,
          'INVALID_TRANSPORT_TYPE', { config }
        );
    }
  }
}
