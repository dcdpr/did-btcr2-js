import { Canonicalization } from './canonicalization.js';
import { Patch } from './patch.js';
import { JSONObject, Maybe, Prototyped, Unprototyped } from './types.js';

/** Extend the global namespace */
declare global {
  /** Extend the global Array interface */
  interface Array<T> {
      /** Get the last element of the array */
      last(): T | undefined;
      /** Get the last element of the array */
      [-1](): T | undefined;
      /** Convert Array to Uint8Array */
      toUint8Array(): Uint8Array;
  }

  /** Extend the global Buffer interface */
   interface BufferConstructor {
    /** Convert a hex string to a Buffer */
    fromHex(hex: string): Buffer<ArrayBuffer>;
    /** Convert a Uint8Array to a hex string */
    toHex(ui8: Uint8Array): string;
    /** Convert Buffer to Uint8Array */
    toUint8Array(buf: Buffer<ArrayBuffer>): Uint8Array;
  }

  /** Extend the global Date interface */
  interface Date {
    /** Get the UTC date and time in ISO 8601 format */
    getUTCDateTime(): string;
    /** Convert date to Unix timestamp */
    toUnix(): number;
  }

  /** Extend global JSON interface */
  interface JSON {
      /** Check if an object is a JSON object */
      is(unknown: Maybe<JSONObject>): boolean;
      /** Check if JSON string can be parsed to JSON object */
      parsable(unknown: Maybe<string>): boolean;
      /** Check if JSON object can be converted to JSON string */
      stringifiable(unknown: Maybe<JSONObject>): boolean;
      /** Check if JSON object is unprototyped [Object: null prototype] {} */
      unprototyped(unknown: Maybe<Prototyped>): boolean;
      /** Normalize unprototyped JSON object to prototyped JSON object */
      normalize(unknown: Maybe<Unprototyped>): Prototyped;
      /** Shallow copy of JSON object */
      copy(o: JSONObject): JSONObject;
      /** Clone (deep copy) of JSON object */
      clone(o: JSONObject): JSONObject;
      /** Deep copy of JSON object with replacement */
      cloneReplace(o: JSONObject, e: RegExp, r: string): JSONObject;
      /** Check if two objects are strictly equal */
      equal(a: any, b: any): boolean;
      /** Check if two objects are deeply equal */
      deepEqual(a: any, b: any): boolean;
      /** Delete key/value pair(s) from a JSON object */
      delete(o: JSONObject, keys: Array<string | number | symbol>): JSONObject;
      /** Sanitize a JSON object by removing any keys whose value is undefined */
      sanitize(o: JSONObject): JSONObject;
      /** Canonicalization object */
      canonicalization: Canonicalization;
      /** JSON Patch (IETF RFC 6902) */
      patch: Patch;
  }

  /** Extend global Object interface */
  interface ObjectConstructor {
    /** Convert an object to a JSON object */
    json(o: Object): JSONObject;
  }

  /** Extend global Set interface */
  interface Set<T> {
    /** Get the difference between two sets */
    difference(other: Set<T>): Set<T>;
  }

  interface String {
    /** Convert to SCREAMING_SNAKE_CASE */
    toSnakeScream(): string;
    /** Convert to snake_case */
    toSnake(): string;
    /** Remove the last character from a string */
    chop(): string;
    /** Replace the end of a string */
    replaceEnd(e: string | RegExp, r?: string): string;
  }

  /** Extend the global Uint8Array interface */
  interface Uint8Array {
    /** Convert Uint8Array to a regular array of numbers */
    toArray(): number[];
    /** Concatenate multiple Uint8Arrays into one */
    concat(...items: Uint8Array[]): Uint8Array;
    /** Convert Uint8Array to a hex string */
    toHex(): string;
  }
}

/** Array Interface Extensions */
Array.prototype.last = function <T>(): T | undefined {
  return this[this.length - 1] ?? undefined;
};

Array.prototype[-1] = function <T>(): T | undefined {
  return this.last();
};

Array.prototype.toUint8Array = function (): Uint8Array {
  return new Uint8Array(this);
};

/** BufferConstructor/Buffer Interface Extensions */
Buffer.fromHex = function (hex: string): Buffer<ArrayBuffer> {
  return Buffer.from(hex, 'hex');
};

Buffer.toHex = function (ui8: Uint8Array): string {
  return Buffer.from(ui8).toString('hex');
};

Buffer.toUint8Array = function (buf: Buffer<ArrayBuffer>): Uint8Array {
  return new Uint8Array(buf);
};

