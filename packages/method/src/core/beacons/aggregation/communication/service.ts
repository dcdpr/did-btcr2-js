import { Maybe } from '@did-btcr2/common';
import { AggregateBeaconMessageType } from '../cohort/messages/index.js';
import { NostrKeys } from './adapter/nostr.js';

/**
 * ServiceAdapterConfig defines the configuration structure for the Nostr communication service.
 * It includes relay URLs, key pairs, and components for identity generation.
 * @interface ServiceAdapterConfig
 * @extends {Record<string, any>}
 * @type {ServiceAdapterConfig}
 */
export interface ServiceAdapterConfig extends Record<string, any> {
  keys: ServiceAdapterIdentity<any>;
  did: string;
}

export type SyncMessageHandler = (msg: any) => void;
export type AsyncMessageHandler = (msg: any) => Promise<void>;
export type MessageHandler = SyncMessageHandler | AsyncMessageHandler;

export type CommunicationServiceType = 'nostr' | 'didcomm';
export type ServiceAdapterConfigType<T extends ServiceAdapterConfig> = T;
export interface Service {
  type: CommunicationServiceType;
  keys: ServiceAdapterIdentity<NostrKeys>;
  did: string;
  name?: string;
}
export type ServiceAdapter<T extends CommunicationService> = T;
export type ServiceAdapterIdentity<T extends NostrKeys> = T;
export interface CommunicationService {
  name: string;
  start(): void;
  setKeys(keys: ServiceAdapterIdentity<NostrKeys>): void;
  registerMessageHandler(messageType: string, handler: MessageHandler): void;
  sendMessage(message: Maybe<AggregateBeaconMessageType>, sender: string, recipient?: string): Promise<void | Promise<string>[]>;
  generateIdentity?(keys?: ServiceAdapterIdentity<NostrKeys>): ServiceAdapterConfigType<ServiceAdapterConfig>
}