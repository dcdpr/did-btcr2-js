import { NotImplementedError } from '@did-btcr2/common';
import { NostrAdapter } from './adapter/nostr.js';
import { CommunicationServiceError } from './error.js';
import { CommunicationService, Service } from './service.js';

/**
 * Communication Factory pattern to create Communication Service instances.
 * @class CommunicationFactory
 * @type {CommunicationFactory}
 */
export class CommunicationFactory {
  static establish(service: Service): CommunicationService {
    switch (service.type) {
      case 'nostr':
        return new NostrAdapter();
      case 'didcomm':
        throw new NotImplementedError('DID Comm service not implemented yet.');
      default:
        throw new CommunicationServiceError(
          `Invalid service type ${service.type}`,
          'INVALID_BEACON_ERROR', { service }
        );
    }
  }
}