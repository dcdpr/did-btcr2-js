import { DateUtils } from '@did-btcr2/std';
import { base58btc } from 'multiformats/bases/base58';

/**
 * Internal checks of the cryptosuite. This module is not exported from the package index.
 */

/** A member of a proof that breaks a rule, and the text of the rule. */
export type ProofProblem = {
  /** The name of the member. */
  member: string;
  /** The rule, for example `a string`. */
  rule: string;
};

/**
 * Returns true if the value is a map (a JSON object): an object that is not null and not an array.
 * @param {unknown} value The value to check.
 * @returns {boolean} True if the value is a map.
 */
export function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The ASCII URL code points of the URL Standard, with no `-` (it goes last in a class). */
const ASCII_URL_CODE_POINTS = '!$&\'()*+,./:;=?@_~';

/**
 * The URL code points from U+00A0 to U+10FFFD, with no surrogates and no noncharacters.
 */
const NON_ASCII_URL_CODE_POINTS = '\\u{A0}-\\u{D7FF}\\u{E000}-\\u{FDCF}\\u{FDF0}-\\u{FFFD}'
  + Array.from({ length: 16 }, (_, i) => {
    const plane = (i + 1).toString(16).toUpperCase();
    return `\\u{${plane}0000}-\\u{${plane}FFFD}`;
  }).join('');

/**
 * The regular expression source of one URL unit (a URL code point or a percent-encoded byte),
 * with no ASCII code point of `exclude`.
 * @param {string} exclude The ASCII code points that the unit must not be.
 * @returns {string} The regular expression source.
 */
function urlUnit(exclude: string = ''): string {
  const ascii = [...ASCII_URL_CODE_POINTS].filter(c => !exclude.includes(c)).join('');
  return `(?:[A-Za-z0-9${ascii}${NON_ASCII_URL_CODE_POINTS}-]|%[0-9A-Fa-f]{2})`;
}

/** A URL-query string or a URL-fragment string: zero or more URL units. */
const URL_UNITS = new RegExp(`^${urlUnit()}*$`, 'u');

/** A path-absolute-URL string (the query is already removed). */
const PATH_ABSOLUTE = new RegExp(`^/${urlUnit('?')}*$`, 'u');

/** A path-absolute-non-authority-URL string: a path-absolute-URL string that does not start with `//`. */
const PATH_ABSOLUTE_NON_AUTHORITY = new RegExp(`^/(?!/)${urlUnit('?')}*$`, 'u');

/**
 * A path-relative-URL string, which is also the form of an opaque-path-URL string: URL units with
 * no `?`, and no `/` at the start.
 */
const PATH_RELATIVE = new RegExp(`^(?!/)${urlUnit('?')}*$`, 'u');

/** A URL-scheme string followed by `:`. */
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/** A valid opaque-host string that is not an IPv6 address: URL units with no forbidden host code point. */
const OPAQUE_HOST = new RegExp(`^${urlUnit('/:?@')}+$`, 'u');

/** The special schemes of the URL Standard, other than `file`. */
const SPECIAL_SCHEMES = ['ftp', 'http', 'https', 'ws', 'wss'];

/**
 * Returns true if the value is a URL-port string: empty, or ASCII digits of a 16-bit unsigned integer.
 * @param {string} port The text after the `:`.
 * @returns {boolean} True for a URL-port string.
 */
function isPort(port: string): boolean {
  return /^[0-9]*$/.test(port) && (port === '' || Number(port) <= 65_535);
}

/**
 * Returns true if the URL parser accepts the host. The check does not apply the IDNA rules of a
 * valid domain string, so for example `a_b` passes.
 * @param {string} host The host text.
 * @returns {boolean} True if the URL parser accepts the host.
 */
