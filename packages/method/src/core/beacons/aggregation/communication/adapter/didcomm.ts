import { Maybe, NotImplementedError } from '@did-btcr2/common';
import { RawSchnorrKeyPair, SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { Identifier } from '../../../../../utils/identifier.js';
import { AggregateBeaconMessageType } from '../../cohort/messages/index.js';
import { CommunicationService, MessageHandler, ServiceAdapterConfig, ServiceAdapterIdentity } from '../service.js';

/**
 * DidCommAdapterConfig is a configuration class for the DidCommAdapter.
 * It holds the necessary parameters to connect to Nostr relays and manage keys.
 * @class DidCommAdapterConfig
 * @implements {ServiceAdapterConfig}
 * @type {DidCommAdapterConfig}
 */
export class DidCommAdapterConfig implements ServiceAdapterConfig {
  public keys: RawSchnorrKeyPair;
  public components: {
    idType: string;
    version: number;
    network: string;
  };
  public did: string;
  public coordinatorDids: string[];

  /**
   * Constructs a new DidCommAdapterConfig instance.
   * @param {Partial<ServiceAdapterConfig>} [config] Optional configuration parameters to initialize the adapter.
   * @constructor
   * @type {DidCommAdapterConfig}
   */
  constructor(config?: Partial<ServiceAdapterConfig>) {
    this.keys = config?.keys || SchnorrKeyPair.generate().raw,
    this.components = config?.components || {
      version : 1,
      idType  : 'KEY',
      network : 'mutinynet'
    };
    this.did = config?.did || Identifier.encode(
      {
        ...this.components,
        genesisBytes : this.keys.public
      }
    );
    this.coordinatorDids = config?.coordinatorDids || [];
  }
}

/**
 * DidCommAdapter implements the CommunicationService interface for DidComm protocol.
 * It handles message sending, receiving, and identity generation using DidComm.
 * @class DidCommAdapter
 * @implements {CommunicationService}
 * @type {DidCommAdapter}
 */
export class DidCommAdapter implements CommunicationService {
  /**
   * The name of the communication service.
   * @type {string}
   */
  public name: string = 'didcomm';

  /**
   * The configuration for the DidComm adapter.
   * @type {DidCommAdapterConfig}
   */
  public config: DidCommAdapterConfig;

  /**
   * A map of message handlers for different message types.
   * @type {Map<string, MessageHandler>}
   */
  private handlers: Map<string, MessageHandler> = new Map();

  /**
   * Constructs a new DidCommAdapter instance with the provided configuration.
   * @param {DidCommAdapterConfig} [config] The configuration for the Nostr adapter.
   */
  constructor(config: DidCommAdapterConfig = {} as DidCommAdapterConfig) {
    this.config = new DidCommAdapterConfig(config);
  }

  /**
   * Starts the DidComm service.
   * @returns {void} Returns the DidCommAdapter instance for method chaining.
   */
  public start(): void {
    throw new NotImplementedError('DidCommAdapter is not implemented. Use NostrAdapter instead.');
  }

  /**
   * Sets the keys used for Nostr communication.
   * @param {ServiceAdapterIdentity<NostrKeys>} keys The keys to set.
   */
  public setKeys(keys: ServiceAdapterIdentity<RawSchnorrKeyPair>): void {
    this.config.keys = keys;
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
   * @param {Maybe<AggregateBeaconMessageType>} _message The message to send, typically containing the content and metadata.
   * @param {string} _recipient The public key or identifier of the recipient.
   * @param {string} _sender The public key or identifier of the sender.
   * @returns {Promise<void>} A promise that resolves when the message is sent.
   */
  public async sendMessage(
    _message: Maybe<AggregateBeaconMessageType>,
    _recipient: string,
    _sender: string
  ): Promise<void | Promise<string>[]> {
    throw new NotImplementedError('DidCommAdapter.start() is not implemented. Use NostrAdapter instead.');
  }

  /**
   * Generates a DidComm identity.
   * @param {RawKeyPair} [keys] Optional keys to use for identity generation.
   * @returns {ServiceAdapterConfig} The generated DidComm identity configuration.
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