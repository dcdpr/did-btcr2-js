import { SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { Filter } from 'nostr-tools';
import { SimplePool, } from 'nostr-tools/pool';
<<<<<<<< HEAD:packages/method/src/core/beacon/aggregation/protocol/nostr.ts
import { Identifier } from '../../../../utils/identifier.js';
========
>>>>>>>> e63c2d7 (align with main):packages/method/src/core/beacon/aggregate/protocol/nostr.ts
import { ProtocolService } from './service.js';
import { Btc1Identifier } from '../../../../utils/identifier.js';

export interface NostrAdapterConfig {
  keys: {
    secret?: Uint8Array;
    public?: Uint8Array;
  };
  did?: string;
  components: {
    idType?: string;
    version?: number;
    network?: string;
  };
  relays: string[];
  [key: string]: any;
}

export class NostrAdapter implements ProtocolService {
  public name: string = 'nostr';
  private config: NostrAdapterConfig;
  private handlers: Map<string, (msg: any) => Promise<void>> = new Map();

  constructor(config: NostrAdapterConfig = { keys: {}, components: {}, relays: ['wss://relay.damus.io'] }) {
    this.config = config;
    this.config.keys = this.config.keys || SchnorrKeyPair.generate().raw;
    this.config.did = config.did || Identifier.encode({
      idType       : config.components.idType || 'KEY',
      version      : config.components.version || 1,
      network      : config.components.network || 'signet',
      genesisBytes : this.config.keys.public!
    });
  }

  async start(): Promise<void> {
    const pool = new SimplePool();
    pool.subscribe(this.config.relays, { pubkey: this.config.did, kinds: [1059] } as Filter, {
      onclose : (reasons: string[]) => console.log('Subscription closed for reasons:', reasons),
      onevent : async (event: any) => {
        console.log('Received event:', event);
      }
    });
  }

  registerMessageHandler(messageType: string, handler: (msg: any) => Promise<void>): void {
    this.handlers.set(messageType, handler);
  }

  /**
   * Sends a message to a recipient using the Nostr protocol.
   * This method is a placeholder and should be implemented with actual Nostr message sending logic.
   * @param message
   * @param recipient
   * @param sender
   */
  async sendMessage(message: object, recipient: string, sender: string): Promise<void> {
    // TODO: Implement message sending logic via Nostr
    console.log(`Sending message to ${recipient} from ${sender}:`, message);
  }

  /**
   * Generates a Nostr identity using the Secp256k1SecretKey and Identifier classes.
   * @returns {string} A BTCR2 DID used for communication over the nostr protocol
   */
  public generateIdentity(): string {
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
    return this.config.did;
  }
}