export interface CommunicationService {
  name: string;
  start(): Promise<void>;
  registerMessageHandler(messageType: string, handler: (msg: any) => Promise<void>): void;
  sendMessage(message: object, recipient: string, sender: string): Promise<void>;
  generateIdentity(): string;
}