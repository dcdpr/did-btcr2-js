import { DidBtcr2 } from '../../did-btcr2.js';

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/#deactivate | 4.4 Deactivate}
 * To deactivate a did:btcr2, the DID controller MUST add the property deactivated with the value true on the DID
 * document. To do this, the DID controller constructs a valid DID Update Payload with a JSON patch that adds this
 * property and announces the payload through a Beacon in their current DID document following the algorithm in Update.
 * Once a did:btcr2 has been deactivated this state is considered permanent and resolution MUST terminate.
 * @class Deactivate
 * @type {Deactivate}
 * @extends {DidBtcr2}
 */
export class Deactivate extends DidBtcr2 {}