import { CanonicalizationError, canonicalize, DateUtils } from '@did-btcr2/common';
import { Appendix } from './appendix.js';
import { hasDidScheme, hasScheme, isDid, isDidUrl, isRelativeReference, isUri, isUrl } from './url-syntax.js';

/**
 * The role of the code that checks a DID document, in the terms of DID Core v1.1, section 6.
 * A `consumer` reads a document: the read path. A `producer` makes a document: the write
 * path and the create path. A producer also checks the rules for the documents that it makes.
 */
export type ConformanceRole = 'consumer' | 'producer';

/**
 * A DID Core v1.1 rule that a member of a DID document breaks.
 */
export interface ConformanceProblem {
  /** The top-level member that holds the value, for example `service`. */
  member: string;

  /** The rule that the value breaks. The text starts with the path of the value, for example `service[1].id`. */
  message: string;
}

/** The message for a DID document that is not a JSON object. DID Core v1.1, section 4: "A DID document consists of a map of entries". */
export const NOT_A_JSON_OBJECT = 'Invalid DID document: the document must be a JSON object';

/** The five verification relationships of Controlled Identifiers v1.0, section 2.3. */
export const VERIFICATION_RELATIONSHIPS = [
  'authentication',
  'assertionMethod',
  'keyAgreement',
  'capabilityInvocation',
  'capabilityDelegation'
] as const;

/**
 * The Multibase headers that name an encoding in the multibase registry, at commit `72573756`
 * (https://github.com/multiformats/multibase/blob/72573756adb8514d1741b692fe14ebea7f1c01da/multibase.csv).
 * CID v1.0, section 2.4 defines `u` and `z`: "Other Multibase encoding values MAY be used".
 */
const MULTIBASE_HEADERS = new Set([
  '0', '7', '9', 'f', 'F', 'v', 'V', 't', 'T', 'b', 'B', 'c', 'C', 'h', 'k', 'K', 'R',
  'z', 'Z', 'm', 'M', 'u', 'U', 'p', '\u{1F680}'
]);

/** The alphabets of the two Multibase headers of CID v1.0, section 2.4. */
const MULTIBASE_ALPHABETS: Record<string, { name: string; pattern: RegExp }> = {
  u : { name: 'base-64-url-no-pad', pattern: /^[A-Za-z0-9_-]*$/ },
  z : { name: 'base-58-btc', pattern: /^[1-9A-HJ-NP-Za-km-z]*$/ }
};

/**
 * The JWK members of the "Private" information class in the IANA JSON Web Key Parameters
 * registry (https://www.iana.org/assignments/jose/web-key-parameters.csv, read 2026-10-19).
 * CID v1.0, section 2.2.3: `publicKeyJwk` "MUST NOT contain any property marked as "Private"".
 */
const JWK_PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k', 'priv'] as const;

/** The timezone part that an XML Schema `dateTimeStamp` requires: `Z` or an offset. */
const XSD_TIMEZONE = /(Z|[+-]\d{2}:\d{2})$/;

/**
 * Returns true if the value is an XML Schema 1.1 `dateTimeStamp`: an XML Datetime with a timezone.
 * @param {unknown} value The value to check.
 * @returns {boolean} True if the value is a `dateTimeStamp` string.
 */
export function isDateTimeStamp(value: unknown): value is string {
  return typeof value === 'string' && XSD_TIMEZONE.test(value) && DateUtils.isValidXsdDateTime(value);
}

/**
 * Returns true if the value is a map: a JSON object that is not `null` and not an array.
 * @param {unknown} value The value to check.
 * @returns {boolean} True if the value is a map.
 */
