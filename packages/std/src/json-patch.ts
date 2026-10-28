import { MethodError } from './errors.js';

export type PatchOpCode = 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';

/** The operation codes of RFC 6902, section 4. */
const PATCH_OP_CODES: ReadonlySet<string> = new Set<PatchOpCode>(['add', 'remove', 'replace', 'move', 'copy', 'test']);

/** The operations that require a `value` (RFC 6902, sections 4.1, 4.3, 4.6). */
const OPS_WITH_VALUE: ReadonlySet<string> = new Set<PatchOpCode>(['add', 'replace', 'test']);

/** The operations that require a `from` (RFC 6902, sections 4.4, 4.5). */
const OPS_WITH_FROM: ReadonlySet<string> = new Set<PatchOpCode>(['move', 'copy']);

/**
 * The syntax of a JSON Pointer (RFC 6901, section 3): zero or more reference tokens, each
 * after a `/`. A `~` is valid only in the escapes `~0` and `~1`.
 */
const JSON_POINTER = /^(?:\/(?:[^/~]|~[01])*)*$/;

/** The form of an array index (RFC 6901, section 4): digits, with no leading zero. */
const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/;

/** The result of {@link resolvePointer} for a location that does not exist. */
const MISSING = Symbol('missing');

/**
 * A JSON Patch operation, as defined in {@link https://datatracker.ietf.org/doc/html/rfc6902 | RFC 6902}.
 */
export interface PatchOperation {
  op: PatchOpCode;
  path: string;
  value?: unknown; // Required for add, replace, test
  from?: string; // Required for move, copy
}

/** A JSON object or a JSON array: a value that can hold a target location. */
type JsonContainer = Record<string, unknown> | unknown[];

/**
 * Fail the current operation. {@link JSONPatch.apply} adds the index and the code of the
 * operation to the message.
 * @param {string} reason - The reason of the failure.
 * @throws {MethodError} `JSON_PATCH_APPLY_ERROR`, always.
 */
function fail(reason: string): never {
  throw new MethodError(reason, 'JSON_PATCH_APPLY_ERROR');
}

/**
 * Get the message of a caught error. A `toJSON` method of an operation value can throw a
 * value that is not an Error; the text does not convert that value to a string.
 * @param {unknown} error - The caught error.
 * @returns {string} The message of the error.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'a value that is not an Error was thrown';
}

/**
 * Check that a value is a JSON object: an object that is not an array.
 * @param {unknown} value - The value to check.
 * @returns {boolean} `true` if the value is a JSON object.
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Make a JSON copy of a value: the value after `JSON.stringify` and `JSON.parse`. The copy
 * holds only plain objects, arrays, strings, finite numbers, booleans, and null. An object
 * member named `__proto__` stays an own data member, because `JSON.parse` defines it.
 * @param {unknown} value - The value to copy.
 * @returns {unknown} The JSON copy.
 * @throws {MethodError} `JSON_PATCH_APPLY_ERROR` if the value has no JSON text, for example
 * `undefined` or a function.
 * @throws {TypeError} If the value holds a cycle or a BigInt.
 */
function jsonCopy(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (text === undefined) fail('the value has no JSON text');
  return JSON.parse(text);
}

/**
 * Compare two JSON values by the rules of RFC 6902, section 4.6. Two objects are equal if
 * they have the same member names and equal values; the member order is not significant.
 * Two arrays are equal if they have equal values at each index. The comparison reads own
 * members only and calls no method of a value, so a member named `hasOwnProperty` is data.
 * The comparison uses a list of pairs, not recursion, so a deep value cannot overflow the
 * stack.
 * @param {unknown} a - The first JSON value.
 * @param {unknown} b - The second JSON value.
 * @returns {boolean} `true` if the two values are equal.
 */
function jsonEqual(a: unknown, b: unknown): boolean {
  const pairs: Array<[unknown, unknown]> = [[a, b]];
  while (pairs.length > 0) {
    const [x, y] = pairs.pop()!;
    if (Array.isArray(x) || Array.isArray(y)) {
      if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
      x.forEach((item, index) => pairs.push([item, y[index]]));
    } else if (isJsonObject(x) || isJsonObject(y)) {
      if (!isJsonObject(x) || !isJsonObject(y)) return false;
      const names = Object.keys(x);
      if (names.length !== Object.keys(y).length) return false;
      for (const name of names) {
        if (!Object.hasOwn(y, name)) return false;
        pairs.push([x[name], y[name]]);
      }
    } else if (x !== y) {
      return false;
    }
  }
  return true;
}

/**
 * Split a JSON Pointer into its reference tokens and decode each token (RFC 6901, section 4):
 * first `~1` to `/`, then `~0` to `~`. The pointer `''` has no token.
 * @param {string} pointer - A JSON Pointer with a valid syntax.
 * @returns {string[]} The decoded reference tokens.
 */
