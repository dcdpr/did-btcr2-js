import type { DidUpdateResult, ResolutionOptions, Sidecar } from '@did-btcr2/api';
import { DidApi, DidMethodApi } from '@did-btcr2/api';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CLIError } from './error.js';
import { ensureDir, writeFileAtomic } from './keystore/atomic.js';
import { withFileLock } from './keystore/lock.js';
import { defaultDidsPath, type PathOverrides } from './paths.js';

/** Current on-disk format version of the identifier records file. */
export const RECORDS_VERSION = 1 as const;

/** The name of the records file in an error message. */
const LABEL = 'identifier records';

/** The offline operations of the api: the identifier decoder and the canonical hash. */
const didApi = new DidApi();
const methodApi = new DidMethodApi();

/**
 * The record of one identifier (ADR 133). A record holds public data only: key
 * URNs, never key material. The sidecar data is the same object as
 * `resolutionOptions.sidecar`.
 */
export interface IdentifierRecord {
  /** A unique name. A command accepts the name in place of the identifier. */
  name?        : string;
  /** The time of the first record, as an ISO 8601 string. */
  added        : string;
  /** The URNs of the keys that the CLI used for the identifier, in the order of first use. */
  keys         : string[];
  /** The key that signs the next update if no `--signing-key` is given. One of `keys`. */
  signingKey?  : string;
  /** The beacon signal transactions of the updates that the CLI broadcast, in order. */
  txids        : string[];
  /** Present and true after a deactivation. */
  deactivated? : true;
  /** The sidecar data that a resolver needs for the identifier. */
  sidecar      : Sidecar;
}

/** The whole records file. */
type RecordsFile = {
  v           : typeof RECORDS_VERSION;
  identifiers : Record<string, IdentifierRecord>;
};

/** One change to a record. {@link IdentifierRecords.record} applies it under the file lock. */
export interface RecordChange {
  /** Sets the name. Refused if another identifier has the name. */
  name?        : string;
  /** Adds the key to `keys` and makes it the signing key. */
  signingKey?  : string;
  /** Appends the beacon signal transaction. */
  txid?        : string;
  /** Merges the sidecar data into the record. */
  sidecar?     : Sidecar;
  /** Marks the identifier as deactivated. */
  deactivated? : true;
}

/**
 * The identifier records file `<home>/dids.json` (ADR 133). The CLI records each
 * identifier that `create`, `update`, `deactivate`, and `identifier add` touch.
 * A read of an absent file gives no records. A write takes the file lock, reads
 * the file again, applies the change, and writes the file atomically (0600).
 */
export class IdentifierRecords {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** The records file of the home that the global flags select. */
  static forHome(overrides?: PathOverrides): IdentifierRecords {
    return new IdentifierRecords(defaultDidsPath(overrides));
  }

  /** Every record, in the order of the first record. */
  list(): Array<[string, IdentifierRecord]> {
    return Object.entries(this.#read().identifiers);
  }

  /** The record of an identifier, or `undefined`. */
  get(identifier: string): IdentifierRecord | undefined {
    return this.#read().identifiers[identifier];
  }

  /** The identifier whose record has the name, or `undefined`. */
  findByName(name: string): string | undefined {
    return findName(this.#read(), name);
  }

  /**
   * Returns the identifier of a reference. A reference that starts with `did:`
   * is an identifier, with or without a record. Any other reference is the name
   * of a record. Throws a {@link CLIError} if no record has the name.
   */
  resolveRef(ref: string): string {
    if (ref.startsWith('did:')) return ref;
    const identifier = this.findByName(ref);
    if (identifier === undefined) {
      throw new CLIError(
        `No identifier record has the name "${ref}". An identifier starts with "did:btcr2:".`,
        'INVALID_ARGUMENT_ERROR',
        { ref },
      );
    }
    return identifier;
  }

  /**
   * Throws a {@link CLIError} if the name is not a valid name, or if an identifier
   * other than `identifier` has the name. A command calls this before it does any
   * work, so a name conflict never follows a key generation or a broadcast.
   */
  assertNameAvailable(name: string, identifier?: string): void {
    assertValidName(name);
    const holder = this.findByName(name);
    if (holder !== undefined && holder !== identifier) {
      throw new CLIError(
        `The name "${name}" belongs to the identifier ${holder}.`,
        'INVALID_ARGUMENT_ERROR',
        { name, identifier: holder },
      );
    }
  }

  /** Applies a change to the record of an identifier. Makes the record if it does not exist. */
  record(identifier: string, change: RecordChange = {}): IdentifierRecord {
    return this.#mutate(file => {
      const record = file.identifiers[identifier]
        ?? { added: new Date().toISOString(), keys: [], txids: [], sidecar: {} };
      if (change.name !== undefined) {
        assertValidName(change.name);
        const holder = findName(file, change.name);
        if (holder !== undefined && holder !== identifier) {
          throw new CLIError(
            `The name "${change.name}" belongs to the identifier ${holder}.`,
            'INVALID_ARGUMENT_ERROR',
            { name: change.name, identifier: holder },
          );
        }
        record.name = change.name;
      }
      if (change.signingKey !== undefined) {
        if (!record.keys.includes(change.signingKey)) record.keys.push(change.signingKey);
        record.signingKey = change.signingKey;
      }
      if (change.txid !== undefined && !record.txids.includes(change.txid)) record.txids.push(change.txid);
      if (change.sidecar !== undefined) record.sidecar = mergeSidecar(record.sidecar, change.sidecar);
      if (change.deactivated) record.deactivated = true;
      file.identifiers[identifier] = ordered(record);
      return file.identifiers[identifier];
    });
  }

