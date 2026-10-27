import { FEATURE_NOT_SUPPORTED, INVALID_OPTIONS, ResolveError } from '@did-btcr2/common';
import { gotValue } from '../utils/message-text.js';
import type { ResolutionOptions } from './interfaces.js';

/**
 * The names of the resolution options that the resolver supports. DID Resolution v1 defines
 * `accept`, `expandRelativeUrls`, `noCache`, `versionId`, and `versionTime`. The did:btcr2
 * specification defines `minConf` and `sidecar`. `maxDiscoveryRounds` is an option of this
 * implementation.
 */
export const RESOLUTION_OPTION_NAMES: ReadonlySet<string> = new Set([
  'accept',
  'expandRelativeUrls',
  'noCache',
  'versionId',
  'versionTime',
  'minConf',
  'sidecar',
  'maxDiscoveryRounds'
]);

/** RFC 9110, section 5.6.2: `token`. */
const TOKEN = '[!#$%&\'*+.^_`|~0-9A-Za-z-]+';

/** RFC 9110, section 5.6.4: `quoted-string`. `obs-text` is the range %x80-FF. */
const QUOTED_STRING = '"(?:[\\t \\x21\\x23-\\x5B\\x5D-\\x7E\\x80-\\xFF]|\\\\[\\t \\x21-\\x7E\\x80-\\xFF])*"';

/** RFC 9110, section 12.4.2: `qvalue`. */
const QVALUE = '(?:0(?:\\.[0-9]{0,3})?|1(?:\\.0{0,3})?)';

/**
 * RFC 9110, section 5.6.6: `parameter`. A parameter with the name "q" is the `weight` of section
 * 12.4.2, so its value must be a `qvalue`. Section 12.5.1: the media type registry disallows a
 * parameter with the name "q".
 */
const PARAMETER = `(?:[Qq]=${QVALUE}|(?![Qq]=)${TOKEN}=(?:${TOKEN}|${QUOTED_STRING}))`;

/**
 * RFC 9110, section 12.5.1: `media-range` and its parameters. The whitespace before a ";" goes
 * with the ";", so each value has one parse and the match time stays linear.
 */
const MEDIA_RANGE = `${TOKEN}/${TOKEN}(?:[ \\t]*;(?:[ \\t]*${PARAMETER})?)*`;

/**
 * RFC 9110, section 12.5.1: `Accept`, a list (section 5.6.1.2) of media ranges. A recipient
 * accepts an empty list element. Whitespace after the last ";" or "," is `OWS`.
 */
const ACCEPT = new RegExp(`^(?:${MEDIA_RANGE})?(?:[ \\t]*,(?:[ \\t]*${MEDIA_RANGE})?)*(?:(?<=[;,])[ \\t]+)?$`);

/**
 * Returns true if the value conforms to the Accept header grammar of RFC 9110, section 12.5.1.
 * @param {string} value The value.
 * @returns {boolean} True if the value is an Accept header value.
 */
export function isAcceptValue(value: string): boolean {
  return ACCEPT.test(value);
}

/**
 * Returns the error for a resolution option value that is not valid.
 * @param {string} name The name of the option.
 * @param {string} expected The text of the valid values.
 * @param {unknown} value The value that the caller gave.
 * @returns {ResolveError} A `ResolveError` of type `INVALID_OPTIONS`.
 */
function invalidOption(name: string, expected: string, value: unknown): ResolveError {
  return new ResolveError(
    `Invalid resolution option ${name}: expected ${expected}${gotValue(value)}.`,
    INVALID_OPTIONS, { [name]: value }
  );
}

/**
 * Checks the resolution options in the order of DID Resolution v1, section 4.4. Step 3: an
 * option that the resolver does not support fails with `FEATURE_NOT_SUPPORTED`. Step 4: an
 * option value that is not valid fails with `INVALID_OPTIONS`. An option with the value
 * `undefined` is absent. The {@link Resolver} constructor checks the values of `versionId`,
 * `versionTime`, and `minConf`.
 * @param {unknown} options The resolution options.
 * @throws {ResolveError} `INVALID_OPTIONS` if the options are not an object.
 * @throws {ResolveError} `FEATURE_NOT_SUPPORTED` for an option name that is not in
 * {@link RESOLUTION_OPTION_NAMES}, or for `expandRelativeUrls` with the value `true`.
 * @throws {ResolveError} `INVALID_OPTIONS` for an option value of the wrong type or form.
 */
export function checkResolutionOptions(options: unknown): asserts options is ResolutionOptions {
  // DID Resolution v1, section 4.1: the resolution options are a metadata structure, a map.
  if(typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new ResolveError(
      'Invalid resolution options: expected an object.',
      INVALID_OPTIONS, { resolutionOptions: options }
    );
  }

  // Step 3: each option name must be supported.
  for(const [name, value] of Object.entries(options)) {
    if(value !== undefined && !RESOLUTION_OPTION_NAMES.has(name)) {
      throw new ResolveError(
        `The resolver does not support the resolution option ${JSON.stringify(name)}.`,
        FEATURE_NOT_SUPPORTED, { option: name }
      );
    }
  }

  // Step 3: the resolver does not expand relative DID URLs (step 6).
  const { accept, expandRelativeUrls, noCache, sidecar, maxDiscoveryRounds } = options as Record<string, unknown>;
  if(expandRelativeUrls === true) {
    throw new ResolveError(
      'The resolver does not support the resolution option "expandRelativeUrls" with the value true. '
      + 'It returns the relative DID URLs of the DID document unchanged.',
      FEATURE_NOT_SUPPORTED, { option: 'expandRelativeUrls' }
    );
  }

  // Step 4: each option value must be valid.
  if(accept !== undefined && (typeof accept !== 'string' || !isAcceptValue(accept))) {
    throw invalidOption('accept', 'an Accept header value (RFC 9110, section 12.5.1)', accept);
  }
  if(expandRelativeUrls !== undefined && expandRelativeUrls !== false) {
    throw invalidOption('expandRelativeUrls', 'a boolean', expandRelativeUrls);
  }
  if(noCache !== undefined && ![true, false, 'true', 'false'].includes(noCache as boolean | string)) {
    throw invalidOption('noCache', 'true, false, "true", or "false"', noCache);
  }
  if(sidecar !== undefined && (typeof sidecar !== 'object' || sidecar === null || Array.isArray(sidecar))) {
    throw invalidOption('sidecar', 'an object', sidecar);
  }
  if(maxDiscoveryRounds !== undefined && typeof maxDiscoveryRounds !== 'number') {
    throw invalidOption('maxDiscoveryRounds', 'a number', maxDiscoveryRounds);
  }
}