export function isJsonMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns the first DID Core v1.1 rule that a member of the document breaks, or `undefined` if
 * the members conform. DID Core v1.1 section 5 takes these rules from Controlled Identifiers
 * (CID) v1.0, section 2. The checks run in the order of DID Core section 5:
 *
 * 1. `controller` is a string or a set of strings (CID 2.1.2).
 * 2. `alsoKnownAs` is a set of strings (CID 2.1.3).
 * 3. `verificationMethod` is a set of maps. Each map has a string `id`, `type`, and
 *    `controller` (CID 2.2). The `id` is a DID URL or a relative DID URL, and the
 *    `controller` is a DID (DID Core 5.2). The key material and the dates follow the rules
 *    of `methodMaterialMessage`.
 * 4. Each of the five verification relationships is a set of one or more items. An item is a
 *    reference with the syntax of a method `id`, or an embedded map with the rules of step 3
 *    (CID 2.3).
 * 5. `service` is a set of maps. Each map has a string `id`, a `type` that is a string or a
 *    set of strings, and a `serviceEndpoint` that is a string, a map, or a set of one or more
 *    strings and maps. No two services have the same `id` after a relative `id` resolves
 *    against the document `id` (CID 2.1.4).
 *
 * A producer also checks these rules:
 *
 * - A set does not contain the same item two times (DID Core 4 and 6.2.1). Two maps are the
 *   same item if their JCS text is the same. Two references are the same item if they give
 *   the same absolute DID URL. A consumer adds each item of a JSON array to the set, and the
 *   set ignores an item that it contains (DID Core 6.2.2 and the Infra Standard), so a
 *   consumer accepts a repeated item.
 * - Each URL has the syntax of its rule: a top-level `controller` item is a DID or a URL
 *   (CID 2.1.2, DID Core 5.1.2), an `alsoKnownAs` item is a URI (CID 2.1.3), a service `id`
 *   has the syntax of a method `id` (CID 2.1.4, DID Core 5.4), and a `serviceEndpoint` string
 *   is a URL (CID 2.1.4). A consumer treats these URLs as opaque (did:btcr2 Data Structures).
 * - A method has no `secretKeyMultibase` (CID 2.2.2: do not publish a secret key).
 * - No two verification methods or services have the same `id` (CID 3.4: the behavior is
 *   not defined).
 *
 * A member that is absent passes. A member that is present must have the value that its rule
 * gives, so `null` fails. The `id` and `@context` checks of a btcr2 DID document are not part
 * of this function.
 *
 * @param {Record<string, unknown>} document The DID document. The caller checks that it is a map.
 * @param {ConformanceRole} role The role of the caller. The default is `consumer`.
 * @returns {ConformanceProblem | undefined} The first rule that fails, or `undefined`.
 */
export function didCoreProblem(
  document: Record<string, unknown>,
  role: ConformanceRole = 'consumer'
): ConformanceProblem | undefined {
  const check: Check = { did: typeof document.id === 'string' ? document.id : '', producer: role === 'producer' };
  return controllerProblem(document.controller, check)
    ?? alsoKnownAsProblem(document.alsoKnownAs, check)
    ?? verificationMethodProblem(document.verificationMethod, check)
    ?? relationshipProblem(document, check)
    ?? serviceProblem(document.service, check)
    ?? (check.producer ? sharedIdProblem(document, check.did) : undefined);
}

/** The context of one check. */
interface Check {
  /** The document `id`, to resolve a relative DID URL. */
  did: string;

  /** True if the caller is a producer. */
  producer: boolean;
}

/**
 * Returns the problem of a member if the message is defined.
 * @param {string} member The member name.
 * @param {string | undefined} message The message of the rule that the member breaks.
 * @returns {ConformanceProblem | undefined} The problem, or `undefined`.
 */
function memberProblem(member: string, message: string | undefined): ConformanceProblem | undefined {
  return message === undefined ? undefined : { member, message };
}

/**
 * Returns the first message that a function gives for the items, or `undefined`.
 * @param {T[]} items The items.
 * @param {(item: T, index: number) => string | undefined} message The function that checks one item.
 * @returns {string | undefined} The first message, or `undefined`.
 */
function firstMessage<T>(items: T[], message: (item: T, index: number) => string | undefined): string | undefined {
  for(const [index, item] of items.entries()) {
    const text = message(item, index);
    if(text !== undefined) return text;
  }
  return undefined;
}

