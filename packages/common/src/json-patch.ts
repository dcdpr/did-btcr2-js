import type { Operation } from 'fast-json-patch';
import jsonPatch from 'fast-json-patch';
import { MethodError } from './errors.js';
import type { JSONObject } from './types.js';

const { applyPatch, compare, deepClone } = jsonPatch;

/**
 * JSON Pointer segments that resolve to inherited prototype machinery instead of document data.
 * `fast-json-patch` bans `__proto__` and a trailing `constructor/prototype` pair, but it still
 * traverses an intermediate `constructor` segment, at which point the cursor becomes the global
 * `Object` or `Array` function and the operation writes a static member process-wide.
 */
const UNSAFE_POINTER_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Find the first JSON Pointer segment that traverses into prototype machinery. Segments are
 * unescaped per RFC 6901 first, matching how `fast-json-patch` resolves them.
 * @param {string} pointer - The JSON Pointer to inspect.
 * @returns {string | undefined} The offending segment, or undefined if the pointer is safe.
 */
function findUnsafeSegment(pointer: string): string | undefined {
  return pointer
    .split('/')
    .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .find(segment => UNSAFE_POINTER_SEGMENTS.has(segment));
}

export type PatchOpCode = 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';

/** The operation codes of RFC 6902, section 4. */
const PATCH_OP_CODES: ReadonlySet<string> = new Set<PatchOpCode>(['add', 'remove', 'replace', 'move', 'copy', 'test']);

/** The operations that require a `value` (RFC 6902, sections 4.1, 4.3, 4.6). */
const OPS_WITH_VALUE: ReadonlySet<string> = new Set<PatchOpCode>(['add', 'replace', 'test']);

/**
 * A JSON Patch operation, as defined in {@link https://datatracker.ietf.org/doc/html/rfc6902 | RFC 6902}.
 */
export interface PatchOperation {
  op: PatchOpCode;
  path: string;
  value?: unknown; // Required for add, replace, test
  from?: string; // Required for move, copy
}

/** The options of {@link JSONPatch.apply}. */
export interface JSONPatchApplyOptions {
  /** Apply the operations to the source document itself. Default: `false` (the patch runs on a deep clone). */
  mutate?: boolean;

  /** The clone function for a non-mutating apply. Default: the deep clone of fast-json-patch. */
  clone?: (value: any) => any;

  /**
   * Validate each operation against RFC 6902 and against the document. With `true`, an
   * unknown `op`, a missing `value` (add, replace, test), a missing `from` (move, copy), a
   * `remove` or a `replace` of a path that does not exist, a `move` or a `copy` from a path
   * that does not exist, an `add` under a parent that does not exist, and a failed `test`
   * fail the patch at the first failing operation. With `false`, only a failed `test` fails
   * the patch; the other cases pass silently. Default: `false`.
   */
  strict?: boolean;
}

/**
 * Describe a failure of fast-json-patch for an error message: the index and the code of the
 * failing operation, and the reason. An error without those fields yields its message only.
 * @param {unknown} error - The error that fast-json-patch threw.
 * @returns {string} The description, with a leading separator, or an empty string.
 */
function describePatchFailure(error: unknown): string {
  if (!(error instanceof Error)) return '';
  const { index, operation } = error as Error & { index?: number; operation?: Partial<PatchOperation> };
  const location = typeof index === 'number' && operation && typeof operation === 'object'
    ? ` at operation ${index} (${String(operation.op)} ${String(operation.path)})`
    : '';
  return `${location}: ${error.message}`;
}

/**
 * Thin wrapper around fast-json-patch to keep a stable API within this package.
 * @class JSONPatch
 * @type {JSONPatch}
 */
export class JSONPatch {
  /**
   * Applies a JSON Patch to a source document and returns the patched document.
   * Does not mutate the input document unless `options.mutate` is `true`.
   * @param {JSONObject} sourceDocument - The source JSON document to apply the patch to.
   * @param {PatchOperation[]} operations - The JSON Patch operations to apply.
   * @param {JSONPatchApplyOptions} [options] - The apply options; see {@link JSONPatchApplyOptions}.
   * @returns {JSONObject} The patched JSON document.
   * @throws {MethodError} `JSON_PATCH_APPLY_ERROR` if an operation is invalid or fails to apply.
   */
  static apply(
    sourceDocument: Record<any, any>,
    operations: PatchOperation[],
    options: JSONPatchApplyOptions = {}
  ): Record<any, any> {
    const mutate = options.mutate ?? false;
    const strict = options.strict ?? false;
    const cloneFn = options.clone ?? deepClone;
    const docClone = mutate ? sourceDocument : cloneFn(sourceDocument);
    const validationError = this.validateOperations(operations, strict);
    if (validationError) {
      throw new MethodError(
        `Invalid JSON Patch operations: ${validationError.message}`, 'JSON_PATCH_APPLY_ERROR', { error: validationError }
      );
    }
    let result;
    try {
      result = applyPatch(docClone, operations as Operation[], strict, mutate);
    } catch (error) {
      throw new MethodError(`JSON Patch application failed${describePatchFailure(error)}`, 'JSON_PATCH_APPLY_ERROR', { error });
    }
    if (result.newDocument === undefined) {
      throw new MethodError('JSON Patch application failed: no document', 'JSON_PATCH_APPLY_ERROR', { result });
    }
    return result.newDocument as JSONObject;
  }

