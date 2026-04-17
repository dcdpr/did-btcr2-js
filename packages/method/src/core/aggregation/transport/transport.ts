import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { BaseMessage } from '../messages/base.js';

export type SyncMessageHandler = (msg: any) => void;
export type AsyncMessageHandler = (msg: any) => Promise<void>;
export type MessageHandler = SyncMessageHandler | AsyncMessageHandler;

export type TransportType = 'nostr' | 'didcomm';

/**
 * Multi-actor message transport.
 *
 * A single transport instance manages one connection (relay pool, channel, etc.)
 * shared by all registered actors. Each actor registers its own DID and keys;
 * the transport resolves the correct identity when sending or receiving messages.
 *
 * The transport is a pure passthrough — it knows nothing about the aggregation
 * protocol. It only signs/encrypts outgoing messages with the sender's keys and
 * dispatches incoming messages to the correct actor's registered handler.
 *
 * @interface Transport
 */
export interface Transport {
  name: string;

  /** Start the underlying transport (idempotent — only starts once). */
  start(): void;

  /** Register an actor (service or participant) with this transport. */
  registerActor(did: string, keys: SchnorrKeyPair): void;

  /** Return a registered actor's compressed communication public key. */
  getActorPk(did: string): Uint8Array | undefined;

  /** Store a remote peer's communication public key for encrypted routing. */
  registerPeer(did: string, communicationPk: Uint8Array): void;

  /** Retrieve a remote peer's communication public key. */
  getPeerPk(did: string): Uint8Array | undefined;

  /** Register a message handler scoped to a specific actor. */
  registerMessageHandler(actorDid: string, messageType: string, handler: MessageHandler): void;

  /** Remove a previously-registered handler. No-op if not registered. */
  unregisterMessageHandler(actorDid: string, messageType: string): void;

  /**
   * Detach an actor: unregister all its handlers, drop its keys, and close any
   * transport-level subscriptions created for it. No-op if the actor is not
   * registered.
   */
  unregisterActor(did: string): void;

  /** Send a message. The transport looks up sender to resolve signing keys. */
  sendMessage(message: BaseMessage, sender: string, recipient?: string): Promise<void>;
}
