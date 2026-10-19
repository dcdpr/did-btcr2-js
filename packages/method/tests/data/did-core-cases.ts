/**
 * Changes to a valid DID document, for the DID Core v1.1 member rules of
 * `src/utils/did-core-conformance.ts`. Each change works on a DID document and on a Genesis
 * Document: it reads ids from the document, so the result keeps the id of the input.
 *
 * `ACCEPT_CASES` pass on every path. `REFUSAL_CASES` fail on every path. `PRODUCER_REFUSAL_CASES`
 * pass on the read path (a consumer) and fail on the write and create paths (a producer).
 *
 * Each document has `verificationMethod`, the four relationships of the KEY template, and a
 * `service` array. Each relationship holds a reference to the first method.
 */

/** A change to a copy of a valid document. */
export type DocumentChange = (document: Record<string, any>) => void;

/** A change that gives a document that conforms. */
export interface AcceptCase {
  label: string;
  change: DocumentChange;
  /** True if the change adds an id with no placeholder. The create path refuses it (ADR 108). */
  placeholderFree?: true;
}

/** A change that breaks one rule: `member` and `message` are the parts of the error text. */
export interface RefusalCase {
  label: string;
  change: DocumentChange;
  member: string;
  message: string;
}

/** The fragment of a DID URL, with the `#`: the relative form of the URL. */
function relative(url: string): string {
  return url.slice(url.indexOf('#'));
}

/** A service that is not a beacon, with the given id. */
function linkedDomains(id: string): Record<string, unknown> {
  return { id, type: 'LinkedDomains', serviceEndpoint: 'https://a.example' };
}

/** A second verification method, `#key-2`, with the given members. */
function method2(document: Record<string, any>, members: Record<string, unknown>): Record<string, unknown> {
  return { id: `${document.id}#key-2`, type: 'Multikey', controller: document.id, ...members };
}

/** A public JSON Web Key. The key values are not checked. */
const PUBLIC_JWK = { kty: 'EC', crv: 'secp256k1', x: 'AQID', y: 'BAUG' };

/** A Multikey secp256k1 secret key (header 0x8126). */
const SECRET_MULTIKEY = 'z3vLU4prTt15eN56rAEJmygT97CowV96KMMTYtv9s1JxTvRV';

/** The JWK members of the "Private" information class in the IANA registry. */
const JWK_PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k', 'priv'];

const REPEAT = 'a set contains each item one time';
const STRING_OR_STRINGS = 'must be a string or an array of strings';
const METHOD_MAP = 'must be a map with a string id, type, and controller';
const RELATIONSHIP_ITEM = 'must be a string or a map with a string id, type, and controller';
const ENDPOINT = 'must be a string, a map, or an array of one or more strings and maps';
const MULTIBASE_HEADER = 'must be a string that starts with a Multibase header';
const JWK = 'must be a JSON Web Key: a map with a string kty';
const DATE_TIME_STAMP = 'must be an XML Schema dateTimeStamp: a date and a time with a timezone';
const DID_URL = 'must be a DID URL: the value has the "did" scheme';
const RELATIVE_DID_URL = 'must be a relative DID URL: an RFC 3986 relative reference';
const PUBLIC_DOCUMENT = 'must not be present: a DID document is public';
const SHARED_ID = 'each verification method and each service needs a different id';