/**
 * Returns the key of a set item. Two items with the same key are the same item.
 * @param {unknown} item The item.
 * @returns {string | undefined} The JCS text of a map, else the JSON text of the item.
 * `undefined` for a map with no JCS form (NaN, a lone surrogate): the hash step of the
 * operation refuses such a document, with the error of the JCS step.
 */
function itemKey(item: unknown): string | undefined {
  if(!isJsonMap(item)) return JSON.stringify(item);
  try {
    return canonicalize(item);
  } catch(error) {
    if(error instanceof CanonicalizationError) return undefined;
    throw error;
  }
}

/**
 * Returns the message for the first item that repeats an earlier item, or `undefined`.
 * @param {string} path The path of the set.
 * @param {unknown[]} items The items of the set.
 * @param {(item: unknown) => string | undefined} key The key of an item. Two items with the same
 * key are the same item. An item with no key is not compared.
 * @returns {string | undefined} The message, or `undefined` if no item repeats.
 */
function duplicateMessage(
  path: string,
  items: unknown[],
  key: (item: unknown) => string | undefined = itemKey
): string | undefined {
  const seen = new Map<string, number>();
  for(const [index, item] of items.entries()) {
    const itemId = key(item);
    if(itemId === undefined) continue;
    const first = seen.get(itemId);
    if(first !== undefined) {
      return `${path}[${index}] repeats ${path}[${first}]: a set contains each item one time`;
    }
    seen.set(itemId, index);
  }
  return undefined;
}

/**
 * Checks a value that must be a set of strings, or (if `single` is true) also one string. An
 * absent value passes. A producer also checks each item with `itemMessage`, and then checks
 * that no item repeats.
 * @param {string} path The path of the value.
 * @param {unknown} value The value.
 * @param {boolean} single True if one string is also a valid value.
 * @param {Check} check The context of the check.
 * @param {(itemPath: string, item: string) => string | undefined} itemMessage The producer check of one item.
 * @returns {string | undefined} The message, or `undefined`.
 */
function stringSetMessage(
  path: string,
  value: unknown,
  single: boolean,
  check: Check,
  itemMessage: (itemPath: string, item: string) => string | undefined = () => undefined
): string | undefined {
  if(value === undefined) return undefined;
  if(single && typeof value === 'string') return check.producer ? itemMessage(path, value) : undefined;
  if(!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    return `${path} must be ${single ? 'a string or an array of strings' : 'an array of strings'}`;
  }
  if(!check.producer) return undefined;
  return firstMessage(value, (item, index) => itemMessage(`${path}[${index}]`, item)) ?? duplicateMessage(path, value);
}

/**
 * Checks the top-level `controller`. A producer also checks that each item is a DID or a URL.
 * An item with the `did` scheme must be a DID: it cannot have a path, a query, or a fragment
 * (DID Core 5.1.3).
 * @param {unknown} value The member value.
 * @param {Check} check The context of the check.
 * @returns {ConformanceProblem | undefined} The problem, or `undefined`.
 */
function controllerProblem(value: unknown, check: Check): ConformanceProblem | undefined {
  return memberProblem('controller', stringSetMessage('controller', value, true, check, (path, item) => {
    if(hasDidScheme(item)) return isDid(item) ? undefined : `${path} must be a DID`;
    return isUrl(item) ? undefined : `${path} must be a DID or a URL`;
  }));
}

/**
 * Checks `alsoKnownAs`. A producer also checks that each item is an RFC 3986 URI.
 * @param {unknown} value The member value.
 * @param {Check} check The context of the check.
 * @returns {ConformanceProblem | undefined} The problem, or `undefined`.
 */
function alsoKnownAsProblem(value: unknown, check: Check): ConformanceProblem | undefined {
  return memberProblem('alsoKnownAs', stringSetMessage('alsoKnownAs', value, false, check, (path, item) =>
    isUri(item) ? undefined : `${path} must be a URI`));
}

