import { NotImplementedError } from '@did-btcr2/common';
import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { BaseMessage } from '../messages/base.js';
import type { MessageHandler, Transport } from './transport.js';

/**
 * DIDComm Transport (stub).
 *
 * @class DidCommTransport
 * @implements {Transport}
 */
export class DidCommTransport implements Transport {
  public name: string = 'didcomm';

  public start(): void {
    throw new NotImplementedError('DidCommTransport not implemented. Use NostrTransport instead.');
  }

  public registerActor(_did: string, _keys: SchnorrKeyPair): void {
    throw new NotImplementedError('DidCommTransport not implemented.');
  }

  public getActorPk(_did: string): Uint8Array | undefined {
    throw new NotImplementedError('DidCommTransport not implemented.');
  }

  public registerPeer(_did: string, _communicationPk: Uint8Array): void {
    throw new NotImplementedError('DidCommTransport not implemented.');
  }

  public getPeerPk(_did: string): Uint8Array | undefined {
    throw new NotImplementedError('DidCommTransport not implemented.');
  }

  public registerMessageHandler(_actorDid: string, _messageType: string, _handler: MessageHandler): void {
    throw new NotImplementedError('DidCommTransport not implemented.');
  }

  public unregisterMessageHandler(_actorDid: string, _messageType: string): void {
    throw new NotImplementedError('DidCommTransport not implemented.');
  }

  public unregisterActor(_did: string): void {
    throw new NotImplementedError('DidCommTransport not implemented.');
  }

  public async sendMessage(_message: BaseMessage, _sender: string, _recipient?: string): Promise<void> {
    throw new NotImplementedError('DidCommTransport not implemented.');
  }

  public publishRepeating(
    _message: BaseMessage,
    _sender: string,
    _intervalMs: number,
    _recipient?: string,
  ): () => void {
    throw new NotImplementedError('DidCommTransport not implemented.');
  }
}