export const ACCEPT_CASES: Array<AcceptCase> = [
  { label: 'the document with no change', change: () => {} },
  { label: 'controller: one DID', change: d => { d.controller = 'did:example:a'; } },
  { label: 'controller: an empty set', change: d => { d.controller = []; } },
  { label: 'controller: a set of two DIDs', change: d => { d.controller = ['did:example:a', 'did:example:b']; } },
  { label: 'controller: a URL', change: d => { d.controller = 'https://a.example/controller'; } },
  { label: 'alsoKnownAs: an empty set', change: d => { d.alsoKnownAs = []; } },
  { label: 'alsoKnownAs: a set of two URIs', change: d => { d.alsoKnownAs = ['https://a.example', 'https://b.example']; } },
  { label: 'alsoKnownAs: a URN, a DID, and an IPv6 host', change: d => { d.alsoKnownAs = ['urn:uuid:6e8bc430-9c3a-11d9-9669-0800200c9a66', 'did:example:a', 'https://[2001:db8::1]:8080/p']; } },
  { label: 'verificationMethod: an empty set', change: d => { d.verificationMethod = []; } },
  { label: 'verificationMethod: two methods', change: d => { d.verificationMethod.push({ ...d.verificationMethod[0], id: `${d.id}#key-2` }); } },
  { label: 'verificationMethod: a method with another DID as its controller', change: d => { d.verificationMethod.push(method2(d, { controller: 'did:example:a' })); } },
  { label: 'verificationMethod: a method with a relative id', change: d => { d.verificationMethod.push({ ...method2(d, {}), id: '#key-2' }); }, placeholderFree: true },
  { label: 'verificationMethod: a method with an https id', change: d => { d.verificationMethod.push({ ...method2(d, {}), id: 'https://a.example/keys#1' }); }, placeholderFree: true },
  { label: 'keyAgreement: one reference', change: d => { d.keyAgreement = [d.authentication[0]]; } },
  { label: 'authentication: a reference and an embedded method', change: d => { d.authentication.push({ ...d.verificationMethod[0], id: `${d.id}#key-2` }); } },
  { label: 'assertionMethod: two references to two methods', change: d => { d.assertionMethod.push(`${d.id}#key-2`); } },
  { label: 'assertionMethod: a fragment, a query, a path, and a path with no slash', change: d => { d.assertionMethod.push('#key-2', '?key=3', '/keys/4', 'keys/5'); } },
  { label: 'service: an empty set', change: d => { d.service = []; } },
  { label: 'service type: a set of two strings', change: d => { d.service[0].type = [d.service[0].type, 'Other']; } },
  { label: 'service type: an empty set', change: d => { d.service[0].type = []; } },
  { label: 'serviceEndpoint: a map', change: d => { d.service.push({ ...linkedDomains(`${d.id}#links`), serviceEndpoint: { origins: ['https://a.example'] } }); } },
  { label: 'serviceEndpoint: a set of a string and a map', change: d => { d.service.push({ ...linkedDomains(`${d.id}#links`), serviceEndpoint: ['https://a.example', { x: 1 }] }); } },
  { label: 'service: two services with two ids', change: d => { d.service.push(linkedDomains(`${d.id}#links`)); } },
  { label: 'service: a service with a relative id', change: d => { d.service.push(linkedDomains('#links')); }, placeholderFree: true },
  { label: 'a member that DID Core does not define', change: d => { d.extension = { x: 1 }; } },
  { label: 'publicKeyJwk: a public JSON Web Key', change: d => { d.verificationMethod.push(method2(d, { type: 'JsonWebKey', publicKeyJwk: PUBLIC_JWK })); } },
  { label: 'publicKeyMultibase: a "u" value', change: d => { d.verificationMethod.push(method2(d, { publicKeyMultibase: 'uAQID-_' })); } },
  { label: 'publicKeyMultibase: a "z" value with no bytes', change: d => { d.verificationMethod.push(method2(d, { publicKeyMultibase: 'z' })); } },
  { label: 'publicKeyMultibase: the "f" header of the multibase registry', change: d => { d.verificationMethod.push(method2(d, { publicKeyMultibase: 'f0102' })); } },
  { label: 'publicKeyMultibase: the two-unit header U+1F680', change: d => { d.verificationMethod.push(method2(d, { publicKeyMultibase: '\u{1F680}x' })); } },
  { label: 'publicKeyMultibase: a secret key header (no key header check)', change: d => { d.verificationMethod.push(method2(d, { publicKeyMultibase: SECRET_MULTIKEY })); } },
  {
    label  : 'expires and revoked: dateTimeStamp values',
    change : d => { d.verificationMethod.push(method2(d, { expires: '2030-01-01T00:00:00Z', revoked: '2030-01-01T00:00:00.5+01:00' })); }
  },
  { label: 'authentication: an embedded method with a public JSON Web Key', change: d => { d.authentication.push(method2(d, { type: 'JsonWebKey', publicKeyJwk: PUBLIC_JWK })); } },
];

