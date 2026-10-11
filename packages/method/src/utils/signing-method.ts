import { VERIFICATION_METHOD_ERROR } from '@did-btcr2/common';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { MULTIKEY_VERIFICATION_METHOD_TYPE } from './did-document.js';
import type { ErrorCause } from './error-cause.js';
import { errorCause } from './error-cause.js';

/**
 * A condition that a verification method fails. A method that fails a condition cannot sign
 * a BTCR2 Update.
 */
export interface SigningMethodProblem {
  /** The field that fails the condition: `type`, `controller`, or `publicKeyMultibase`. */
  field: 'type' | 'controller' | 'publicKeyMultibase';

  /** The rule that the field breaks, for example `type must equal "Multikey"`. */
  message: string;

  /**
   * The type and the message of the key error: the decode error, or the error for text that
   * is not the base58btc encoding of the key.
   */
  cause?: ErrorCause;
}

/**
 * Returns the first condition that a verification method fails, or `undefined` if the method
 * can sign a BTCR2 Update. A method that fails a condition cannot sign. The specification
 * names the same three conditions on the write path ("Construct BTCR2 Signed Update") and on
 * the read path ("Check update.proof"):
 *
 * 1. `type` must equal {@link MULTIKEY_VERIFICATION_METHOD_TYPE | Multikey}.
 * 2. `controller` must equal the DID.
 * 3. `publicKeyMultibase` must encode a secp256k1 public key as the Multikey section of the
 *    BIP340 Cryptosuite specifies. That is: the `z` header, base58btc, 35 bytes, the prefix
 *    `0xe701`, and a valid compressed point. The `zQ3s` prefix alone does not satisfy this
 *    condition. The value must also be the base58btc text of the key. The decoder accepts
 *    some other text for the same bytes, but the specification allows no other encoding.
 *
 * The conditions apply to the method that signs, in the embedded form and in the referenced
 * form. The caller finds that method through `capabilityInvocation` first.
 *
 * @param {unknown} method The verification method that signs.
 * @param {string} did The DID: `sourceDidDocument.id` on the write path, the DID under resolution
 * on the read path, and the id of the resolved document for the aggregation communication key.
 * @returns {SigningMethodProblem | undefined} The first condition that fails, or `undefined`.
 */
export function signingMethodProblem(method: unknown, did: string): SigningMethodProblem | undefined {
  const { id, type, controller, publicKeyMultibase } = (method ?? {}) as Record<string, unknown>;
  if(type !== MULTIKEY_VERIFICATION_METHOD_TYPE) {
    return { field: 'type', message: `type must equal "${MULTIKEY_VERIFICATION_METHOD_TYPE}"` };
  }
  if(controller !== did) {
    return { field: 'controller', message: `controller must equal "${did}"` };
  }
  const keyMessage = 'publicKeyMultibase must encode a secp256k1 public key as a BIP340 Multikey';
  if(typeof publicKeyMultibase !== 'string') {
    return { field: 'publicKeyMultibase', message: keyMessage };
  }
  let encoded: string;
  try {
    encoded = SchnorrMultikey.fromVerificationMethod({
      id : String(id),
      type,
      controller,
      publicKeyMultibase
    }).publicKey.multibase.encoded;
  } catch(error) {
    return { field: 'publicKeyMultibase', message: keyMessage, cause: errorCause(error) };
  }
  if(encoded !== publicKeyMultibase) {
    return {
      field   : 'publicKeyMultibase',
      message : keyMessage,
      cause   : {
        type    : VERIFICATION_METHOD_ERROR,
        message : 'Invalid publicKeyMultibase: not the base58btc encoding of the key'
      }
    };
  }
  return undefined;
}
