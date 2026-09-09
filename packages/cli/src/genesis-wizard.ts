import { BEACON_ADDRESS_TYPES, BEACON_TYPES, DEFAULT_BEACON_ADDRESS_TYPE, VERIFICATION_RELATIONSHIPS } from '@did-btcr2/api';
import type { GenesisSpecBeacon, GenesisSpecFile, GenesisSpecService, GenesisSpecVerificationMethod } from './genesis-spec.js';

/** Asks one question and returns the answer line. */
export type Ask = (question: string) => Promise<string>;

/** One keystore key as the wizard lists it. */
export interface WizardKey {
  keyId       : string;
  fingerprint : string;
  name?       : string;
  active      : boolean;
}

/** What the wizard needs from the command: output, the key list, and key resolution. */
export interface WizardContext {
  /** Prints one line to the operator. */
  say: (line: string) => void;
  /** The keys of the keystore, for the list and the default. */
  keys: WizardKey[];
  /** Resolves a key reference to its id, or throws with a message. */
  resolveKey: (ref: string) => string;
}

/** A 33-byte compressed public key as hex. */
const PUBLIC_KEY_HEX = /^0[23][0-9a-fA-F]{64}$/;

/**
 * Collects a genesis spec through questions: the verification methods with
 * their relationships, the beacons, and the other services. The answers are
 * not checked against the network here; the api checks them when it builds
 * the document, and the command reports the failure.
 * @param ask Asks one question.
 * @param ctx The output, the key list, and the key resolver.
 * @returns The spec.
 */
export async function collectGenesisSpec(ask: Ask, ctx: WizardContext): Promise<GenesisSpecFile> {
  const verificationMethods = await collectVerificationMethods(ask, ctx);
  const beacons = await collectBeacons(ask, ctx, verificationMethods[0]);
  const services = await collectServices(ask, ctx);
  return { verificationMethods, beacons, ...(services.length > 0 && { services }) };
}

/** Asks for the verification methods. The first one defaults to the active key. */
async function collectVerificationMethods(ask: Ask, ctx: WizardContext): Promise<GenesisSpecVerificationMethod[]> {
  if (ctx.keys.length === 0) {
    ctx.say('The keystore has no keys. Enter each key as a 33-byte compressed public key in hex.');
  } else {
    ctx.say('Keys in the keystore:');
    for (const key of ctx.keys) {
      ctx.say(`  ${key.fingerprint}${key.name ? `  ${key.name}` : ''}${key.active ? '  (active)' : ''}`);
    }
  }
  const active = ctx.keys.find(key => key.active);
  const methods: GenesisSpecVerificationMethod[] = [];
  for (let n = 1; ; n++) {
    const defaultRef = n === 1 && active ? (active.name ?? active.fingerprint) : undefined;
    const source = await askKeySource(ask, ctx, `Verification method ${n}: key reference or public key hex`, defaultRef);
    const relationships = await askRelationships(ask, ctx, n);
    methods.push({ ...source, ...(relationships && { relationships }) });
    if (!(await askYesNo(ask, 'Add another verification method?'))) break;
  }
  return methods;
}

/** Asks for the beacons. The first one defaults to a Singleton beacon on the first key. */
async function collectBeacons(ask: Ask, ctx: WizardContext, firstMethod: GenesisSpecVerificationMethod): Promise<GenesisSpecBeacon[]> {
  const beacons: GenesisSpecBeacon[] = [];
  for (let n = 1; ; n++) {
    const type = await askChoice(ask, ctx, `Beacon ${n} type`, BEACON_TYPES, 'SingletonBeacon');
    const address = (await ask(`Beacon ${n} address (blank: derive the address from the key of method 1): `)).trim();
    if (address.length === 0) {
      const addressType = await askChoice(ask, ctx, `Beacon ${n} address type`, BEACON_ADDRESS_TYPES, DEFAULT_BEACON_ADDRESS_TYPE);
      const keySource = firstMethod.key !== undefined ? { key: firstMethod.key } : { publicKey: firstMethod.publicKey };
      beacons.push({ type, ...keySource, addressType });
    } else {
      beacons.push({ type, address });
    }
    if (!(await askYesNo(ask, 'Add another beacon?'))) break;
  }
  return beacons;
}

/** Asks for the other services, if any. */
async function collectServices(ask: Ask, ctx: WizardContext): Promise<GenesisSpecService[]> {
  const services: GenesisSpecService[] = [];
  while (await askYesNo(ask, 'Add a service?')) {
    const n = services.length + 1;
    const fragment = (await ask(`Service ${n} id fragment (blank: service-<position>): `)).trim();
    const type = await askRequired(ask, ctx, `Service ${n} type`);
    const serviceEndpoint = await askRequired(ask, ctx, `Service ${n} endpoint`);
    services.push({ ...(fragment.length > 0 && { id: `#${fragment.replace(/^#/, '')}` }), type, serviceEndpoint });
  }
  return services;
}

/** Asks for a key reference or a public key hex, until the answer resolves. */
async function askKeySource(
  ask        : Ask,
  ctx        : WizardContext,
  question   : string,
  defaultRef : string | undefined,
): Promise<{ key: string } | { publicKey: string }> {
  for (;;) {
    const raw = (await ask(`${question}${defaultRef ? ` [${defaultRef}]` : ''}: `)).trim();
    const answer = raw.length > 0 ? raw : defaultRef;
    if (answer === undefined) {
      ctx.say('A key is required.');
      continue;
    }
    if (PUBLIC_KEY_HEX.test(answer)) return { publicKey: answer.toLowerCase() };
    try {
      ctx.resolveKey(answer);
      return { key: answer };
    } catch (error) {
      ctx.say((error as Error).message);
    }
  }
}

/** Asks for the relationships of a method. Blank means all four (the api default). */
async function askRelationships(ask: Ask, ctx: WizardContext, n: number): Promise<string[] | undefined> {
  const names = VERIFICATION_RELATIONSHIPS.join(', ');
  for (;;) {
    const raw = (await ask(`Relationships of method ${n} (comma-separated: ${names}) [all]: `)).trim();
    if (raw.length === 0) return undefined;
    const chosen = raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
    const unknown = chosen.filter(name => !(VERIFICATION_RELATIONSHIPS as readonly string[]).includes(name));
    if (unknown.length === 0) return chosen;
    ctx.say(`Unknown relationship: ${unknown.join(', ')}. Expected one of ${names}.`);
  }
}

/** Asks for one value of a list, with a default. */
async function askChoice<T extends string>(
  ask          : Ask,
  ctx          : WizardContext,
  question     : string,
  choices      : readonly T[],
  defaultValue : T,
): Promise<T> {
  for (;;) {
    const raw = (await ask(`${question} (${choices.join(', ')}) [${defaultValue}]: `)).trim();
    if (raw.length === 0) return defaultValue;
    if ((choices as readonly string[]).includes(raw)) return raw as T;
    ctx.say(`Unknown value "${raw}". Expected one of ${choices.join(', ')}.`);
  }
}

/** Asks for a non-empty value. */
async function askRequired(ask: Ask, ctx: WizardContext, question: string): Promise<string> {
  for (;;) {
    const raw = (await ask(`${question}: `)).trim();
    if (raw.length > 0) return raw;
    ctx.say('A value is required.');
  }
}

/** Asks a yes/no question. Blank means no. */
async function askYesNo(ask: Ask, question: string): Promise<boolean> {
  const raw = (await ask(`${question} [y/N]: `)).trim();
  return /^y(es)?$/i.test(raw);
}