/**
 * Checks a reference to a verification method or a service, or the `id` of one (DID Core
 * 3.2, 3.2.1, and 5.2):
 *
 * 1. A value with the `did` scheme must be a DID URL.
 * 2. A value with no scheme is a relative DID URL. It must be an RFC 3986 relative reference.
 * 3. A value with another scheme must be a URL.
 *
 * A consumer checks only rules 1 and 2, and it does not check a relative reference with an
 * authority (`//`). It treats the other values as opaque, because they can contain a host.
 * @param {string} path The path of the value.
 * @param {string} value The value.
 * @param {Check} check The context of the check.
 * @returns {string | undefined} The message, or `undefined`.
 */
function referenceMessage(path: string, value: string, check: Check): string | undefined {
  if(hasDidScheme(value)) {
    return isDidUrl(value) ? undefined : `${path} must be a DID URL: the value has the "did" scheme`;
  }
  if(!hasScheme(value)) {
    if(!check.producer && value.startsWith('//')) return undefined;
    return isRelativeReference(value) ? undefined : `${path} must be a relative DID URL: an RFC 3986 relative reference`;
  }
  return !check.producer || isUrl(value) ? undefined : `${path} must be a URL`;
}

/**
 * Returns true if the value is a map with a string `id`, `type`, and `controller`.
 * @param {unknown} value The value.
 * @returns {boolean} True if the value has the shape of a verification method.
 */
function isMethodMap(value: unknown): value is Record<string, unknown> {
  return isJsonMap(value)
    && typeof value.id === 'string'
    && typeof value.type === 'string'
    && typeof value.controller === 'string';
}

/**
 * Checks a Multibase value (CID v1.0, section 2.4). The first character is a header of
 * `MULTIBASE_HEADERS`. After a `u` or a `z` header, each character is in the alphabet of the
 * header. CID defines no alphabet for the other headers, so the check for them stops at the header.
 * @param {string} path The path of the value.
 * @param {unknown} value The value.
 * @returns {string | undefined} The message, or `undefined`.
 */
function multibaseMessage(path: string, value: unknown): string | undefined {
  const header = typeof value === 'string' && value.length > 0
    ? String.fromCodePoint(value.codePointAt(0)!)
    : undefined;
  if(header === undefined || !MULTIBASE_HEADERS.has(header)) {
    return `${path} must be a string that starts with a Multibase header`;
  }
  const alphabet = MULTIBASE_ALPHABETS[header];
  if(alphabet && !alphabet.pattern.test((value as string).slice(header.length))) {
    return `${path} must use only ${alphabet.name} characters after the "${header}" header`;
  }
  return undefined;
}

/**
 * Checks a `publicKeyJwk` value (CID v1.0, section 2.2.3): a JSON Web Key with a string `kty`
 * (RFC 7517, section 4.1) and no member of `JWK_PRIVATE_MEMBERS`.
 * @param {string} path The path of the value.
 * @param {unknown} value The value.
 * @returns {string | undefined} The message, or `undefined`.
 */
function publicKeyJwkMessage(path: string, value: unknown): string | undefined {
  if(!isJsonMap(value) || typeof value.kty !== 'string') {
    return `${path} must be a JSON Web Key: a map with a string kty`;
  }
  const privateMember = JWK_PRIVATE_MEMBERS.find(name => Object.hasOwn(value, name));
  if(privateMember) {
    return `${path}.${privateMember} must not be present: a public key has no private member`;
  }
  return undefined;
}

/**
 * Checks a verification method map: its `id` and `controller` syntax, its key material, and its
 * dates. An absent property passes.
 *
 * 1. The `id` is a reference (see `referenceMessage`), and the `controller` is a DID
 *    (DID Core 5.2).
 * 2. Not both `publicKeyMultibase` and `publicKeyJwk`: they express the same material
 *    (CID 2.2.1).
 * 3. `publicKeyMultibase` is a Multibase value (CID 2.2.2).
 * 4. `publicKeyJwk` is a JSON Web Key with no private member (CID 2.2.3).
 * 5. `secretKeyMultibase` is a Multibase value (CID 2.2.2). A producer then refuses it.
 * 6. No `secretKeyJwk`: a DID document is public (CID 2.2.3).
 * 7. `expires` and `revoked` are XML Schema 1.1 `dateTimeStamp` strings (CID 2.2).
 *
 * The rules do not depend on the method `type`.
 * @param {string} path The path of the method.
 * @param {Record<string, unknown>} method The method. The caller checks its shape.
 * @param {Check} check The context of the check.
 * @returns {string | undefined} The message, or `undefined`.
 */
