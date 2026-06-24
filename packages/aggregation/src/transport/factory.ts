import { NotImplementedError } from '@did-btcr2/common';
import type { Logger } from '../logger.js';
import { TransportError } from './error.js';
import type { HttpClientTransportConfig } from './http/client.js';
import { HttpClientTransport } from './http/client.js';
import type { HttpServerTransportConfig } from './http/server.js';
import { HttpServerTransport } from './http/server.js';
import { NostrTransport } from './nostr.js';
import type { Transport } from './transport.js';

/** Discriminated-union config for {@link TransportFactory.establish}. */
export type TransportConfig =
  | NostrTransportConfigOption
  | DidCommTransportConfigOption
  | HttpClientTransportConfigOption
  | HttpServerTransportConfigOption;

export interface NostrTransportConfigOption {
  type: 'nostr';
  relays?: string[];
  logger?: Logger;
  broadcastLookbackMs?: number;
}

export interface DidCommTransportConfigOption {
  type: 'didcomm';
}

export interface HttpClientTransportConfigOption extends HttpClientTransportConfig {
  type: 'http';
  role: 'client';
}

export interface HttpServerTransportConfigOption extends HttpServerTransportConfig {
  type: 'http';
  role: 'server';
}

/** Factory for creating Transport instances. */
export class TransportFactory {
  static establish(config: TransportConfig): Transport {
    switch(config.type) {
      case 'nostr':
        return new NostrTransport({
          relays              : config.relays,
          logger              : config.logger,
          broadcastLookbackMs : config.broadcastLookbackMs,
        });
      case 'didcomm':
        throw new NotImplementedError('DIDComm transport not implemented yet.');
      case 'http':
        if(config.role === 'client') return new HttpClientTransport(config);
        if(config.role === 'server') return new HttpServerTransport(config);
        throw new NotImplementedError(
          `HTTP transport role not implemented: ${(config as { role: string }).role}`,
        );
      default:
        throw new TransportError(
          `Invalid transport type: ${(config as { type: string }).type}`,
          'INVALID_TRANSPORT_TYPE',
          { config },
        );
    }
  }
}