  /**
   * Compute a JSON Patch diff from source => target.
   * @param {JSONObject} sourceDocument - The source JSON document.
   * @param {JSONObject} targetDocument - The target JSON document.
   * @param {string} [path] - An optional base path to prefix to each operation.
   * @returns {PatchOperation[]} The computed JSON Patch operations.
   */
  static diff(sourceDocument: JSONObject, targetDocument: JSONObject, path: string = ''): PatchOperation[] {
    const ops = compare(sourceDocument ?? {}, targetDocument ?? {}) as PatchOperation[];
    if (!path) return ops;

    const prefix = path.endsWith('/') ? path.slice(0, -1) : path;
    return ops.map(op => ({
      ...op,
      path : this.joinPointer(prefix, op.path)
    }));
  }

  /**
 * Join a base pointer prefix with an operation path ensuring correct escaping.
 * @param {string} prefix - The base pointer prefix.
 * @param {string} opPath - The operation path.
 * @returns {string} The joined pointer.
 */
  static joinPointer(prefix: string, opPath: string): string {
    if (!prefix) return opPath;
    const normalizedPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`;
    return `${this.escapeSegmentPath(normalizedPrefix)}${opPath}`;
  }

  /**
 * Escape a JSON Pointer segment according to RFC 6901.
 * @param {string} pointer - The JSON Pointer to escape.
 * @returns {string} The escaped JSON Pointer.
 */
  static escapeSegmentPath(pointer: string): string {
    return pointer
      .split('/')
      .map((segment, idx) => idx === 0 ? segment : segment.replace(/~/g, '~0').replace(/\//g, '~1'))
      .join('/');
  }

  /**
 * Validate JSON Patch operations. The structural checks run in both modes. With `strict`,
 * the `op` must be an RFC 6902 operation code, and `add`, `replace`, and `test` must carry
 * a `value`.
 * @param {PatchOperation[]} operations - The operations to validate.
 * @param {boolean} [strict=false] - Apply the RFC 6902 checks of {@link JSONPatchApplyOptions.strict}.
 * @returns {MethodError | null} A MethodError if validation fails, otherwise null.
 */
  static validateOperations(operations: PatchOperation[], strict: boolean = false): MethodError | null {
    if (!Array.isArray(operations)) return new MethodError('Operations must be an array', 'JSON_PATCH_VALIDATION_ERROR');
    for (const op of operations) {
      if (!op || typeof op !== 'object') return new MethodError('Operation must be an object', 'JSON_PATCH_VALIDATION_ERROR');
      if (typeof op.op !== 'string') return new MethodError('Operation.op must be a string', 'JSON_PATCH_VALIDATION_ERROR');
      if (typeof op.path !== 'string') return new MethodError('Operation.path must be a string', 'JSON_PATCH_VALIDATION_ERROR');
      if (strict && !PATCH_OP_CODES.has(op.op)) {
        return new MethodError(`Operation.op is not an RFC 6902 operation: ${op.op}`, 'JSON_PATCH_VALIDATION_ERROR');
      }
      if (strict && OPS_WITH_VALUE.has(op.op) && op.value === undefined) {
        return new MethodError(`Operation.value is required for op=${op.op}`, 'JSON_PATCH_VALIDATION_ERROR');
      }
      const unsafePathSegment = findUnsafeSegment(op.path);
      if (unsafePathSegment) {
        return new MethodError(
          `Operation.path traverses prototype machinery: ${unsafePathSegment}`, 'JSON_PATCH_VALIDATION_ERROR'
        );
      }
      if ((op.op === 'move' || op.op === 'copy') && typeof op.from !== 'string') {
        return new MethodError(`Operation.from must be a string for op=${op.op}`, 'JSON_PATCH_VALIDATION_ERROR');
      }
      if (typeof op.from === 'string') {
        const unsafeFromSegment = findUnsafeSegment(op.from);
        if (unsafeFromSegment) {
          return new MethodError(
            `Operation.from traverses prototype machinery: ${unsafeFromSegment}`, 'JSON_PATCH_VALIDATION_ERROR'
          );
        }
      }
    }
    return null;
  }
}