  /** Removes the record of an identifier. Returns false, and writes nothing, if no record exists. */
  remove(identifier: string): boolean {
    if (this.get(identifier) === undefined) return false;
    return this.#mutate(file => {
      if (!(identifier in file.identifiers)) return false;
      delete file.identifiers[identifier];
      return true;
    });
  }

  /** Reads the file. An absent file gives no records. A malformed file throws a {@link CLIError}. */
  #read(): RecordsFile {
    let text: string;
    try {
      text = readFileSync(this.path, 'utf-8');
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return { v: RECORDS_VERSION, identifiers: {} };
      throw new CLIError(
        `Could not read the identifier records file ${this.path}: ${(error as Error).message}`,
        'RECORDS_READ_ERROR',
        { path: this.path },
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CLIError(
        `The identifier records file ${this.path} is not valid JSON.`,
        'RECORDS_READ_ERROR',
        { path: this.path },
      );
    }
    const file = parsed as Partial<RecordsFile> | null;
    if (file === null || typeof file !== 'object' || file.v !== RECORDS_VERSION
      || file.identifiers === null || typeof file.identifiers !== 'object' || Array.isArray(file.identifiers)) {
      throw new CLIError(
        `The identifier records file ${this.path} is not a version ${RECORDS_VERSION} records file.`,
        'RECORDS_READ_ERROR',
        { path: this.path },
      );
    }
    return file as RecordsFile;
  }

  /** Reads the file under the lock, applies `fn`, and writes the file. */
  #mutate<T>(fn: (file: RecordsFile) => T): T {
    ensureDir(dirname(this.path), 0o700);
    return withFileLock(`${this.path}.lock`, () => {
      const file = this.#read();
      const result = fn(file);
      writeFileAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`, 0o600, LABEL);
      return result;
    }, { label: LABEL });
  }
}

/** A copy of a record with its fields in one fixed order, for the file and for the output. */
function ordered(record: IdentifierRecord): IdentifierRecord {
  return {
    ...(record.name !== undefined && { name: record.name }),
    added   : record.added,
    keys    : record.keys,
    ...(record.signingKey !== undefined && { signingKey: record.signingKey }),
    txids   : record.txids,
    ...(record.deactivated && { deactivated: true as const }),
    sidecar : record.sidecar,
  };
}

/** The identifier of the record with the name, or `undefined`. */
function findName(file: RecordsFile, name: string): string | undefined {
  return Object.keys(file.identifiers).find(identifier => file.identifiers[identifier].name === name);
}

/** Throws a {@link CLIError} if a name is empty or has the form of an identifier. */
function assertValidName(name: string): void {
  if (name.trim() === '') {
    throw new CLIError('--name must not be empty.', 'INVALID_ARGUMENT_ERROR');
  }
  if (name.startsWith('did:')) {
    throw new CLIError('A name must not start with "did:".', 'INVALID_ARGUMENT_ERROR', { name });
  }
}

/**
 * Merges two sets of sidecar data. The genesis document of `primary` wins. Each
 * array holds the entries of `primary`, then each entry of `secondary` that has
 * another canonical hash. The resolver keys each entry by its hash, so an entry
 * that no beacon signal names has no effect.
 */
export function mergeSidecar(primary: Sidecar, secondary: Sidecar): Sidecar {
  const merged: Sidecar = {};
  const genesisDocument = primary.genesisDocument ?? secondary.genesisDocument;
  if (genesisDocument !== undefined) merged.genesisDocument = genesisDocument;
  const updates = union(primary.updates, secondary.updates);
  if (updates.length > 0) merged.updates = updates;
  const casUpdates = union(primary.casUpdates, secondary.casUpdates);
  if (casUpdates.length > 0) merged.casUpdates = casUpdates;
  const smtProofs = union(primary.smtProofs, secondary.smtProofs);
  if (smtProofs.length > 0) merged.smtProofs = smtProofs;
  return merged;
}

/** The entries of `a`, then each entry of `b` with a new canonical hash. */
function union<T extends object>(a: T[] | undefined, b: T[] | undefined): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of [ ...(a ?? []), ...(b ?? []) ]) {
    const hash = methodApi.hashDocument(entry);
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push(entry);
  }
  return out;
}

/** Whether a set of sidecar data holds no entry. */
export function isEmptySidecar(sidecar: Sidecar): boolean {
  return sidecar.genesisDocument === undefined
    && !sidecar.updates?.length
    && !sidecar.casUpdates?.length
    && !sidecar.smtProofs?.length;
}

/**
 * Adds the sidecar data of a record to the resolution options of a command. The
 * sidecar data of the flags wins (see {@link mergeSidecar}). Returns the options
 * unchanged if there is no record or the record holds no sidecar data.
 */
export function withRecordSidecar(
  options : ResolutionOptions | undefined,
  record  : IdentifierRecord | undefined,
): ResolutionOptions | undefined {
  if (record === undefined || isEmptySidecar(record.sidecar)) return options;
  return { ...(options ?? {}), sidecar: mergeSidecar(options?.sidecar ?? {}, record.sidecar) };
}

/**
 * The record change of a broadcast update or deactivation: the signing key, the
 * transaction, and the sidecar data of the result. `resolutionSidecar` is the
 * sidecar data of the source resolution. The resolution used it, so the record
 * keeps it for the next resolution.
 */
export function changeFromUpdate(
  result            : DidUpdateResult,
  signingKey        : string,
  resolutionSidecar : Sidecar | undefined,
): RecordChange {
  const produced: Sidecar = { updates: [ result.signedUpdate ] };
  if (result.announcement) produced.casUpdates = [ result.announcement ];
  if (result.proof) produced.smtProofs = [ result.proof ];
  return {
    signingKey,
    txid    : result.txid,
    sidecar : mergeSidecar(produced, resolutionSidecar ?? {}),
  };
}

/** The full form of a record that `identifier show` and `identifier add` print. */
export type IdentifierRecordView = { identifier: string; network: string; type: string } & IdentifierRecord;

/** The short form of a record that `identifier list` prints. */
export interface IdentifierSummary {
  identifier   : string;
  name?        : string;
  network      : string;
  type         : string;
  keys         : string[];
  signingKey?  : string;
  updates      : number;
  deactivated? : true;
}

/** The full form of a record: the identifier, its network and type (the HRP), and the record. */
export function describeRecord(identifier: string, record: IdentifierRecord): IdentifierRecordView {
  const { network, hrp } = didApi.decode(identifier);
  const { name, ...rest } = ordered(record);
  return { identifier, ...(name !== undefined && { name }), network, type: hrp, ...rest };
}

/** The short form of a record: no sidecar data and no transactions, only the number of updates. */
export function summarizeRecord(identifier: string, record: IdentifierRecord): IdentifierSummary {
  const { network, hrp } = didApi.decode(identifier);
  return {
    identifier,
    ...(record.name !== undefined && { name: record.name }),
    network,
    type    : hrp,
    keys    : record.keys,
    ...(record.signingKey !== undefined && { signingKey: record.signingKey }),
    updates : record.sidecar.updates?.length ?? 0,
    ...(record.deactivated && { deactivated: true as const }),
  };
}

/**
 * Applies a record change after the work of a command is done. The work is
 * done, so a failure to make or write the change does not fail the command: it
 * prints a warning that names the identifier. The warning ignores
 * `-q/--quiet`, because the record is then incomplete.
 */
export function recordAfterWork(
  records    : IdentifierRecords,
  identifier : string,
  change     : RecordChange | (() => RecordChange),
): void {
  try {
    records.record(identifier, typeof change === 'function' ? change() : change);
  } catch (error) {
    process.stderr.write(
      `Warning: the CLI could not write the record of ${identifier} to ${records.path}: ${(error as Error).message}\n`,
    );
  }
}
