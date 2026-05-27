import { DidError, DidErrorCode } from '@web5/dids';
import type { RootCapability } from '../core/interfaces.js';

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/#dereference-root-capability-identifier | 9.4.2 Dereference Root Capability Identifier}.
 *
 * This algorithm takes in capabilityId, a root capability identifier, and dereferences it to rootCapability, the root
 * capability object.
 *
 * @param {string} capabilityId The root capability identifier to dereference.
 * @returns {RootCapability} The root capability object.
 * @example a didUpdatePayload with an invoked ZCAP-LD capability containing a patch defining how the DID document
 * for did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u SHOULD be mutated.
 * ```
 * {
 *  "@context": [
 *   "https://w3id.org/zcap/v1",
 *   "https://w3id.org/security/data-integrity/v2",
 *   "https://w3id.org/json-ld-patch/v1"
 *  ],
 *  "patch": [
 *   {
 *    "op": "add",
 *    "path": "/service/4",
 *    "value": {
 *       "id": "#linked-domain",
 *       "type": "LinkedDomains",
 *       "serviceEndpoint": "https://contact-me.com"
 *      }
 *    }
 *  ],
 *  "proof": {
 *    "type": "DataIntegrityProof",
 *    "cryptosuite": "schnorr-secp256k1-jcs-2025",
 *    "verificationMethod": "did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u#initialKey",
 *    "invocationTarget": "did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u",
 *    "capability": "urn:zcap:root:did%3Abtcr2%3Ak1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u",
 *    "capabilityAction": "Write",
 *    "proofPurpose": "assertionMethod",
 *    "proofValue": "z381yXYmxU8NudZ4HXY56DfMN6zfD8syvWcRXzT9xD9uYoQToo8QsXD7ahM3gXTzuay5WJbqTswt2BKaGWYn2hHhVFKJLXaDz"
 *   }
 * }
 */
export function dereferenceZcapId(capabilityId: string): RootCapability {
  // 1. Set rootCapability to an empty object.
  const rootCapability = {} as RootCapability;

  // 2. Set components to the result of capabilityId.split(":").
  const [urn, zcap, root, did] = capabilityId.split(':') ?? [];

  // 3. Validate components:
  //    1. Assert length of components is 4.
  if ([urn, zcap, root, did].length !== 4) {
    throw new DidError(DidErrorCode.InvalidDid, `Invalid capabilityId: ${capabilityId}`);
  }

  //    2. components[0] == urn.
  if (!urn || urn !== 'urn') {
    throw new DidError(DidErrorCode.InvalidDid, `Invalid capabilityId: ${capabilityId}`);
  }

  //    3. components[1] == zcap.
  if (!zcap || zcap !== 'zcap') {
    throw new DidError(DidErrorCode.InvalidDid, `Invalid capabilityId: ${capabilityId}`);
  }

  //    4. components[2] == root.
  if (!root || root !== 'root') {
    throw new DidError(DidErrorCode.InvalidDid, `Invalid capabilityId: ${capabilityId}`);
  }

  // 4. Set uriEncodedId to components[3].
  const uriEncodedId = did;

  // 5. Set Identifier the result of decodeURIComponent(uriEncodedId).
  const Identifier = decodeURIComponent(uriEncodedId);

  // 6. Set rootCapability.id to capabilityId.
  rootCapability.id = capabilityId;

  // 7. Set rootCapability.controller to Identifier.
  rootCapability.controller = Identifier;

  // 8. Set rootCapability.invocationTarget to Identifier.
  rootCapability.invocationTarget = Identifier;

  // 9. Return rootCapability.
  return rootCapability;
}
