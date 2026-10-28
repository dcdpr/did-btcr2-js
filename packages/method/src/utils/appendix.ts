import type {
  DidDocument,
  DidService,
  DidVerificationMethod} from '@web5/dids';
import { DidVerificationRelationship } from '@web5/dids';
import { DidDocumentError } from '@did-btcr2/std';
import type { RootCapability } from '../core/interfaces.js';

/**
 * Helper functions for DID URLs, verification methods, and the Root Capability of a DID.
 *
 * @class Appendix
 * @type {Appendix}
 */
export class Appendix {
  /**
   * Resolves a DID URL that may be written as a relative reference against the
   * DID it appears under. DID Core permits the `id` of a verification method or
   * service, and the entries of a verification relationship, to be a relative
   * DID URL such as `#initialKey`; it denotes that fragment of `did`. Absolute
   * DID URLs are returned unchanged, so both spellings of the same reference
   * compare equal without discarding the DID being compared.
   *
   * @param {unknown} input The DID URL to resolve. Non-strings yield `undefined`.
   * @param {string} did The DID the relative reference is resolved against.
   * @returns {string | undefined} The absolute DID URL, or `undefined` if `input` is not a usable string.
   */
  public static absoluteDidUrl(input: unknown, did: string): string | undefined {
    if (typeof input !== 'string') return undefined;
    if (input.length === 0) return undefined;
    return input.startsWith('#') ? `${did}${input}` : input;
  }

  /**
   * Resolves a verification relationship entry to the absolute DID URL of the method it
   * names. A relationship entry is either a reference to a method defined elsewhere in the
   * document, or a method embedded inline, which names itself with its own `id`; either
   * spelling may be a relative DID URL.
   *
   * Every comparison of a relationship entry against a method id goes through this helper,
   * on both the read path and the write path, so the two admit exactly the same spellings.
   *
   * Malformed entries yield `undefined` rather than a placeholder string, so two unusable
   * values never compare equal to each other. Callers comparing a resolved entry must still
   * reject an `undefined` target before comparing, or an unusable target matches an
   * unusable entry.
   *
   * @param {unknown} entry The relationship entry: a reference, or an embedded method.
   * @param {string} did The DID the relative reference is resolved against.
   * @returns {string | undefined} The absolute DID URL, or `undefined` if unusable.
   */
  public static relationshipMethodId(entry: unknown, did: string): string | undefined {
    const id = (typeof entry === 'object' && entry !== null && !Array.isArray(entry))
      ? (entry as { id?: unknown }).id
      : entry;
    return Appendix.absoluteDidUrl(id, did);
  }

  /**
   * Finds the entry of `document.capabilityInvocation` that identifies `methodId`. A
   * reference entry identifies it when the two DID URLs are equal. An embedded verification
   * method object identifies it when its `id` is equal. Both spellings of a DID URL compare
   * equal, as in {@link relationshipMethodId}. This is the lookup of the specification steps
   * "Check `update.proof`" (the read path) and "Construct BTCR2 Signed Update" (the write
   * path); the caller raises `INVALID_DID_UPDATE` when no entry identifies the method.
   *
   * @param {DidDocument} document The DID document.
   * @param {unknown} methodId The verification method id, absolute or relative. A non-string yields `undefined`.
   * @returns {string | DidVerificationMethod | undefined} The entry, or `undefined` if no entry identifies the id.
   */
  public static capabilityInvocationEntry(
    document: DidDocument,
    methodId: unknown
  ): string | DidVerificationMethod | undefined {
    const targetId = Appendix.relationshipMethodId(methodId, document.id);
    if (targetId === undefined) return undefined;
    return document.capabilityInvocation?.find(
      entry => Appendix.relationshipMethodId(entry, document.id) === targetId
    );
  }

  /**
   * Returns the verification method that a relationship entry denotes: the object itself
   * when the entry embeds the method, else the member of `document.verificationMethod` whose
   * `id` equals the reference. Both spellings of a DID URL compare equal. The caller raises
   * `INVALID_DID_UPDATE` when a reference names no member.
   *
   * @param {DidDocument} document The DID document.
   * @param {string | DidVerificationMethod} entry The relationship entry: a reference, or an embedded method.
   * @returns {DidVerificationMethod | undefined} The method, or `undefined` if a reference names no member.
   */
  public static verificationMethodOfEntry(
    document: DidDocument,
    entry: string | DidVerificationMethod
  ): DidVerificationMethod | undefined {
    if (Appendix.isDidVerificationMethod(entry)) return entry;
    const targetId = Appendix.absoluteDidUrl(entry, document.id);
    if (targetId === undefined) return undefined;
    return document.verificationMethod?.find(
      method => Appendix.absoluteDidUrl(method?.id, document.id) === targetId
    );
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
   * Extracts the verification methods from a given DID Document.
   * @param didDocument The DID Document to extract the verification methods from
   * @returns An array of DidVerificationMethod objects
   * @throws {DidDocumentError} if the didDocument is not provided
   */
  public static getVerificationMethods(didDocument: DidDocument): DidVerificationMethod[] {
    if (!didDocument) throw new DidDocumentError(`Required parameter missing: 'didDocument'`);
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
   * Returns the
   * {@link https://dcdpr.github.io/did-btcr2/data-structures.html#root-capability | Root Capability (data structure)}
   * of a did:btcr2 identifier. The Root Capability authorizes updates to the DID document of the identifier, and
   * each identifier has its own Root Capability. Its `id` is `urn:zcap:root:${encodeURIComponent(identifier)}`.
   *
   * @param {string} identifier The did-btcr2 identifier to derive the root capability from
   * @returns {RootCapability} The root capability object
   * @example Root capability for updating the DID document for
   * did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u
   * ```
   * {
   *  "@context": "https://w3id.org/zcap/v1",
   *  "id": "urn:zcap:root:did%3Abtcr2%3Ak1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u",
   *  "controller": "did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u",
   *  "invocationTarget": "did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u"
   * }
   * ```
   */
  static deriveRootCapability(identifier: string): RootCapability {
    return {
      '@context'       : 'https://w3id.org/zcap/v1',
      id               : `urn:zcap:root:${encodeURIComponent(identifier)}`,
      controller       : identifier,
      invocationTarget : identifier,
    };
  }
}
