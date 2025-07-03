import { NotImplementedError } from '@did-btc1/common';
import { CommunicationServiceError } from './error.js';
import { NostrAdapter } from './nostr.js';
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
        throw new NotImplementedError(
          'DIDComm communication service is not implemented yet.',
          'DIDCOMM_ADAPTER_NOT_IMPLEMENTED', service
        );
      default:
        throw new CommunicationServiceError(
          `Invalid service type ${service.type}`,
          'INVALID_BEACON_ERROR', { service }
        );
    }
  }
}