function methodMessage(path: string, method: Record<string, unknown>, check: Check): string | undefined {
  const idMessage = referenceMessage(`${path}.id`, method.id as string, check);
  if(idMessage) return idMessage;
  if(!isDid(method.controller as string)) return `${path}.controller must be a DID`;
  const { publicKeyMultibase, publicKeyJwk, secretKeyMultibase, secretKeyJwk, expires, revoked } = method;
  if(publicKeyMultibase !== undefined && publicKeyJwk !== undefined) {
    return `${path} must not have both publicKeyMultibase and publicKeyJwk: they express the same key`;
  }
  if(publicKeyMultibase !== undefined) {
    const message = multibaseMessage(`${path}.publicKeyMultibase`, publicKeyMultibase);
    if(message) return message;
  }
  if(publicKeyJwk !== undefined) {
    const message = publicKeyJwkMessage(`${path}.publicKeyJwk`, publicKeyJwk);
    if(message) return message;
  }
  if(secretKeyMultibase !== undefined) {
    const message = multibaseMessage(`${path}.secretKeyMultibase`, secretKeyMultibase);
    if(message) return message;
    if(check.producer) return `${path}.secretKeyMultibase must not be present: a DID document is public`;
  }
  if(secretKeyJwk !== undefined) {
    return `${path}.secretKeyJwk must not be present: a DID document is public`;
  }
  for(const [name, value] of [['expires', expires], ['revoked', revoked]] as const) {
    if(value !== undefined && !isDateTimeStamp(value)) {
      return `${path}.${name} must be an XML Schema dateTimeStamp: a date and a time with a timezone`;
    }
  }
  return undefined;
}

/**
 * Checks `verificationMethod`.
 * @param {unknown} value The member value.
 * @param {Check} check The context of the check.
 * @returns {ConformanceProblem | undefined} The problem, or `undefined`.
 */
function verificationMethodProblem(value: unknown, check: Check): ConformanceProblem | undefined {
  const member = 'verificationMethod';
  if(value === undefined) return undefined;
  if(!Array.isArray(value)) return { member, message: `${member} must be an array` };
  return memberProblem(member, firstMessage(value, (method, index) => {
    const path = `${member}[${index}]`;
    return isMethodMap(method) ? methodMessage(path, method, check) : `${path} must be a map with a string id, type, and controller`;
  }) ?? (check.producer ? duplicateMessage(member, value) : undefined));
}

/**
 * Checks the five verification relationships.
 * @param {Record<string, unknown>} document The DID document.
 * @param {Check} check The context of the check.
 * @returns {ConformanceProblem | undefined} The problem, or `undefined`.
 */
function relationshipProblem(document: Record<string, unknown>, check: Check): ConformanceProblem | undefined {
  for(const member of VERIFICATION_RELATIONSHIPS) {
    const value = document[member];
    if(value === undefined) continue;
    if(!Array.isArray(value) || value.length === 0) {
      return { member, message: `${member} must be an array of one or more items` };
    }
    const message = firstMessage(value, (item, index) => {
      const path = `${member}[${index}]`;
      if(typeof item === 'string') return referenceMessage(path, item, check);
      return isMethodMap(item)
        ? methodMessage(path, item, check)
        : `${path} must be a string or a map with a string id, type, and controller`;
    })
      // A reference names a verification method. "#key-1" and "<did>#key-1" name the same method.
      ?? (check.producer ? duplicateMessage(member, value, item => typeof item === 'string'
        ? JSON.stringify(Appendix.absoluteDidUrl(item, check.did) ?? item)
        : itemKey(item)) : undefined);
    if(message) return { member, message };
  }
  return undefined;
}

/**
 * Checks `service`.
 * @param {unknown} value The member value.
 * @param {Check} check The context of the check.
 * @returns {ConformanceProblem | undefined} The problem, or `undefined`.
 */
