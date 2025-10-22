import { DecentralizedIdentifier, Maybe } from '@did-btcr2/common';
import { CompressedSecp256k1PublicKey, RawSchnorrKeyPair, SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { nonceGen } from '@scure/btc-signer/musig2';
import { Event, EventTemplate, Filter, finalizeEvent, nip44 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { Identifier } from '../../../../../utils/identifier.js';
import {
  BEACON_COHORT_ADVERT,
  BEACON_COHORT_AGGREGATED_NONCE,
  BEACON_COHORT_AUTHORIZATION_REQUEST,
  BEACON_COHORT_NONCE_CONTRIBUTION,
  BEACON_COHORT_OPT_IN,
  BEACON_COHORT_OPT_IN_ACCEPT,
  BEACON_COHORT_READY,
  BEACON_COHORT_REQUEST_SIGNATURE,
  BEACON_COHORT_SIGNATURE_AUTHORIZATION
} from '../../cohort/messages/constants.js';
import { AggregateBeaconMessage, AggregateBeaconMessageType } from '../../cohort/messages/index.js';
import { CommunicationAdapterError } from '../error.js';
import { CommunicationService, MessageHandler, ServiceAdapter, ServiceAdapterConfig, ServiceAdapterIdentity } from '../service.js';

/**
 * DEFAULT_NOSTR_RELAYS provides a list of default Nostr relay URLs for communication.
 * These relays are used to connect to the Nostr network for sending and receiving messages.
 * @constant {Array<string>} DEFAULT_NOSTR_RELAYS
 */
export const DEFAULT_NOSTR_RELAYS = [
  'wss://relay.damus.io',
  // 'wss://nos.lol',
  // 'wss://relay.snort.social',
  // 'wss://nostr-pub.wellorder.net',
];

/**
 * NostrAdapterConfig defines the configuration structure for the Nostr communication adapter.
 * It includes relay URLs, key pairs, and components for identity generation.
 * @interface NostrAdapterConfig
 * @type {NostrAdapterConfig}
 */
export interface NostrAdapterConfig {
  keys: RawSchnorrKeyPair;
  did?: string;
  components: {
    idType?: string;
    version?: number;
    network?: string;
  };
  relays: string[];
  [key: string]: any;
}

export class NostrAdapter implements CommunicationService {
  /**
   * The name of the NostrAdapter service.
   * @type {string}
   */
  public name: string = 'nostr';

  /**
   * The configuration for the NostrAdapter.
   * @type {NostrAdapterConfig}
   */
  private config: NostrAdapterConfig;

  /**
   * A map of message handlers for different message types.
   * @type {Map<string, MessageHandler>}
   */
  private handlers: Map<string, MessageHandler> = new Map();

  /**
   * The SimplePool instance for managing Nostr subscriptions.
   * @type {SimplePool}
   */
  public pool?: SimplePool;

  /**
   * Constructs a new NostrAdapter instance with the given configuration.
   * @param {NostrAdapterConfig} config - The configuration for the NostrAdapter.
   * If no configuration is provided, a new key pair is generated and default relays are used.
   * @constructor
   */
  constructor(config: NostrAdapterConfig = { keys: {} as RawSchnorrKeyPair, components: {}, relays: DEFAULT_NOSTR_RELAYS }) {
    this.config = config;
    this.config.keys = this.config.keys || SchnorrKeyPair.generate().raw;
    this.config.did = config.did || Identifier.encode({
      idType       : config.components.idType || 'KEY',
      version      : config.components.version || 1,
      network      : config.components.network || 'signet',
      genesisBytes : this.config.keys.public!
    });
  }

  /**
   * Sets the keys for the NostrAdapter.
   * @param {ServiceAdapterIdentity<RawSchnorrKeyPair>} keys - The key pair to set.
   */
  public setKeys(keys: ServiceAdapterIdentity<RawSchnorrKeyPair>): void {
    this.config.keys = keys;
  }


  /**
   * Starts the Nostr communication service by subscribing to relays.
   * @returns {ServiceAdapter<NostrAdapter>} Returns the NostrAdapter instance for method chaining.
   */
  public start(): ServiceAdapter<NostrAdapter> {
    this.pool = new SimplePool();

    this.pool.subscribe(this.config.relays, { kinds: [1] } as Filter, {
      onclose : (reasons: string[]) => console.log('Subscription to kind 1 closed', reasons),
      onevent : this.onEvent.bind(this),
    });

    // this.pool.subscribe(this.config.relays, { kinds: [1059] } as Filter, {
    //   onclose : (reasons: string[]) => console.log('Subscription to kind 1059 closed for reasons:', reasons),
    //   onevent : this.onEvent.bind(this),
    //   oneose  : () => { Logger.info('EOSE kinds 1059'); }
    // });

    return this;
  }


  /**
   * Handles incoming Nostr events and dispatches them to the appropriate message handler.
   * @param {Event} event The Nostr event received from the relay.
   */
  private async onEvent(event: Event): Promise<void> {
    // Logger.debug('nostr.onEvent: event.tags', event.tags);
    // Dispatch the event to the registered handler
    const ptags = event.tags.filter(([name, _]) => name === 'p') ?? [];
    // Logger.debug('nostr.onEvent: event.tags.find => ptags', ptags);

    for(const [p, pk] of ptags ){
      if(pk === 'b71d3052dcdc8ba4564388948b655b58aaa7f37497ef1fc98829f9191adc8f85') {
        console.debug('nostr.onEvent: event.tags.find => p, pk', p, pk);
      }
    }
    // if(!type && !value) {
    //   // Logger.warn(`Event ${event.id} does not have a valid tag, skipping handler dispatch.`);
    //   return;
    // }
    // Logger.debug('nostr.onEvent: event.tags.find => type, value', type, value);

    // Logger.debug('nostr.onEvent: event', event);
    // Logger.debug('nostr.onEvent: event.tags', event.tags);

    // if(event.kind === 1 && !AggregateBeaconMessage.isKeyGenMessageValue(value)) {
    //   Logger.warn(`Event ${event.id} is not a key generation message type: ${value}, skipping handler dispatch.`);
    //   return;
    // }

    // if(event.kind === 1059 && !AggregateBeaconMessage.isSignMessageValue(value)) {
    //   Logger.warn(`Event ${event.id} has an invalid title tag: ${value}, skipping handler dispatch.`);
    //   return;
    // }

    // const handler = this.handlers.get(value);
    // if (!handler) {
    //   Logger.warn(`No handler found for message with tag value: ${value}`);
    //   return;
    // }

    // await handler(event);
  }

  /**
   * Registers a message handler for a specific message type.
   * @param {string} messageType The type of message to handle.
   * @param {MessageHandler} handler The handler function that processes the message.
   */
  public registerMessageHandler(messageType: string, handler: MessageHandler): void {
    this.handlers.set(messageType, handler);
  }


  /**
   * Sends a message to a recipient using the Nostr protocol.
   * This method is a placeholder and should be implemented with actual Nostr message sending logic.
   * @param {Maybe<AggregateBeaconMessageType>} message The message to send, typically containing the content and metadata.
   * @param {DecentralizedIdentifier} from The identifier of the sender.
   * @param {DecentralizedIdentifier} [to] The identifier of the recipient.
   * @returns {Promise<void>} A promise that resolves when the message is sent.
   */
  public async sendMessage(message: Maybe<AggregateBeaconMessageType>, from: DecentralizedIdentifier, to?: DecentralizedIdentifier): Promise<void | Promise<string>[]> {
    // Check if the sender and recipient DIDs are valid Btc1 identifiers
    if(
      [from, to]
        .filter(did => !!did)
        .every(did => !Identifier.isValid(did!))
    ) {
      console.error(`Invalid Btc1 identifiers: sender ${from}, recipient ${to}`);
      throw new CommunicationAdapterError(
        `Invalid identifiers: sender ${from}, recipient ${to}`,
        'SEND_MESSAGE_ERROR', { adapter: this.name }
      );
    }
    // Decode the sender and recipient DIDs to get their genesis bytes in hex
    const sender = new CompressedSecp256k1PublicKey(Identifier.decode(from).genesisBytes);
    console.info(`Sending message from ${sender}:`, message);

    // if(message.type === BEACON_COHORT_SUBSCRIBE_ACCEPT) {
    //   this.config.coordinatorDids.push(recipient);
    // }

    const tags = [['p', Buffer.from(sender.x).toString('hex')]];
    if(to) {
      const recipient = new CompressedSecp256k1PublicKey(Identifier.decode(to).genesisBytes);
      tags.push(['p', Buffer.from(recipient.x).toString('hex')]);
    }

    if(AggregateBeaconMessage.isKeyGenMessageValue(message.type)) {
      switch(message.type) {
        case BEACON_COHORT_ADVERT:
          console.info('Add tag', ['BEACON_COHORT_ADVERT', message.type]);
          break;
        case BEACON_COHORT_OPT_IN:
          console.info('Add tag', ['BEACON_COHORT_OPT_IN', message.type]);
          break;
        case BEACON_COHORT_OPT_IN_ACCEPT:
          console.info('Add tag', ['BEACON_COHORT_OPT_IN_ACCEPT', message.type]);
          break;
        case BEACON_COHORT_READY:
          console.info('Add tag', ['BEACON_COHORT_READY', message.type]);
          break;
      }
      const event = finalizeEvent({
        kind       : 1,
        created_at : Math.floor(Date.now() / 1000),
        tags,
        content    : JSON.stringify(message)
      } as EventTemplate, this.config.keys.secret!);
      console.info(`Sending message kind 1 event ...`, event);
      return this.pool?.publish(this.config.relays, event);
    }

    if(AggregateBeaconMessage.isSignMessageValue(message.type)) {
      switch(message.type) {
        case BEACON_COHORT_REQUEST_SIGNATURE:
          console.info('Add tag', ['BEACON_COHORT_REQUEST_SIGNATURE', message.type]);
          break;
        case BEACON_COHORT_AUTHORIZATION_REQUEST:
          console.info('Add tag', ['BEACON_COHORT_AUTHORIZATION_REQUEST', message.type]);
          break;
        case BEACON_COHORT_NONCE_CONTRIBUTION:
          console.info('Add tag', ['BEACON_COHORT_NONCE_CONTRIBUTION', message.type]);
          break;
        case BEACON_COHORT_AGGREGATED_NONCE:
          console.info('Add tag', ['BEACON_COHORT_AGGREGATED_NONCE', message.type]);
          break;
        case BEACON_COHORT_SIGNATURE_AUTHORIZATION:
          console.info('Add tag', ['BEACON_COHORT_SIGNATURE_AUTHORIZATION', message.type]);
          break;
      }
      const { publicKey, secretKey } = SchnorrKeyPair.generate();
      const content = nip44.encrypt(JSON.stringify(message), secretKey.bytes, nonceGen(publicKey.x).public);
      console.debug('NostrAdapter content:', content);

      const event = finalizeEvent({ content, tags, kind: 1059 } as EventTemplate, this.config.keys.secret!);
      console.debug('NostrAdapter event:', event);

      return this.pool?.publish(this.config.relays, event);
    }

    console.error(`Unsupported message type: ${message.type}`);
  }

  /**
   * Generates a Nostr identity using the Secp256k1SecretKey and Identifier classes.
   * @param {RawSchnorrKeyPair} [keys] Optional keys to use for identity generation.
   * @returns {ServiceAdapterConfig} The generated Nostr identity configuration.
   */
  public generateIdentity(keys?: RawSchnorrKeyPair): ServiceAdapterConfig {
    if(!keys) {
      this.config.keys.secret = Secp256k1SecretKey.random();
      this.config.keys.public = Secp256k1SecretKey.getPublicKey(this.config.keys.secret).compressed;
      this.config.did = Identifier.encode(
        {
          idType       : this.config.components.idType  || 'KEY',
          version      : this.config.components.version || 1,
          network      : this.config.components.network || 'signet',
          genesisBytes : this.config.keys.public
        }
      );
      return this.config as ServiceAdapterConfig;
    }

    this.config.keys = keys;
    this.config.did = Identifier.encode(
      {
        idType       : this.config.components.idType  || 'KEY',
        version      : this.config.components.version || 1,
        network      : this.config.components.network || 'signet',
        genesisBytes : this.config.keys.public
      }
    );
    return this.config as ServiceAdapterConfig;
  }
}