export const REFUSAL_CASES: Array<RefusalCase> = [
  // Controlled Identifiers v1.0, 2.1.2 and 2.1.3.
  { label: 'controller: a number', change: d => { d.controller = 42; }, member: 'controller', message: `controller ${STRING_OR_STRINGS}` },
  { label: 'controller: null', change: d => { d.controller = null; }, member: 'controller', message: `controller ${STRING_OR_STRINGS}` },
  { label: 'controller: a set with a number', change: d => { d.controller = [42]; }, member: 'controller', message: `controller ${STRING_OR_STRINGS}` },
  { label: 'alsoKnownAs: one string', change: d => { d.alsoKnownAs = 'https://a.example'; }, member: 'alsoKnownAs', message: 'alsoKnownAs must be an array of strings' },
  { label: 'alsoKnownAs: null', change: d => { d.alsoKnownAs = null; }, member: 'alsoKnownAs', message: 'alsoKnownAs must be an array of strings' },
  { label: 'alsoKnownAs: a set with a number', change: d => { d.alsoKnownAs = [5]; }, member: 'alsoKnownAs', message: 'alsoKnownAs must be an array of strings' },

  // Controlled Identifiers v1.0, 2.2.
  { label: 'verificationMethod: a map', change: d => { d.verificationMethod = d.verificationMethod[0]; }, member: 'verificationMethod', message: 'verificationMethod must be an array' },
  { label: 'verificationMethod: a number', change: d => { d.verificationMethod.push(5); }, member: 'verificationMethod', message: `verificationMethod[1] ${METHOD_MAP}` },
  { label: 'verificationMethod: a method with no type', change: d => { delete d.verificationMethod[0].type; }, member: 'verificationMethod', message: `verificationMethod[0] ${METHOD_MAP}` },

  // DID Core v1.1, 3.1, 3.2, 3.2.1, and 5.2.
  ...['x', 'https://a.example', 'did:example:a#key-1', 'did:Example:a', 'did:example:'].map(controller => ({
    label   : `verificationMethod: the controller ${JSON.stringify(controller)}`,
    change  : (d: Record<string, any>) => { d.verificationMethod.push(method2(d, { controller })); },
    member  : 'verificationMethod',
    message : 'verificationMethod[1].controller must be a DID'
  })),
  ...['did:example:a#key 2', 'did:btcr2:#key-2', 'did:example:a:#key-2', 'DID:example:a#ké'].map(id => ({
    label   : `verificationMethod: the id ${JSON.stringify(id)}`,
    change  : (d: Record<string, any>) => { d.verificationMethod.push({ ...method2(d, {}), id }); },
    member  : 'verificationMethod',
    message : `verificationMethod[1].id ${DID_URL}`
  })),
  ...['#key 2', '#ké', 'key 2', 'a[1]'].map(id => ({
    label   : `verificationMethod: the relative id ${JSON.stringify(id)}`,
    change  : (d: Record<string, any>) => { d.verificationMethod.push({ ...method2(d, {}), id }); },
    member  : 'verificationMethod',
    message : `verificationMethod[1].id ${RELATIVE_DID_URL}`
  })),
  { label: 'authentication: a DID URL with a space', change: d => { d.authentication.push(`${d.id}#key 2`); }, member: 'authentication', message: `authentication[1] ${DID_URL}` },
  { label: 'keyAgreement: a relative reference with a space', change: d => { d.keyAgreement = ['#key 2']; }, member: 'keyAgreement', message: `keyAgreement[0] ${RELATIVE_DID_URL}` },
  {
    label   : 'capabilityDelegation: an embedded method with a URL as its controller',
    change  : d => { d.capabilityDelegation.push(method2(d, { controller: 'https://a.example' })); },
    member  : 'capabilityDelegation',
    message : 'capabilityDelegation[1].controller must be a DID'
  },

  // Controlled Identifiers v1.0, 2.2.1 to 2.2.3 and 2.4.
  {
    label   : 'verificationMethod: publicKeyMultibase and publicKeyJwk',
    change  : d => { d.verificationMethod.push(method2(d, { publicKeyMultibase: d.verificationMethod[0].publicKeyMultibase, publicKeyJwk: PUBLIC_JWK })); },
    member  : 'verificationMethod',
    message : 'verificationMethod[1] must not have both publicKeyMultibase and publicKeyJwk: they express the same key'
  },
  ...[42, null, '', 'x0102', 'Q0102', '1z'].map(value => ({
    label   : `publicKeyMultibase: ${JSON.stringify(value)}`,
    change  : (d: Record<string, any>) => { d.verificationMethod.push(method2(d, { publicKeyMultibase: value })); },
    member  : 'verificationMethod',
    message : `verificationMethod[1].publicKeyMultibase ${MULTIBASE_HEADER}`
  })),
  ...['z0OIl', 'zAB+', 'zé'].map(value => ({
    label   : `publicKeyMultibase: ${JSON.stringify(value)} (not base-58-btc)`,
    change  : (d: Record<string, any>) => { d.verificationMethod.push(method2(d, { publicKeyMultibase: value })); },
    member  : 'verificationMethod',
    message : 'verificationMethod[1].publicKeyMultibase must use only base-58-btc characters after the "z" header'
  })),
  ...['uAQ==', 'uAB+/', 'uA B'].map(value => ({
    label   : `publicKeyMultibase: ${JSON.stringify(value)} (not base-64-url-no-pad)`,
    change  : (d: Record<string, any>) => { d.verificationMethod.push(method2(d, { publicKeyMultibase: value })); },
    member  : 'verificationMethod',
    message : 'verificationMethod[1].publicKeyMultibase must use only base-64-url-no-pad characters after the "u" header'
  })),
  {
    label   : 'secretKeyMultibase: a value with no Multibase header',
    change  : d => { d.verificationMethod.push(method2(d, { secretKeyMultibase: 'a0102' })); },
    member  : 'verificationMethod',
    message : `verificationMethod[1].secretKeyMultibase ${MULTIBASE_HEADER}`
  },
  {
    label   : 'secretKeyMultibase: a "z" value with "0"',
    change  : d => { d.verificationMethod.push(method2(d, { secretKeyMultibase: 'z0' })); },
    member  : 'verificationMethod',
    message : 'verificationMethod[1].secretKeyMultibase must use only base-58-btc characters after the "z" header'
  },
  ...[null, 'AQID', [PUBLIC_JWK], { crv: 'secp256k1', x: 'AQID' }, { ...PUBLIC_JWK, kty: 1 }].map(value => ({
    label   : `publicKeyJwk: ${JSON.stringify(value)}`,
    change  : (d: Record<string, any>) => { d.verificationMethod.push(method2(d, { type: 'JsonWebKey', publicKeyJwk: value })); },
    member  : 'verificationMethod',
    message : `verificationMethod[1].publicKeyJwk ${JWK}`
  })),
  ...JWK_PRIVATE_MEMBERS.map(name => ({
    label   : `publicKeyJwk: the private member ${name}`,
    change  : (d: Record<string, any>) => { d.verificationMethod.push(method2(d, { type: 'JsonWebKey', publicKeyJwk: { ...PUBLIC_JWK, [name]: 'AQID' } })); },
    member  : 'verificationMethod',
    message : `verificationMethod[1].publicKeyJwk.${name} must not be present: a public key has no private member`
  })),
  {
    label   : 'secretKeyJwk: a secret JSON Web Key',
    change  : d => { d.verificationMethod.push(method2(d, { type: 'JsonWebKey', publicKeyJwk: PUBLIC_JWK, secretKeyJwk: { ...PUBLIC_JWK, d: 'AQID' } })); },
    member  : 'verificationMethod',
    message : 'verificationMethod[1].secretKeyJwk must not be present: a DID document is public'
  },
  ...['2030-01-01T00:00:00', '2030-01-01', '2030-02-30T00:00:00Z', 1893456000, null].map(value => ({
    label   : `expires: ${JSON.stringify(value)}`,
    change  : (d: Record<string, any>) => { d.verificationMethod.push(method2(d, { expires: value })); },
    member  : 'verificationMethod',
    message : `verificationMethod[1].expires ${DATE_TIME_STAMP}`
  })),
  {
    label   : 'revoked: no timezone',
    change  : d => { d.verificationMethod.push(method2(d, { revoked: '2030-01-01T00:00:00' })); },
    member  : 'verificationMethod',
    message : `verificationMethod[1].revoked ${DATE_TIME_STAMP}`
  },
  {
    label   : 'verificationMethod: the first method breaks a material rule',
    change  : d => { d.verificationMethod[0].revoked = 'yesterday'; },
    member  : 'verificationMethod',
    message : `verificationMethod[0].revoked ${DATE_TIME_STAMP}`
  },

  // Controlled Identifiers v1.0, 2.3.
  { label: 'authentication: an empty set', change: d => { d.authentication = []; }, member: 'authentication', message: 'authentication must be an array of one or more items' },
  { label: 'keyAgreement: an empty set', change: d => { d.keyAgreement = []; }, member: 'keyAgreement', message: 'keyAgreement must be an array of one or more items' },
  { label: 'keyAgreement: null', change: d => { d.keyAgreement = null; }, member: 'keyAgreement', message: 'keyAgreement must be an array of one or more items' },
  { label: 'keyAgreement: one reference, not in a set', change: d => { d.keyAgreement = d.authentication[0]; }, member: 'keyAgreement', message: 'keyAgreement must be an array of one or more items' },
  { label: 'assertionMethod: a number', change: d => { d.assertionMethod.push(5); }, member: 'assertionMethod', message: `assertionMethod[1] ${RELATIONSHIP_ITEM}` },
  {
    label   : 'capabilityDelegation: an embedded method with no controller',
    change  : d => { d.capabilityDelegation.push({ id: `${d.id}#key-2`, type: 'Multikey' }); },
    member  : 'capabilityDelegation',
    message : `capabilityDelegation[1] ${RELATIONSHIP_ITEM}`
  },
  {
    label   : 'authentication: an embedded method with a private JWK member',
    change  : d => { d.authentication.push(method2(d, { type: 'JsonWebKey', publicKeyJwk: { ...PUBLIC_JWK, d: 'AQID' } })); },
    member  : 'authentication',
    message : 'authentication[1].publicKeyJwk.d must not be present: a public key has no private member'
  },
  {
    label   : 'keyAgreement: an embedded method with secretKeyJwk',
    change  : d => { d.keyAgreement = [method2(d, { type: 'JsonWebKey', secretKeyJwk: { ...PUBLIC_JWK, d: 'AQID' } })]; },
    member  : 'keyAgreement',
    message : 'keyAgreement[0].secretKeyJwk must not be present: a DID document is public'
  },
  {
    label   : 'capabilityInvocation: an embedded method with publicKeyMultibase 42',
    change  : d => { d.capabilityInvocation.push(method2(d, { publicKeyMultibase: 42 })); },
    member  : 'capabilityInvocation',
    message : `capabilityInvocation[1].publicKeyMultibase ${MULTIBASE_HEADER}`
  },

  // Controlled Identifiers v1.0, 2.1.4.
  { label: 'service: a map', change: d => { d.service = d.service[0]; }, member: 'service', message: 'service must be an array' },
  { label: 'service: a number', change: d => { d.service[0] = 5; }, member: 'service', message: 'service[0] must be a map' },
  { label: 'service: no id', change: d => { delete d.service[0].id; }, member: 'service', message: 'service[0].id must be a string' },
  ...[5, null, { x: 1 }, ['did:btcr2:_']].map(id => ({
    label   : `service id: ${JSON.stringify(id)}`,
    change  : (d: Record<string, any>) => { d.service[0].id = id; },
    member  : 'service',
    message : 'service[0].id must be a string'
  })),
  { label: 'service: no type', change: d => { delete d.service[0].type; }, member: 'service', message: `service[0].type ${STRING_OR_STRINGS}` },
  { label: 'service type: a number', change: d => { d.service[0].type = 42; }, member: 'service', message: `service[0].type ${STRING_OR_STRINGS}` },
  { label: 'service type: a set with a number', change: d => { d.service[0].type = [1]; }, member: 'service', message: `service[0].type ${STRING_OR_STRINGS}` },
  { label: 'service: no serviceEndpoint', change: d => { delete d.service[0].serviceEndpoint; }, member: 'service', message: `service[0].serviceEndpoint ${ENDPOINT}` },
  { label: 'serviceEndpoint: a number', change: d => { d.service[0].serviceEndpoint = 42; }, member: 'service', message: `service[0].serviceEndpoint ${ENDPOINT}` },
  { label: 'serviceEndpoint: an empty set', change: d => { d.service[0].serviceEndpoint = []; }, member: 'service', message: `service[0].serviceEndpoint ${ENDPOINT}` },
  { label: 'serviceEndpoint: a set with a number', change: d => { d.service[0].serviceEndpoint = [5]; }, member: 'service', message: `service[0].serviceEndpoint ${ENDPOINT}` },
  {
    label   : 'service: two services with one id',
    change  : d => { d.service = [d.service[0], linkedDomains(d.service[0].id)]; },
    member  : 'service',
    message : 'service[1].id is the id of service[0]: each service needs a different id'
  },
  {
    label   : 'service: the absolute and the relative form of one id',
    change  : d => { d.service = [d.service[0], linkedDomains(relative(d.service[0].id))]; },
    member  : 'service',
    message : 'service[1].id is the id of service[0]: each service needs a different id'
  },
];