function parserAcceptsHost(host: string): boolean {
  try {
    new URL(`http://${host}/`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true if the text is a valid host string of a special scheme: an IPv6 address in square
 * brackets, or URL units with no forbidden host code point. The URL parser must accept it too.
 * @param {string} host The host text.
 * @returns {boolean} True for a valid host string.
 */
function isHost(host: string): boolean {
  return (/^\[[0-9A-Fa-f:.]+\]$/.test(host) || OPAQUE_HOST.test(host)) && parserAcceptsHost(host);
}

/**
 * Returns true if the text is a valid opaque-host string: an IPv6 address in square brackets,
 * or URL units with no forbidden host code point.
 * @param {string} host The host text.
 * @returns {boolean} True for a valid opaque-host string.
 */
function isOpaqueHost(host: string): boolean {
  return /^\[[0-9A-Fa-f:.]+\]$/.test(host) ? parserAcceptsHost(host) : OPAQUE_HOST.test(host);
}

/**
 * Split the text after `//` into the authority and the path.
 * @param {string} text The text after `//`, with no query.
 * @returns {{ host: string; port?: string; path: string }} The host, the port text after `:`, and the path.
 */
function splitAuthority(text: string): { host: string; port?: string; path: string } {
  const slash = text.indexOf('/');
  const authority = slash === -1 ? text : text.slice(0, slash);
  const path = slash === -1 ? '' : text.slice(slash);
  const end = authority.startsWith('[') ? authority.indexOf(']') + 1 : 0;
  const colon = authority.indexOf(':', end);
  return colon === -1
    ? { host: authority, path }
    : { host: authority.slice(0, colon), port: authority.slice(colon + 1), path };
}

/**
 * Returns true if the text is a scheme-relative-special-URL string: `//`, a valid host string,
 * an optional port, and an optional path-absolute-URL string.
 * @param {string} text The text, with no query.
 * @returns {boolean} True for a scheme-relative-special-URL string.
 */
function isSchemeRelativeSpecial(text: string): boolean {
  if(!text.startsWith('//')) return false;
  const { host, port, path } = splitAuthority(text.slice(2));
  return isHost(host) && (port === undefined || isPort(port)) && (path === '' || PATH_ABSOLUTE.test(path));
}

/**
 * Returns true if the text is a scheme-relative-URL string: `//`, an optional opaque host and
 * port, and an optional path-absolute-URL string.
 * @param {string} text The text, with no query.
 * @returns {boolean} True for a scheme-relative-URL string.
 */
function isSchemeRelative(text: string): boolean {
  if(!text.startsWith('//')) return false;
  const { host, port, path } = splitAuthority(text.slice(2));
  const hostAndPort = host === '' ? port === undefined : isOpaqueHost(host) && (port === undefined || isPort(port));
  return hostAndPort && (path === '' || PATH_ABSOLUTE.test(path));
}

/**
 * Returns true if the text is a scheme-relative-file-URL string: `//`, then an optional valid
 * host string, then an optional path-absolute-URL string. A file URL has no port.
 * @param {string} text The text, with no query.
 * @returns {boolean} True for a scheme-relative-file-URL string.
 */
function isSchemeRelativeFile(text: string): boolean {
  if(!text.startsWith('//')) return false;
  const { host, port, path } = splitAuthority(text.slice(2));
  return (host === '' || isHost(host)) && port === undefined && (path === '' || PATH_ABSOLUTE.test(path));
}

/**
 * Returns true if the value is a valid URL string of the
 * {@link https://url.spec.whatwg.org/#valid-url-string | URL Standard}: a
 * relative-URL-with-fragment string or an absolute-URL-with-fragment string. VC Data Integrity
 * says that a proof `id` "MUST be a URL [URL]", and [URL] is the URL Standard.
 *
 * A relative URL string is valid if it is valid for one kind of base URL (special, file, or other).
 * Thus `#key-0`, `proof-1`, and the empty string are valid. For the host of a special scheme,
 * the check uses the URL parser and not the IDNA rules of a valid domain string.
 * @param {unknown} value The value to check.
 * @returns {boolean} True if the value is a valid URL string.
 */
export function isValidUrlString(value: unknown): boolean {
  if(typeof value !== 'string') return false;
  const hash = value.indexOf('#');
  if(hash !== -1 && !URL_UNITS.test(value.slice(hash + 1))) return false;
  const withQuery = hash === -1 ? value : value.slice(0, hash);
  const question = withQuery.indexOf('?');
  if(question !== -1 && !URL_UNITS.test(withQuery.slice(question + 1))) return false;
  const text = question === -1 ? withQuery : withQuery.slice(0, question);

  const scheme = SCHEME.exec(text);
  if(scheme) {
    const name = scheme[1].toLowerCase();
    const rest = text.slice(scheme[0].length);
    if(SPECIAL_SCHEMES.includes(name)) return isSchemeRelativeSpecial(rest);
    if(name === 'file') return isSchemeRelativeFile(rest);
    return isSchemeRelative(rest) || PATH_ABSOLUTE_NON_AUTHORITY.test(rest) || PATH_RELATIVE.test(rest);
  }
  return PATH_ABSOLUTE_NON_AUTHORITY.test(text)
    || PATH_RELATIVE.test(text)
    || isSchemeRelativeSpecial(text)
    || isSchemeRelativeFile(text)
    || isSchemeRelative(text);
}

/**
 * Returns true if two JSON values are equal: the same primitive, or arrays and maps with equal
 * members. The order of map members does not matter.
 * @param {unknown} a The first value.
 * @param {unknown} b The second value.
 * @returns {boolean} True if the values are equal.
 */
function sameJson(a: unknown, b: unknown): boolean {
  if(a === b) return true;
  if(Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, i) => sameJson(item, b[i]));
  }
  if(isMap(a) && isMap(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length
      && keys.every(key => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
  }
  return false;
}

/**
 * Verify Proof step 4.1: returns true if the document `@context` starts with all values of the
 * proof `@context`, in the same order. A string `@context` is a list of one value.
 * @param {unknown} documentContext The `@context` of the secured document.
 * @param {unknown} proofContext The `@context` of the proof.
 * @returns {boolean} True if the document `@context` starts with the proof `@context`.
 */
export function contextStartsWith(documentContext: unknown, proofContext: unknown): boolean {
  if(documentContext === undefined) return false;
  const documentValues = Array.isArray(documentContext) ? documentContext : [documentContext];
  const proofValues = Array.isArray(proofContext) ? proofContext : [proofContext];
  return proofValues.length <= documentValues.length
    && proofValues.every((value, i) => sameJson(value, documentValues[i]));
}

/** A rule for one member of a proof. */
type MemberRule = {
  member: string;
  required: boolean;
  rule: string;
  check: (value: unknown) => boolean;
};

const isString = (value: unknown): boolean => typeof value === 'string';
const isStringOrStrings = (value: unknown): boolean =>
  isString(value) || (Array.isArray(value) && value.every(isString));
const isStringOrStringSet = (value: unknown): boolean =>
  isStringOrStrings(value) && (!Array.isArray(value) || new Set(value).size === value.length);

/** The rules of VC Data Integrity, Proofs, that a proof creator and a proof verifier share. */
const SHARED_RULES: MemberRule[] = [
  { member: 'type', required: true, rule: 'a string', check: isString },
  { member: 'cryptosuite', required: true, rule: 'a string', check: isString },
  { member: 'verificationMethod', required: true, rule: 'a string', check: isString },
  { member: 'proofPurpose', required: true, rule: 'a string', check: isString },
  { member: 'id', required: false, rule: 'a valid URL string', check: isValidUrlString },
];

/** The rules after the `domain` rule, for both sides. */
const LAST_RULES: MemberRule[] = [
  { member: 'challenge', required: false, rule: 'a string', check: isString },
  { member: 'nonce', required: false, rule: 'a string', check: isString },
  { member: 'previousProof', required: false, rule: 'a string or an array of strings', check: isStringOrStrings },
];

/**
 * The rules of a proof creator. VC Data Integrity: `created` and `expires` "MUST be specified as
 * an [XMLSCHEMA11-2] dateTimeStamp string", and `domain` "MUST be either a string, or an unordered
 * set of strings". A creator writes a set, so a `domain` array must not have a repeated string.
 */
const CREATOR_RULES: MemberRule[] = [
  ...SHARED_RULES,
  { member: 'created', required: false, rule: 'an XML Schema dateTimeStamp', check: DateUtils.isValidXsdDateTimeStamp },
  { member: 'expires', required: false, rule: 'an XML Schema dateTimeStamp', check: DateUtils.isValidXsdDateTimeStamp },
  { member: 'domain', required: false, rule: 'a string or an array of strings with no repeated string', check: isStringOrStringSet },
  ...LAST_RULES,
];

/**
 * The rules of a proof verifier. VC Data Integrity: "A conforming processor MAY chose to consume
 * time values that were incorrectly serialized without an offset", so `expires` needs only an XML
 * Schema `dateTime`. The Proof Configuration algorithm checks `created`. A verifier reads a
 * `domain` array as a set, so a repeated string is valid.
 */
const VERIFIER_RULES: MemberRule[] = [
  ...SHARED_RULES,
  { member: 'expires', required: false, rule: 'an XML Schema dateTime', check: DateUtils.isValidXsdDateTime },
  { member: 'domain', required: false, rule: 'a string or an array of strings', check: isStringOrStrings },
  ...LAST_RULES,
];

/**
 * Returns the first member that breaks a rule, or `undefined`. An absent member (`undefined`)
 * breaks only a required rule.
 * @param {Record<string, unknown>} proof The proof options.
 * @param {MemberRule[]} rules The rules.
 * @returns {ProofProblem | undefined} The first problem, or `undefined`.
 */
function firstProblem(proof: Record<string, unknown>, rules: MemberRule[]): ProofProblem | undefined {
  for(const { member, required, rule, check } of rules) {
    const value = proof[member];
    if(value === undefined ? required : !check(value)) return { member, rule };
  }
  return undefined;
}

/**
 * The checks of a proof creator: the members of VC Data Integrity, Proofs, that this suite reads
 * or that the data model types.
 * @param {Record<string, unknown>} proof The proof options.
 * @returns {ProofProblem | undefined} The first problem, or `undefined`.
 */
export function proofOptionsProblem(proof: Record<string, unknown>): ProofProblem | undefined {
  return firstProblem(proof, CREATOR_RULES);
}

/**
 * The checks of a proof verifier: as {@link proofOptionsProblem}, but `expires` needs only an XML
 * Schema `dateTime`, a `domain` array can have a repeated string, and the Proof Configuration
 * algorithm checks `created`.
 * @param {Record<string, unknown>} proof The proof options of a secured document.
 * @returns {ProofProblem | undefined} The first problem, or `undefined`.
 */
export function securedProofProblem(proof: Record<string, unknown>): ProofProblem | undefined {
  return firstProblem(proof, VERIFIER_RULES);
}

/**
 * Decode a `proofValue`: the base58btc Multibase text (header `z`) of a 64-byte BIP340 signature.
 * The text must be the canonical base58btc text of the bytes: the decoder also reads some other
 * texts, for example with a character above U+00FF.
 * @param {unknown} value The `proofValue`.
 * @returns {Uint8Array | undefined} The 64 signature bytes, or `undefined`.
 */
export function decodeProofValue(value: unknown): Uint8Array | undefined {
  if(typeof value !== 'string' || !value.startsWith('z')) return undefined;
  let bytes: Uint8Array;
  try {
    bytes = base58btc.decode(value);
  } catch {
    return undefined;
  }
  return bytes.length === 64 && base58btc.encode(bytes) === value ? bytes : undefined;
}
