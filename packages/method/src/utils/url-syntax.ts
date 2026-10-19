/**
 * The syntax checks for the URL values of a DID document. Each check uses the grammar of the
 * text that defines the value:
 *
 * - A DID and a DID URL: the ABNF of DID Core v1.1, sections 3.1 and 3.2.
 * - A URI and a relative reference: the ABNF of RFC 3986, sections 3 and 4.2.
 * - A URL: the URL parser of the URL Standard (https://url.spec.whatwg.org/).
 *
 * The regular expressions follow the ABNF rule names. ABNF strings are case-insensitive
 * (RFC 5234, section 2.3), so the `did:` string of the DID ABNF also matches `DID:`.
 */

/** RFC 3986 `unreserved` and `sub-delims`, as the body of a character class. */
const UNRESERVED_SUB_DELIMS = 'A-Za-z0-9\\-._~!$&\'()*+,;=';
const PCT_ENCODED = '%[0-9A-Fa-f]{2}';
const PCHAR = `(?:[${UNRESERVED_SUB_DELIMS}:@]|${PCT_ENCODED})`;
const SEGMENT = `${PCHAR}*`;
const SEGMENT_NZ = `${PCHAR}+`;
const SEGMENT_NZ_NC = `(?:[${UNRESERVED_SUB_DELIMS}@]|${PCT_ENCODED})+`;
const QUERY_OR_FRAGMENT = `(?:${PCHAR}|[/?])*`;
const PATH_ABEMPTY = `(?:/${SEGMENT})*`;
const PATH_ABSOLUTE = `/(?:${SEGMENT_NZ}(?:/${SEGMENT})*)?`;
const PATH_NOSCHEME = `${SEGMENT_NZ_NC}(?:/${SEGMENT})*`;
const PATH_ROOTLESS = `${SEGMENT_NZ}(?:/${SEGMENT})*`;
const DEC_OCTET = '(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])';
const IPV4_ADDRESS = `${DEC_OCTET}(?:\\.${DEC_OCTET}){3}`;
const H16 = '[0-9A-Fa-f]{1,4}';
const LS32 = `(?:${H16}:${H16}|${IPV4_ADDRESS})`;
const IPV6_ADDRESS = [
  `(?:${H16}:){6}${LS32}`,
  `::(?:${H16}:){5}${LS32}`,
  `(?:${H16})?::(?:${H16}:){4}${LS32}`,
  `(?:(?:${H16}:){0,1}${H16})?::(?:${H16}:){3}${LS32}`,
  `(?:(?:${H16}:){0,2}${H16})?::(?:${H16}:){2}${LS32}`,
  `(?:(?:${H16}:){0,3}${H16})?::${H16}:${LS32}`,
  `(?:(?:${H16}:){0,4}${H16})?::${LS32}`,
  `(?:(?:${H16}:){0,5}${H16})?::${H16}`,
  `(?:(?:${H16}:){0,6}${H16})?::`
].join('|');
const IPVFUTURE = `v[0-9A-Fa-f]+\\.[${UNRESERVED_SUB_DELIMS}:]+`;
// An IPv4address is also a reg-name, so the host rule does not name it.
const HOST = `(?:\\[(?:${IPV6_ADDRESS}|${IPVFUTURE})\\]|(?:[${UNRESERVED_SUB_DELIMS}]|${PCT_ENCODED})*)`;
const AUTHORITY = `(?:(?:[${UNRESERVED_SUB_DELIMS}:]|${PCT_ENCODED})*@)?${HOST}(?::[0-9]*)?`;
const SCHEME = '[A-Za-z][A-Za-z0-9+\\-.]*';
const QUERY_AND_FRAGMENT = `(?:\\?${QUERY_OR_FRAGMENT})?(?:#${QUERY_OR_FRAGMENT})?`;

/** RFC 3986 `URI`. */
const URI = new RegExp(`^${SCHEME}:(?://${AUTHORITY}${PATH_ABEMPTY}|${PATH_ABSOLUTE}|${PATH_ROOTLESS})?${QUERY_AND_FRAGMENT}$`);

/** RFC 3986 `relative-ref`. */
const RELATIVE_REF = new RegExp(`^(?://${AUTHORITY}${PATH_ABEMPTY}|${PATH_ABSOLUTE}|${PATH_NOSCHEME})?${QUERY_AND_FRAGMENT}$`);

/** The start of an RFC 3986 `URI`: a scheme and a colon. */
const SCHEME_PREFIX = new RegExp(`^${SCHEME}:`);

/** DID Core v1.1, section 3.1: `did`. */
const DID = `[Dd][Ii][Dd]:[a-z0-9]+:(?:(?:[A-Za-z0-9._-]|${PCT_ENCODED})*:)*(?:[A-Za-z0-9._-]|${PCT_ENCODED})+`;
const DID_ONLY = new RegExp(`^${DID}$`);

/** DID Core v1.1, section 3.2: `did-url`. */
const DID_URL = new RegExp(`^${DID}${PATH_ABEMPTY}${QUERY_AND_FRAGMENT}$`);

/** The scheme of a DID and a DID URL. */
const DID_SCHEME = /^did:/i;

/**
 * Returns true if the value conforms to the DID syntax of DID Core v1.1, section 3.1.
 * @param {string} value The value.
 * @returns {boolean} True if the value is a DID.
 */
export function isDid(value: string): boolean {
  return DID_ONLY.test(value);
}

/**
 * Returns true if the value conforms to the DID URL syntax of DID Core v1.1, section 3.2. A
 * DID is also a DID URL.
 * @param {string} value The value.
 * @returns {boolean} True if the value is a DID URL.
 */
export function isDidUrl(value: string): boolean {
  return DID_URL.test(value);
}

/**
 * Returns true if the value starts with the `did` scheme. The syntax of a URI in the `did`
 * scheme is the DID URL syntax, so such a value must be a DID URL.
 * @param {string} value The value.
 * @returns {boolean} True if the value starts with `did:`.
 */
export function hasDidScheme(value: string): boolean {
  return DID_SCHEME.test(value);
}

/**
 * Returns true if the value starts with a scheme: it is not a relative reference.
 * @param {string} value The value.
 * @returns {boolean} True if the value starts with an RFC 3986 scheme and a colon.
 */
export function hasScheme(value: string): boolean {
  return SCHEME_PREFIX.test(value);
}

/**
 * Returns true if the value is an RFC 3986 `URI`: a scheme, a colon, and the other parts.
 * @param {string} value The value.
 * @returns {boolean} True if the value is a URI.
 */
export function isUri(value: string): boolean {
  return URI.test(value);
}

/**
 * Returns true if the value is an RFC 3986 `relative-ref`: a reference with no scheme.
 * @param {string} value The value.
 * @returns {boolean} True if the value is a relative reference.
 */
export function isRelativeReference(value: string): boolean {
  return RELATIVE_REF.test(value);
}

/**
 * Returns true if the URL parser of the URL Standard parses the value with no base URL.
 * @param {string} value The value.
 * @returns {boolean} True if the value is an absolute URL.
 */
export function isUrl(value: string): boolean {
  return URL.canParse(value);
}