export const PRODUCER_REFUSAL_CASES: Array<RefusalCase> = [
  // DID Core v1.1, 4, 6.2.1, and 6.2.2: a consumer adds each item to the set, and the set
  // ignores an item that it contains. A producer writes each item of the set one time.
  { label: 'controller: one DID two times', change: d => { d.controller = ['did:example:a', 'did:example:a']; }, member: 'controller', message: `controller[1] repeats controller[0]: ${REPEAT}` },
  { label: 'alsoKnownAs: one URI two times', change: d => { d.alsoKnownAs = ['https://a.example', 'https://a.example']; }, member: 'alsoKnownAs', message: `alsoKnownAs[1] repeats alsoKnownAs[0]: ${REPEAT}` },
  { label: 'verificationMethod: one method two times', change: d => { d.verificationMethod.push({ ...d.verificationMethod[0] }); }, member: 'verificationMethod', message: `verificationMethod[1] repeats verificationMethod[0]: ${REPEAT}` },
  {
    label   : 'verificationMethod: one method two times, with another member order',
    change  : d => { d.verificationMethod.push(Object.fromEntries(Object.entries(d.verificationMethod[0]).reverse())); },
    member  : 'verificationMethod',
    message : `verificationMethod[1] repeats verificationMethod[0]: ${REPEAT}`
  },
  { label: 'assertionMethod: one reference two times', change: d => { d.assertionMethod.push(d.assertionMethod[0]); }, member: 'assertionMethod', message: `assertionMethod[1] repeats assertionMethod[0]: ${REPEAT}` },
  {
    label   : 'capabilityInvocation: the absolute and the relative reference to one method',
    change  : d => { d.capabilityInvocation.push(relative(d.capabilityInvocation[0])); },
    member  : 'capabilityInvocation',
    message : `capabilityInvocation[1] repeats capabilityInvocation[0]: ${REPEAT}`
  },
  {
    label   : 'keyAgreement: one embedded method two times',
    change  : d => { d.keyAgreement = [{ ...d.verificationMethod[0] }, { ...d.verificationMethod[0] }]; },
    member  : 'keyAgreement',
    message : `keyAgreement[1] repeats keyAgreement[0]: ${REPEAT}`
  },
  { label: 'service type: one type two times', change: d => { d.service[0].type = ['A', 'A']; }, member: 'service', message: `service[0].type[1] repeats service[0].type[0]: ${REPEAT}` },
  {
    label   : 'serviceEndpoint: one string two times',
    change  : d => { d.service = [{ ...linkedDomains(`${d.id}#links`), serviceEndpoint: ['https://a.example', 'https://a.example'] }]; },
    member  : 'service',
    message : `service[0].serviceEndpoint[1] repeats service[0].serviceEndpoint[0]: ${REPEAT}`
  },
  {
    label   : 'serviceEndpoint: one map two times',
    change  : d => { d.service = [{ ...linkedDomains(`${d.id}#links`), serviceEndpoint: [{ x: 1, y: 2 }, { y: 2, x: 1 }] }]; },
    member  : 'service',
    message : `service[0].serviceEndpoint[1] repeats service[0].serviceEndpoint[0]: ${REPEAT}`
  },

  // Controlled Identifiers v1.0, 2.2.2: do not publish a secret key.
  {
    label   : 'secretKeyMultibase: a Multikey secret key, with publicKeyMultibase',
    change  : d => { d.verificationMethod.push(method2(d, { publicKeyMultibase: d.verificationMethod[0].publicKeyMultibase, secretKeyMultibase: SECRET_MULTIKEY })); },
    member  : 'verificationMethod',
    message : `verificationMethod[1].secretKeyMultibase ${PUBLIC_DOCUMENT}`
  },

  // Controlled Identifiers v1.0, 2.1.2 to 2.1.4; DID Core v1.1, 5.1.2, 5.1.3, and 5.4.
  { label: 'controller: a string that is not a URL', change: d => { d.controller = 'a b'; }, member: 'controller', message: 'controller must be a DID or a URL' },
  { label: 'controller: a relative URL', change: d => { d.controller = ['did:example:a', '#a']; }, member: 'controller', message: 'controller[1] must be a DID or a URL' },
  { label: 'controller: a DID URL', change: d => { d.controller = ['did:example:a#key-1']; }, member: 'controller', message: 'controller[0] must be a DID' },
  { label: 'alsoKnownAs: a host name with no scheme', change: d => { d.alsoKnownAs = ['a.example']; }, member: 'alsoKnownAs', message: 'alsoKnownAs[0] must be a URI' },
  { label: 'alsoKnownAs: a URL with a non-ASCII host', change: d => { d.alsoKnownAs = ['https://a.example', 'https://bücher.example']; }, member: 'alsoKnownAs', message: 'alsoKnownAs[1] must be a URI' },
  ...([
    ['did:example:a#links 1', DID_URL],
    ['links 1', RELATIVE_DID_URL],
    ['https://a b.example/#links', 'must be a URL'],
  ] as const).map(([id, rule]) => ({
    label   : `service id: ${JSON.stringify(id)}`,
    change  : (d: Record<string, any>) => { d.service = [linkedDomains(id)]; },
    member  : 'service',
    message : `service[0].id ${rule}`
  })),
  {
    label   : 'serviceEndpoint: a host name with no scheme',
    change  : d => { d.service = [{ ...linkedDomains(`${d.id}#links`), serviceEndpoint: 'a.example' }]; },
    member  : 'service',
    message : 'service[0].serviceEndpoint must be a URL'
  },
  {
    label   : 'serviceEndpoint: a set with a host name with no scheme',
    change  : d => { d.service = [{ ...linkedDomains(`${d.id}#links`), serviceEndpoint: ['https://a.example', { x: 1 }, 'a.example'] }]; },
    member  : 'service',
    message : 'service[0].serviceEndpoint[2] must be a URL'
  },
  {
    label   : 'verificationMethod: an id with another scheme that is not a URL',
    change  : d => { d.verificationMethod.push({ ...method2(d, {}), id: 'https://a b.example/#key-2' }); },
    member  : 'verificationMethod',
    message : 'verificationMethod[1].id must be a URL'
  },
  {
    label   : 'verificationMethod: a relative id with an authority that is not valid',
    change  : d => { d.verificationMethod.push({ ...method2(d, {}), id: '//a b/#key-2' }); },
    member  : 'verificationMethod',
    message : `verificationMethod[1].id ${RELATIVE_DID_URL}`
  },

  // Controlled Identifiers v1.0, 3.4: two fragments with one id are "to be avoided".
  {
    label   : 'verificationMethod: two methods with one id',
    change  : d => { d.verificationMethod.push({ ...d.verificationMethod[0], type: 'JsonWebKey' }); },
    member  : 'verificationMethod',
    message : `verificationMethod[1].id is the id of verificationMethod[0]: ${SHARED_ID}`
  },
  {
    label   : 'verificationMethod: the absolute and the relative form of one id',
    change  : d => { d.verificationMethod.push({ ...d.verificationMethod[0], id: relative(d.verificationMethod[0].id) }); },
    member  : 'verificationMethod',
    message : `verificationMethod[1].id is the id of verificationMethod[0]: ${SHARED_ID}`
  },
  {
    label   : 'authentication: an embedded method with the id of a method in verificationMethod',
    change  : d => { d.authentication.push({ ...d.verificationMethod[0] }); },
    member  : 'authentication',
    message : `authentication[1].id is the id of verificationMethod[0]: ${SHARED_ID}`
  },
  {
    label   : 'service: a service with the id of a verification method',
    change  : d => { d.service = [linkedDomains(d.verificationMethod[0].id)]; },
    member  : 'service',
    message : `service[0].id is the id of verificationMethod[0]: ${SHARED_ID}`
  },
];
