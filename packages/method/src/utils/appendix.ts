import { HashBytes, W3C_ZCAP_V1 } from '@did-btcr2/common';
import { strings } from '@helia/strings';
import {
  DidDocument,
  DidError,
  DidErrorCode,
  DidService,
  DidVerificationMethod,
  DidVerificationRelationship
} from '@web5/dids';
import { createHelia } from 'helia';
import { CID } from 'multiformats';
import { create as createDigest } from 'multiformats/hashes/digest';
import { RootCapability } from '../interfaces/crud.js';

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/#appendix | 9. Appendix} methods.
 *
 * @class Appendix
 * @type {Appendix}
 */
export class Appendix {
  /**
   * Extracts a DID fragment from a given input
   * @param {unknown} input The input to extract the DID fragment from
   * @returns {string | undefined} The extracted DID fragment or undefined if not found
   */
  public static extractDidFragment(input: unknown): string | undefined {
    if (typeof input !== 'string') return undefined;
    if (input.length === 0) return undefined;
    return input;
  }

  /**
   * Validates that the given object is a DidVerificationMethod
   * @param {unknown} obj The object to validate
   * @returns {boolean} A boolean indicating whether the object is a DidVerificationMethod
   */
  public static isDidVerificationMethod(obj: unknown): obj is DidVerificationMethod {
    // Validate that the given value is an object.
    if (!obj || typeof obj !== 'object' || obj === null) return false;

    // Validate that the object has the necessary properties of a DidVerificationMethod.
    if (!('id' in obj && 'type' in obj && 'controller' in obj)) return false;

    if (typeof obj.id !== 'string') return false;
    if (typeof obj.type !== 'string') return false;
    if (typeof obj.controller !== 'string') return false;

    return true;
  }

  /**
   * Validates that the given object is a DidService
   * @param {unknown} obj The object to validate
   * @returns {boolean} A boolean indicating whether the object is a DidService
   */
  public static isDidService(obj: unknown): obj is DidService {
    // Validate that the given value is an object.
    if (!obj || typeof obj !== 'object' || obj === null) return false;
    // Validate that the object has the necessary properties of a DidService.
    if (!('id' in obj && 'type' in obj && 'serviceEndpoint' in obj)) return false;
    if (typeof obj.id !== 'string') return false;
    if (typeof obj.type !== 'string') return false;
    if (typeof obj.serviceEndpoint !== 'string') return false;
    return true;
  }

  /**
   * Extracts the verification methods from a given DID Document
   * @param {DidDocument} params.didDocument The DID Document to extract the verification methods from
   * @returns {DidVerificationMethod[]} An array of DidVerificationMethod objects
   * @throws {TypeError} if the didDocument is not provided
   */
  public static getVerificationMethods(didDocument: DidDocument): DidVerificationMethod[] {
    if (!didDocument) throw new TypeError(`Required parameter missing: 'didDocument'`);
    const verificationMethods: DidVerificationMethod[] = [];
    // Check the 'verificationMethod' array.
    verificationMethods.push(...didDocument.verificationMethod?.filter(Appendix.isDidVerificationMethod) ?? []);
    // Check verification relationship properties for embedded verification methods.
    Object.keys(DidVerificationRelationship).forEach((relationship) => {
      verificationMethods.push(
        ...(didDocument[relationship as keyof DidDocument] as (DidVerificationMethod)[])
          ?.filter(Appendix.isDidVerificationMethod) ?? []
      );
    });
    return verificationMethods as DidVerificationMethod[];
  }


  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#derive-root-capability-from-didbtcr2-identifier | 9.4.1 Derive Root Capability from did:btcr2 Identifier }.
   *
   * The Derive Root Capability algorithm deterministically generates a ZCAP-LD root capability from a given did:btcr2
   * identifier. Each root capability is unique to the identifier. This root capability is defined and understood by the
   * did:btcr2 specification as the root capability to authorize updates to the specific did:btcr2 identifiers DID
   * document. It takes in a did:btcr2 identifier and returns a rootCapability object. It returns the root capability.
   *
   * @param {string} identifier The did-btcr2 identifier to derive the root capability from
   * @returns {RootCapability} The root capability object
   * @example Root capability for updating the DID document for
   * did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u
   * ```
   * {
   *  "@context": "https://w3id.org/zcap/v1",
   *  "id": "urn:zcap:root:did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u",
   *  "controller": "did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u",
   *  "invocationTarget": "did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u"
   * }
   * ```
   */
  public static deriveRootCapability(identifier: string): RootCapability {
    // 1. Define rootCapability as an empty object.
    const rootCapability = {} as RootCapability;

    // 2. Set rootCapability.@context to ‘https://w3id.org/zcap/v1’.
    rootCapability['@context'] = W3C_ZCAP_V1;

    // 3. Set encodedIdentifier to result of calling algorithm encodeURIComponent(identifier).
    const encodedIdentifier = encodeURIComponent(identifier);

    // 4. Set rootCapability.id to urn:zcap:root:${encodedIdentifier}.
    rootCapability.id = `urn:zcap:root:${encodedIdentifier}`;

    // 5. Set rootCapability.controller to identifier.
    rootCapability.controller = identifier;

    // 6. Set rootCapability.invocationTarget to identifier.
    rootCapability.invocationTarget = identifier;

    // 7. Return rootCapability.
    return rootCapability;
  }


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
  public static derefernceRootCapabilityIdentifier(capabilityId: string): RootCapability {
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

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#fetch-content-from-addressable-storage | 9.3. Fetch Content from Addressable Storage}.
   *
   * The Fetch Content from Addressable Storage function takes in SHA256 hash of some content, hashBytes, converts these
   * bytes to a IPFS v1 Content Identifier and attempts to retrieve the identified content from Content Addressable
   * Storage (CAS). It returns the retrieved content or null.
   *
   * @param {HashBytes} hashBytes The SHA256 hash of the content to be fetched.
   * @returns {string} The fetched content or null if not found.
   */
  public static async fetchFromCas(hashBytes: HashBytes): Promise<string | undefined> {
    // 1. Set cid to the result of converting hashBytes to an IPFS v1 CID.
    const cid = CID.create(1, 1, createDigest(1, hashBytes));

    // Create a Helia node connection to IPFS
    const helia = strings(await createHelia());

    // 2. Set content to the result of fetching the cid from a CAS system. Which CAS systems checked is up to implementation.
    // TODO: Is this right? Are implementations just supposed to check all CAS they trust?'
    const content = await helia.get(cid, {});

    // 3. If content for cid cannot be found, set content to null.
    // 4. Return content.
    return content;
  }
}