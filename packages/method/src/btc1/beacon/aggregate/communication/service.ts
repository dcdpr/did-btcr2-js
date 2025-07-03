import { NostrAdapterConfig } from './nostr.js';

export type MessageHandler = (msg: any) => Promise<void>;

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
  sendMessage(message: object, recipient: string, sender: string): Promise<void>;
  generateIdentity(): ServiceAdapterConfig<any>
}