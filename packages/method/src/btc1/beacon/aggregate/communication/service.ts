import { Maybe } from '@did-btc1/common';
import { AggregateBeaconMessageType } from '../cohort/messages/index.js';
import { RawKeyPair } from '@did-btc1/keypair';

/**
 * ServiceAdapterConfig defines the configuration structure for the Nostr communication service.
 * It includes relay URLs, key pairs, and components for identity generation.
 * @interface ServiceAdapterConfig
 * @extends {Record<string, any>}
 * @type {ServiceAdapterConfig}
 */
export interface ServiceAdapterConfig extends Record<string, any> {
  keys: RawKeyPair;
  did: string;
  components: {
    idType: string;
    version: number;
    network: string;
  };
}

export type SyncMessageHandler = (msg: any) => void;
export type AsyncMessageHandler = (msg: any) => Promise<void>;
export type MessageHandler = SyncMessageHandler | AsyncMessageHandler;

export type CommunicationServiceType = 'nostr' | 'didcomm';
export type ServiceAdapterConfigType<T extends ServiceAdapterConfig> = T;
export interface Service {
  type: CommunicationServiceType;
  config: ServiceAdapterConfigType<ServiceAdapterConfig>;
}
export type ServiceAdapter<T extends CommunicationService> = T;
export type ServiceAdapterIdentity<T extends RawKeyPair> = T;
export interface CommunicationService {
  name: string;
  start(): ServiceAdapter<CommunicationService>;
  registerMessageHandler(messageType: string, handler: MessageHandler): void;
  sendMessage(message: Maybe<AggregateBeaconMessageType>, recipient: string, sender: string): Promise<void | Promise<string>[]>;
  generateIdentity(keys?: ServiceAdapterIdentity<RawKeyPair>): ServiceAdapterConfigType<ServiceAdapterConfig>
}