function pointerTokens(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer.slice(1).split('/').map(token => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/**
 * Evaluate a JSON Pointer against a JSON value (RFC 6901, section 4). In an object, a token
 * names an own member: an inherited JavaScript member, for example `toString`, is not a
 * member of the JSON value. In an array, a token must be the array index of an element.
 * @param {unknown} document - The JSON value.
 * @param {string} pointer - A JSON Pointer with a valid syntax.
 * @returns {unknown} The value at the location, or {@link MISSING} if the location does not exist.
 */
function resolvePointer(document: unknown, pointer: string): unknown {
  let value = document;
  for (const token of pointerTokens(pointer)) {
    if (Array.isArray(value)) {
      if (!ARRAY_INDEX.test(token) || Number(token) >= value.length) return MISSING;
      value = value[Number(token)];
    } else if (isJsonObject(value) && Object.hasOwn(value, token)) {
      value = value[token];
    } else {
      return MISSING;
    }
  }
  return value;
}

/**
 * Get the value at a location that must exist (RFC 6902, sections 4.2 to 4.6).
 * @param {unknown} document - The JSON value.
 * @param {string} pointer - A JSON Pointer with a valid syntax.
 * @param {'path' | 'from'} member - The operation member that holds the pointer.
 * @returns {unknown} The value at the location.
 * @throws {MethodError} `JSON_PATCH_APPLY_ERROR` if the location does not exist.
 */
function valueAt(document: unknown, pointer: string, member: 'path' | 'from'): unknown {
  const value = resolvePointer(document, pointer);
  if (value === MISSING) fail(`${member} "${pointer}" does not exist`);
  return value;
}

/**
 * Get the container of a location and the last reference token of the location. The
 * container must exist and must be an object or an array (RFC 6902, section 4.1).
 * @param {unknown} document - The JSON value.
 * @param {string} pointer - A JSON Pointer with a valid syntax, not `''`.
 * @returns {[JsonContainer, string]} The container and the decoded last token.
 * @throws {MethodError} `JSON_PATCH_APPLY_ERROR` if the container does not exist or is not
 * an object or an array.
 */
function containerOf(document: unknown, pointer: string): [JsonContainer, string] {
  const container = resolvePointer(document, pointer.slice(0, pointer.lastIndexOf('/')));
  if (container === MISSING) fail(`the parent of "${pointer}" does not exist`);
  if (typeof container !== 'object' || container === null) {
    fail(`the parent of "${pointer}" is not an object or an array`);
  }
  return [container as JsonContainer, pointerTokens(pointer).pop()!];
}

/**
 * Set an object member as an own data member. An assignment to a member named `__proto__`
 * changes the prototype of the object, so the write uses `Object.defineProperty`. A member
 * that exists keeps its position in the member order.
 * @param {Record<string, unknown>} object - The JSON object.
 * @param {string} name - The member name.
 * @param {unknown} value - The member value.
 */
function setMember(object: Record<string, unknown>, name: string, value: unknown): void {
  Object.defineProperty(object, name, { value, writable: true, enumerable: true, configurable: true });
}

/**
 * The `add` operation (RFC 6902, section 4.1). The pointer `''` replaces the whole document.
 * In an array, the token `-` appends the value, and an index inserts the value before the
 * element at that index. The index must not be greater than the number of elements. In an
 * object, the operation adds the member or replaces the value of the member.
 * @param {unknown} document - The JSON value to change.
 * @param {string} pointer - The target location.
 * @param {unknown} value - The value to add.
 * @returns {unknown} The changed document.
 * @throws {MethodError} `JSON_PATCH_APPLY_ERROR` if the operation fails.
 */
function add(document: unknown, pointer: string, value: unknown): unknown {
  if (pointer === '') return value;
  const [container, token] = containerOf(document, pointer);
  if (!Array.isArray(container)) {
    setMember(container, token, value);
  } else if (token === '-') {
    container.push(value);
  } else {
    if (!ARRAY_INDEX.test(token)) fail(`"${token}" is not an array index (RFC 6901 section 4)`);
    const index = Number(token);
    if (index > container.length) {
      fail(`index ${index} is greater than the number of elements (${container.length}) (RFC 6902 section 4.1)`);
    }
    container.splice(index, 0, value);
  }
  return document;
}

/**
 * The `remove` operation (RFC 6902, section 4.2). The location must exist. RFC 6902 gives
 * no document after a remove of the whole document, so the pointer `''` fails.
 * @param {unknown} document - The JSON value to change.
 * @param {string} pointer - The location to remove.
 * @param {'path' | 'from'} member - The operation member that holds the pointer.
 * @returns {unknown} The removed value.
 * @throws {MethodError} `JSON_PATCH_APPLY_ERROR` if the operation fails.
 */
function remove(document: unknown, pointer: string, member: 'path' | 'from'): unknown {
  if (pointer === '') fail('a remove of the whole document gives no document (RFC 6902 section 4.2)');
  const value = valueAt(document, pointer, member);
  const [container, token] = containerOf(document, pointer);
  if (Array.isArray(container)) {
    container.splice(Number(token), 1);
  } else {
    Reflect.deleteProperty(container, token);
  }
  return value;
}

/**
 * The `replace` operation (RFC 6902, section 4.3). The location must exist. The new value
 * keeps the position of the old value.
 * @param {unknown} document - The JSON value to change.
 * @param {string} pointer - The target location.
 * @param {unknown} value - The new value.
 * @returns {unknown} The changed document.
 * @throws {MethodError} `JSON_PATCH_APPLY_ERROR` if the operation fails.
 */
function replace(document: unknown, pointer: string, value: unknown): unknown {
  valueAt(document, pointer, 'path');
  if (pointer === '') return value;
  const [container, token] = containerOf(document, pointer);
  if (Array.isArray(container)) {
    container[Number(token)] = value;
  } else {
    setMember(container, token, value);
  }
  return document;
}

/**
 * The `move` operation (RFC 6902, section 4.4): a `remove` at `from`, then an `add` at
 * `path`. The `from` location must exist. The index check of the `add` runs on the array
 * after the `remove`. {@link JSONPatch.validateOperations} refuses a `from` that is a proper
 * prefix of `path`.
 * @param {unknown} document - The JSON value to change.
 * @param {string} from - The location of the value.
 * @param {string} pointer - The target location.
 * @returns {unknown} The changed document.
 * @throws {MethodError} `JSON_PATCH_APPLY_ERROR` if the operation fails.
 */
function move(document: unknown, from: string, pointer: string): unknown {
  if (from === pointer) {
    valueAt(document, from, 'from');
    return document;
  }
  return add(document, pointer, remove(document, from, 'from'));
}

/**
 * Apply one operation that {@link JSONPatch.validateOperations} accepted.
 * @param {unknown} document - The JSON value to change.
 * @param {PatchOperation} operation - The operation.
 * @returns {unknown} The changed document.
 * @throws {MethodError} `JSON_PATCH_APPLY_ERROR` if the operation fails.
 */
function applyOperation(document: unknown, operation: PatchOperation): unknown {
  const { path } = operation;
  switch (operation.op) {
    case 'add':
      return add(document, path, operation.value);
    case 'remove':
      remove(document, path, 'path');
      return document;
    case 'replace':
      return replace(document, path, operation.value);
    case 'move':
      return move(document, operation.from!, path);
    case 'copy':
      // RFC 6902 section 4.5: an `add` of the value at `from`. The copy is deep, so a later
      // operation that changes one location does not change the other location.
      return add(document, path, jsonCopy(valueAt(document, operation.from!, 'from')));
    case 'test':
      if (!jsonEqual(valueAt(document, path, 'path'), operation.value)) fail('Test operation failed');
      return document;
  }
}

/**
 * Wrap a check failure of {@link JSONPatch.validateOperations} as an apply failure.
 * @param {MethodError} error - The check failure.
 * @returns {MethodError} The error of type `JSON_PATCH_APPLY_ERROR`.
 */
function invalidOperations(error: MethodError): MethodError {
  return new MethodError(
    `Invalid JSON Patch operations: ${error.message}`, 'JSON_PATCH_APPLY_ERROR', { index: error.data?.index, error }
  );
}

/**
 * Apply a JSON Patch (RFC 6902) with the JSON Pointer rules of RFC 6901.
 * @class JSONPatch
 * @type {JSONPatch}
 */
export class JSONPatch {
  /**
   * Apply a JSON Patch to a source document and return the patched document. The patch is
   * atomic: the operations run in order on a JSON copy of the source document, and the first
   * operation that fails fails the whole patch (RFC 6902, section 5). The source document
   * and the operations stay unchanged.
   *
   * The checks:
   * - {@link JSONPatch.validateOperations} checks a JSON copy of the operations before the
   *   first operation runs.
   * - Each target location of `remove`, `replace`, and `test` and each `from` location must
   *   exist. In an object, only an own member exists: an inherited JavaScript member, for
   *   example `toString`, does not.
   * - An array token is an index with no leading zero. The index of an `add` (also the add
   *   of `move` and `copy`) must not be greater than the number of elements. The token `-`
   *   appends, and only an `add` can use it.
   * - A `remove` of the whole document (`''`) fails.
   * - A `test` compares by the rules of RFC 6902, section 4.6.
   *
   * Each member name is valid, also `constructor`, `prototype`, and `__proto__`: the patch
   * writes them as own data members and changes no prototype.
   * @param {Record<any, any>} sourceDocument - The source JSON document.
   * @param {PatchOperation[]} operations - The JSON Patch operations.
   * @returns {Record<any, any>} The patched JSON document. A patch that adds or replaces the
   * whole document (`''`) can give any JSON value.
   * @throws {MethodError} `JSON_PATCH_APPLY_ERROR` if the operations are not valid, if the
   * operations or the source document have no JSON form, or if an operation fails. The
   * message names the index, the `op`, and the `path` of the operation that fails.
   */
  static apply(sourceDocument: Record<any, any>, operations: PatchOperation[]): Record<any, any> {
    // The array check runs before the JSON copy, because `undefined` has no JSON form.
    if (!Array.isArray(operations)) throw invalidOperations(JSONPatch.validateOperations(operations)!);

    // The patch runs on a JSON copy of the operations, so the patched document shares no
    // object with the operations. The checks run on the same copy (ADR 139).
    let copiedOperations: unknown;
    try {
      copiedOperations = jsonCopy(operations);
    } catch(error) {
      throw new MethodError(
        `Invalid JSON Patch operations: the operations have no JSON form: ${messageOf(error)}`,
        'JSON_PATCH_APPLY_ERROR', { error }
      );
    }
    const validationError = JSONPatch.validateOperations(copiedOperations);
    if (validationError) throw invalidOperations(validationError);

    let document: unknown;
    try {
      document = jsonCopy(sourceDocument);
    } catch(error) {
      throw new MethodError(
        `JSON Patch application failed: the source document has no JSON form: ${messageOf(error)}`,
        'JSON_PATCH_APPLY_ERROR', { error }
      );
    }

    for (const [index, operation] of (copiedOperations as PatchOperation[]).entries()) {
      try {
        document = applyOperation(document, operation);
      } catch(error) {
        const { op, path, from } = operation;
        throw new MethodError(
          `JSON Patch application failed at operation ${index} (${op} ${path}): ${messageOf(error)}`,
          'JSON_PATCH_APPLY_ERROR', OPS_WITH_FROM.has(op) ? { index, op, path, from } : { index, op, path }
        );
      }
    }
    return document as Record<any, any>;
  }

  /**
   * Check the operations of a JSON Patch with no document: the checks find a patch that is
   * malformed. The checks of each operation, in this order:
   * 1. The operation is a JSON object.
   * 2. `op` is a string and an RFC 6902 operation code.
   * 3. `path` is a string and a JSON Pointer (RFC 6901, section 3).
   * 4. `add`, `replace`, and `test` have a `value`.
   * 5. `move` and `copy` have a `from` that is a string and a JSON Pointer.
   * 6. The `from` of a `move` is not a proper prefix of its `path`: a location cannot move
   *    into one of its children (RFC 6902, section 4.4).
   *
   * A member that the operation does not define is ignored (RFC 6902, section 4).
   * @param {unknown} operations - The operations to check.
   * @returns {MethodError | null} A MethodError of type `JSON_PATCH_VALIDATION_ERROR` with
   * `data.index` for the first operation that fails a check, otherwise null.
   */
  static validateOperations(operations: unknown): MethodError | null {
    const invalid = (message: string, index?: number): MethodError =>
      new MethodError(message, 'JSON_PATCH_VALIDATION_ERROR', { index });
    if (!Array.isArray(operations)) return invalid('Operations must be an array');
    for (const [index, operation] of operations.entries()) {
      if (!isJsonObject(operation)) return invalid('Operation must be an object', index);
      const { op, path, from } = operation;
      if (typeof op !== 'string') return invalid('Operation.op must be a string', index);
      if (!PATCH_OP_CODES.has(op)) return invalid(`Operation.op is not an RFC 6902 operation: ${op}`, index);
      if (typeof path !== 'string') return invalid('Operation.path must be a string', index);
      if (!JSON_POINTER.test(path)) {
        return invalid(`Operation.path is not a JSON Pointer (RFC 6901 section 3): ${path}`, index);
      }
      if (OPS_WITH_VALUE.has(op) && (!Object.hasOwn(operation, 'value') || operation.value === undefined)) {
        return invalid(`Operation.value is required for op=${op}`, index);
      }
      if (!OPS_WITH_FROM.has(op)) continue;
      if (typeof from !== 'string') return invalid(`Operation.from must be a string for op=${op}`, index);
      if (!JSON_POINTER.test(from)) {
        return invalid(`Operation.from is not a JSON Pointer (RFC 6901 section 3): ${from}`, index);
      }
      if (op === 'move' && path.startsWith(`${from}/`)) {
        return invalid(
          'Operation.from is a proper prefix of Operation.path: a location cannot move into one of its children (RFC 6902 section 4.4)',
          index
        );
      }
    }
    return null;
  }
}