/** Date Interface Extensions */
Date.prototype.getUTCDateTime = function (): string {
  return `${this.toISOString().slice(0, -5)}Z`;
};

Date.prototype.toUnix = function (): number {
  const time = this.getTime();
  if (isNaN(time)) {
    throw new Error(`Invalid date string: "${this}"`);
  }
  return time;
};

/** JSON Interface Extensions */
JSON.is = function (unknown: Maybe<JSONObject>): boolean {
  if (unknown === null || typeof unknown !== 'object') return false;
  if (Array.isArray(unknown))
    return unknown.every(item => Object.getPrototypeOf(item) !== null);
  else
    return Object.getPrototypeOf(unknown) === null;
};

JSON.parsable = function (unknown: Maybe<string>): boolean {
  try {
    JSON.parse(unknown);
    return true;
  } catch {
    return false;
  }
};

JSON.stringifiable = function (unknown: Maybe<JSONObject>): boolean {
  try {
    JSON.stringify(unknown);
    return true;
  } catch {
    return false;
  }
};

JSON.unprototyped = function (unknown: Maybe<Unprototyped>): boolean {
  if (Array.isArray(unknown)) {
    return unknown.every(item => Object.getPrototypeOf(item) === null);
  }
  return Object.getPrototypeOf(unknown) === null;
};

JSON.normalize = function (unknown: Maybe<Unprototyped>): Prototyped {
  try {
    return JSON.parse(JSON.stringify(unknown));
  } catch {
    throw new Error('The object is not unprotocyped');
  }
};

JSON.copy = function (o: JSONObject): JSONObject {
  return Object.assign({}, o);
};

JSON.clone = function (o: JSONObject): JSONObject {
  return JSON.parse(JSON.stringify(o));
};

JSON.cloneReplace = function (o: JSONObject, e: RegExp, r: string): JSONObject {
  return JSON.parse(JSON.stringify(o).replaceAll(e, r));
};

JSON.equal = function (a: any, b: any): boolean {
  return a === b;
};

JSON.deepEqual = function (a: any, b: any): boolean {
  if(JSON.equal(a, b)) return true;

  if (a === null || b === null || typeof a !== typeof b) return false;

  if (typeof a === 'object') {
    const isArrayA = Array.isArray(a);
    const isArrayB = Array.isArray(b);
    if (isArrayA !== isArrayB) return false;

    if (isArrayA && isArrayB) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!this.deepEqual(a[i], b[i])) return false;
      }
      return true;
    } else {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) return false;

      for (const key of keysA) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) {
          return false;
        }
        if (!this.deepEqual(a[key], b[key])) {
          return false;
        }
      }
      return true;
    }
  }

  return false;
};

JSON.delete = function(o: JSONObject, keys: Array<string | number | symbol>): JSONObject {
  if (!JSON.is(o)) return o;

  for(const key of keys) {
    if (Object.prototype.hasOwnProperty.call(o, key)) {
      delete o[key];
    }

    for (const key in o) {
      if (typeof o[key] === 'object') {
        o[key] = this.delete(o[key], [key]);
      }
    }
  }

  return o;
};

JSON.sanitize = function (o: JSONObject): JSONObject {
  for (const key of Object.keys(o)) {
    if (o[key] === undefined) {
      delete o[key];
    }
  }
  return o;
};

JSON.canonicalization = new Canonicalization();
JSON.patch = new Patch();

/** Object Interface Extensions */
Object.json = function (o: Object): JSONObject {
  return Object.fromEntries(Object.entries(o));
};

/** Set Interface Extensions */
Set.prototype.difference = function <T>(other: Set<T>): Set<T> {
  const result = new Set<T>(this);
  for (const item of other) {
    if (result.has(item)) {
      result.delete(item);
    }
  }
  return result;
};

/** String Interface Extensions */
String.prototype.toSnake = function (): string {
  return this
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();
};

String.prototype.toSnakeScream = function (): string {
  return this.toSnake().toUpperCase();
};

String.prototype.chop = function (): string {
  return this.length > 0 ? this.slice(0, -1) : '';
};

String.prototype.replaceEnd = function (e: string | RegExp, r?: string): string {
  const pattern = e instanceof RegExp
    ? new RegExp(e.source.endsWith('$') ? e.source : `${e.source}$`, e.flags.replace('g', ''))
    : new RegExp(`${e.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}$`);

  return this.replace(pattern, r ?? '');
};

/** Uint8Array Interface Extensions */
Uint8Array.prototype.toArray = function (): number[] {
  return Array.from(this);
};

Uint8Array.prototype.toHex = function (): string  {
  return Buffer.from(this).toString('hex');
};

export default global;