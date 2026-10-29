import { hasScheme } from './url-syntax.js';

/**
 * The resolution of a relative DID URL. DID Core v1.1, section 3.2.1, requires the reference
 * resolution algorithm of RFC 3986, section 5, with the DID as the base URI. The base has the
 * scheme `did`, the authority `<method-name>:<method-specific-id>`, an empty path, and no query.
 *
 * The URL parser of the URL Standard cannot do this. The path of a DID is opaque to it, so
 * `new URL('?v=1', did)` throws.
 *
 * The result follows the DID URL ABNF of DID Core v1.1, section 3.2:
 * `did-url = did path-abempty [ "?" query ] [ "#" fragment ]`. The recomposition of RFC 3986,
 * section 5.3, writes `//` and the authority after the scheme. A DID URL has no authority, so
 * the result starts with the DID.
 */

/**
 * Removes the dot segments of a path: RFC 3986, section 5.2.4. The path starts with `/` (the
 * merge of section 5.2.3 adds it), so the rules A and D of section 5.2.4 never apply.
 * @param {string} path The path. It starts with `/`.
 * @returns {string} The path with no `.` or `..` segment.
 */
function removeDotSegments(path: string): string {
  let input = path;
  let output = '';
  while(input.length > 0) {
    if(input.startsWith('/./') || input === '/.') {
      // Rule B: replace the prefix "/./" or "/." with "/".
      input = `/${input.slice(3)}`;
    } else if(input.startsWith('/../') || input === '/..') {
      // Rule C: replace the prefix "/../" or "/.." with "/". Then remove the last segment of the
      // output. The output is empty or starts with "/".
      input = `/${input.slice(4)}`;
      output = output.slice(0, output.lastIndexOf('/'));
    } else {
      // Rule E: move the first segment, with its "/", to the output.
      const next = input.indexOf('/', 1);
      const end = next === -1 ? input.length : next;
      output += input.slice(0, end);
      input = input.slice(end);
    }
  }
  return output;
}

/**
 * Resolves a reference against a DID: RFC 3986, section 5.2.2, with the base of DID Core v1.1,
 * section 3.2.1.
 *
 * The function returns these references unchanged:
 * - A reference with a scheme, for example an absolute DID URL or `urn:x:1`. It is not a
 *   relative reference, so the function does not remove its dot segments.
 * - A reference that starts with `//` (a network-path reference). The result of RFC 3986 has an
 *   authority, and a DID URL cannot have one.
 *
 * For each other reference:
 * - An empty path: the target path is the empty path of the DID.
 * - A path that starts with `/`: the path with no dot segments.
 * - Another path: `/`, then the path (section 5.2.3, a base with an authority and an empty
 *   path), with no dot segments.
 *
 * The query and the fragment of the target are those of the reference, because the base has
 * no query. So the text from the first `?` or `#` of the reference stays as it is.
 *
 * Examples for the DID `did:btcr2:k1q...`:
 *
 * | Reference | Result |
 * |---|---|
 * | `""` | `did:btcr2:k1q...` |
 * | `#key-1` | `did:btcr2:k1q...#key-1` |
 * | `?v=1#key-1` | `did:btcr2:k1q...?v=1#key-1` |
 * | `/keys#key-1` | `did:btcr2:k1q.../keys#key-1` |
 * | `keys#key-1` | `did:btcr2:k1q.../keys#key-1` |
 * | `../a/./b` | `did:btcr2:k1q.../a/b` |
 *
 * @param {string} reference The reference.
 * @param {string} did The DID.
 * @returns {string} The absolute DID URL, or the reference if it stays unchanged.
 */
export function resolveRelativeDidUrl(reference: string, did: string): string {
  if(hasScheme(reference) || reference.startsWith('//')) return reference;
  const pathEnd = reference.search(/[?#]/);
  const path = pathEnd === -1 ? reference : reference.slice(0, pathEnd);
  const queryAndFragment = pathEnd === -1 ? '' : reference.slice(pathEnd);
  if(path === '') return `${did}${queryAndFragment}`;
  const targetPath = removeDotSegments(path.startsWith('/') ? path : `/${path}`);
  return `${did}${targetPath}${queryAndFragment}`;
}

/** The five verification relationships of DID Core v1.1, section 5.3. */
const RELATIONSHIPS: ReadonlySet<string> = new Set([
  'authentication',
  'assertionMethod',
  'keyAgreement',
  'capabilityInvocation',
  'capabilityDelegation'
]);

/**
 * Adds a member to a map. `defineProperty` keeps a `"__proto__"` member as data.
 * @param {Record<string, unknown>} map The map.
 * @param {string} name The name of the member.
 * @param {unknown} value The value of the member.
 */
function setMember(map: Record<string, unknown>, name: string, value: unknown): void {
  Object.defineProperty(map, name, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * Copies a JSON value. If `did` is a string, the copy of each map with a string `id` member has
 * the absolute DID URL of that `id`. A `serviceEndpoint` value is endpoint data, so its copy
 * keeps each `id`.
 * @param {unknown} value The JSON value.
 * @param {string | undefined} did The DID, or `undefined` for a copy with no change.
 * @returns {unknown} The copy.
 */
function expandIds(value: unknown, did: string | undefined): unknown {
  if(Array.isArray(value)) return value.map(item => expandIds(item, did));
  if(typeof value !== 'object' || value === null) return value;
  const copy: Record<string, unknown> = {};
  for(const [name, member] of Object.entries(value)) {
    const expanded = did !== undefined && name === 'id' && typeof member === 'string'
      ? resolveRelativeDidUrl(member, did)
      : expandIds(member, name === 'serviceEndpoint' ? undefined : did);
    setMember(copy, name, expanded);
  }
  return copy;
}

/**
 * Expands the relative DID URLs of a DID document: DID Resolution v1, section 4.4, step 6. The
 * function returns a copy and does not change the document.
 *
 * - Each map with a string `id` member, at any depth below the document: the `id` resolves by
 *   {@link resolveRelativeDidUrl}. This covers each service, each verification method, each
 *   embedded method of a relationship, and each method that an extension-defined property
 *   holds. The function has no list of the extension-defined properties, so each member that
 *   is not a DID Core member counts as one.
 * - Each string item of the five verification relationships: the item resolves the same way.
 *
 * These values stay unchanged:
 * - `@context`. Step 6.1 does not name it. A map in it is a JSON-LD context, and its `id`
 *   member, for example `"id": "@id"`, is not a DID URL.
 * - The document `id`, `controller`, and `alsoKnownAs`. Step 6.1 does not name them. The walk
 *   does not resolve the document `id`. `controller` and `alsoKnownAs` hold only strings, so
 *   the walk does not change them.
 * - Each `serviceEndpoint` value.
 * - A value with a scheme, and a value that starts with `//`. Step 6.2.1 gives no DID URL for
 *   them.
 * @param {object} document The DID document.
 * @param {string} did The DID.
 * @returns {Record<string, unknown>} The copy with absolute DID URLs.
 */
export function expandRelativeDidUrls(document: object, did: string): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for(const [name, value] of Object.entries(document)) {
    let expanded: unknown;
    if(name === '@context') {
      expanded = expandIds(value, undefined);
    } else if(RELATIONSHIPS.has(name) && Array.isArray(value)) {
      expanded = value.map(item => typeof item === 'string' ? resolveRelativeDidUrl(item, did) : expandIds(item, did));
    } else {
      expanded = expandIds(value, did);
    }
    setMember(copy, name, expanded);
  }
  return copy;
}
