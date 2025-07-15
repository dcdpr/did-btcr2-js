import { Maybe } from '@did-btc1/common';
import { AggregateBeaconMessageType } from '../messages/index.js';
import { NostrAdapterConfig } from './nostr.js';

export type SyncMessageHandler = (msg: any) => void;
export type AsyncMessageHandler = (msg: any) => Promise<void>;
export type MessageHandler = SyncMessageHandler | AsyncMessageHandler;

export type CommunicationServiceType = 'nostr' | 'didcomm';
export interface Service {
  type: CommunicationServiceType;
  config: NostrAdapterConfig | any;
}

export type ServiceAdapter<T extends CommunicationService> = T;
export type ServiceAdapterConfig<T extends any> = T;
export interface CommunicationService {
  name: string;
  start(): ServiceAdapter<CommunicationService>;
  registerMessageHandler(messageType: string, handler: MessageHandler): void;
  sendMessage(message: Maybe<AggregateBeaconMessageType>, recipient: string, sender: string): Promise<void | Promise<string>[]>;
  generateIdentity(): ServiceAdapterConfig<any>
}