function serviceProblem(value: unknown, check: Check): ConformanceProblem | undefined {
  const member = 'service';
  if(value === undefined) return undefined;
  if(!Array.isArray(value)) return { member, message: `${member} must be an array` };
  const firstIndexOfId = new Map<string, number>();
  for(const [index, service] of value.entries()) {
    const path = `${member}[${index}]`;
    if(!isJsonMap(service)) return { member, message: `${path} must be a map` };
    const { id, type, serviceEndpoint } = service;
    if(typeof id !== 'string') return { member, message: `${path}.id must be a string` };
    const fieldMessage = (check.producer ? referenceMessage(`${path}.id`, id, check) : undefined)
      ?? (type === undefined ? `${path}.type must be a string or an array of strings` : undefined)
      ?? stringSetMessage(`${path}.type`, type, true, check)
      ?? serviceEndpointMessage(`${path}.serviceEndpoint`, serviceEndpoint, check);
    if(fieldMessage) return { member, message: fieldMessage };
    // CID 2.1.4: "A conforming document MUST NOT include multiple service entries with the same id."
    const absoluteId = Appendix.absoluteDidUrl(id, check.did) ?? id;
    const first = firstIndexOfId.get(absoluteId);
    if(first !== undefined) {
      return { member, message: `${path}.id is the id of ${member}[${first}]: each service needs a different id` };
    }
    firstIndexOfId.set(absoluteId, index);
  }
  return undefined;
}

/**
 * Checks a `serviceEndpoint` value: a string, a map, or a set of one or more strings and maps.
 * A producer also checks that each string is a URL and that no item repeats.
 * @param {string} path The path of the value.
 * @param {unknown} value The value.
 * @param {Check} check The context of the check.
 * @returns {string | undefined} The message, or `undefined`.
 */
function serviceEndpointMessage(path: string, value: unknown, check: Check): string | undefined {
  const urlMessage = (itemPath: string, item: unknown): string | undefined =>
    typeof item === 'string' && !isUrl(item) ? `${itemPath} must be a URL` : undefined;
  if(typeof value === 'string' || isJsonMap(value)) return check.producer ? urlMessage(path, value) : undefined;
  if(!Array.isArray(value) || value.length === 0
    || !value.every(item => typeof item === 'string' || isJsonMap(item))) {
    return `${path} must be a string, a map, or an array of one or more strings and maps`;
  }
  if(!check.producer) return undefined;
  return firstMessage(value, (item, index) => urlMessage(`${path}[${index}]`, item)) ?? duplicateMessage(path, value);
}

/**
 * Checks that no two verification methods or services have the same `id` after a relative
 * `id` resolves against the document `id`. A method in `verificationMethod` and a method
 * embedded in a relationship both count. Only a producer runs this check: CID v1.0, section
 * 3.4 says that a document with two fragments with the same id is "to be avoided", and that
 * the behavior is not defined. The caller checks the shape of each member first.
 * @param {Record<string, unknown>} document The DID document.
 * @param {string} did The document `id`.
 * @returns {ConformanceProblem | undefined} The problem, or `undefined`.
 */
function sharedIdProblem(document: Record<string, unknown>, did: string): ConformanceProblem | undefined {
  const items: Array<[member: string, path: string, id: string]> = [];
  for(const member of ['verificationMethod', ...VERIFICATION_RELATIONSHIPS, 'service']) {
    const value = document[member];
    if(!Array.isArray(value)) continue;
    for(const [index, item] of value.entries()) {
      if(isJsonMap(item)) items.push([member, `${member}[${index}]`, item.id as string]);
    }
  }
  const firstPathOfId = new Map<string, string>();
  for(const [member, path, id] of items) {
    const absoluteId = Appendix.absoluteDidUrl(id, did) ?? id;
    const first = firstPathOfId.get(absoluteId);
    if(first !== undefined) {
      return { member, message: `${path}.id is the id of ${first}: each verification method and each service needs a different id` };
    }
    firstPathOfId.set(absoluteId, path);
  }
  return undefined;
}
