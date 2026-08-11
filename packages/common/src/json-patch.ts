import type { Operation } from 'fast-json-patch';
import jsonPatch from 'fast-json-patch';
import { MethodError } from './errors.js';
import type { JSONObject } from './types.js';

const { applyPatch, compare, deepClone } = jsonPatch;

export type PatchOpCode = 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';

/** Maximum operations in a single JSON Patch. */
export const MAX_PATCH_OPERATIONS = 1024;
/** Maximum length of an operation's JSON Pointer path (and of a move/copy `from` pointer). */
export const MAX_PATCH_PATH_LENGTH = 2048;
/** Maximum JSON-serialized size of an operation's value, in UTF-8 bytes. */
export const MAX_PATCH_VALUE_BYTES = 256 * 1024;
/**
 * Maximum aggregate size of a patch, in UTF-8 bytes: the sum of each operation's
 * serialized value plus its path and `from` pointer lengths. The per-operation
 * caps alone (1024 operations x 256 KiB) would allow roughly 256 MiB of patch
 * work; this budget bounds the whole patch to 1 MiB.
 */
export const MAX_PATCH_TOTAL_BYTES = 1024 * 1024;

/**
 * A JSON Patch operation, as defined in {@link https://datatracker.ietf.org/doc/html/rfc6902 | RFC 6902}.
 */
export interface PatchOperation {
  op: PatchOpCode;
  path: string;
  value?: unknown; // Required for add, replace, test
  from?: string; // Required for move, copy
}

/**
 * Thin wrapper around fast-json-patch to keep a stable API within this package.
 * @class JSONPatch
 * @type {JSONPatch}
 */
export class JSONPatch {
  /**
   * Applies a JSON Patch to a source document and returns the patched document.
   * Does not mutate the input document.
   * @param {JSONObject} sourceDocument - The source JSON document to apply the patch to.
   * @param {PatchOperation[]} operations - The JSON Patch operations to apply.
   * @returns {JSONObject} The patched JSON document.
   */
  static apply(
    sourceDocument: Record<any, any>,
    operations: PatchOperation[],
    options: { mutate?: boolean; clone?: (value: any) => any } = {}
  ): Record<any, any> {
    const mutate = options.mutate ?? false;
    const cloneFn = options.clone ?? deepClone;
    const docClone = mutate ? sourceDocument : cloneFn(sourceDocument);
    const validationError = this.validateOperations(operations);
    if (validationError) {
      throw new MethodError('Invalid JSON Patch operations', 'JSON_PATCH_APPLY_ERROR', { error: validationError });
    }
    try {
      const result = applyPatch(docClone, operations as Operation[], false, mutate);
      if (result.newDocument === undefined) {
        throw new MethodError('JSON Patch application failed', 'JSON_PATCH_APPLY_ERROR', { result });
      }
      return result.newDocument as JSONObject;
    } catch (error) {
      throw new MethodError('JSON Patch application failed', 'JSON_PATCH_APPLY_ERROR', { error });
    }
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
   * Validate JSON Patch operations.
   *
   * Beyond shape checks, patches carried by untrusted DID updates are bounded
   * in count, path (and `from`) length, per-value size, and total serialized
   * size so a hostile update cannot force unbounded patch work. Sizes are
   * measured in UTF-8 bytes, the on-the-wire unit.
   *
   * @param {PatchOperation[]} operations - The operations to validate.
   * @returns {MethodError | null} A MethodError if validation fails, otherwise null.
   */
  static validateOperations(operations: PatchOperation[]): MethodError | null {
    if (!Array.isArray(operations)) return new MethodError('Operations must be an array', 'JSON_PATCH_VALIDATION_ERROR');
    if (operations.length > MAX_PATCH_OPERATIONS) {
      return new MethodError(`Too many operations: ${operations.length} > ${MAX_PATCH_OPERATIONS}`, 'JSON_PATCH_VALIDATION_ERROR');
    }
    const encoder = new TextEncoder();
    let totalBytes = 0;
    for (const op of operations) {
      if (!op || typeof op !== 'object') return new MethodError('Operation must be an object', 'JSON_PATCH_VALIDATION_ERROR');
      if (typeof op.op !== 'string') return new MethodError('Operation.op must be a string', 'JSON_PATCH_VALIDATION_ERROR');
      if (typeof op.path !== 'string') return new MethodError('Operation.path must be a string', 'JSON_PATCH_VALIDATION_ERROR');
      if (op.path.length > MAX_PATCH_PATH_LENGTH) {
        return new MethodError(`Operation.path too long: ${op.path.length} > ${MAX_PATCH_PATH_LENGTH}`, 'JSON_PATCH_VALIDATION_ERROR');
      }
      if (op.op === 'move' || op.op === 'copy') {
        if (typeof op.from !== 'string') {
          return new MethodError(`Operation.from must be a string for op=${op.op}`, 'JSON_PATCH_VALIDATION_ERROR');
        }
        if (op.from.length > MAX_PATCH_PATH_LENGTH) {
          return new MethodError(`Operation.from too long: ${op.from.length} > ${MAX_PATCH_PATH_LENGTH}`, 'JSON_PATCH_VALIDATION_ERROR');
        }
      }
      totalBytes += encoder.encode(op.path).length
        + (typeof op.from === 'string' ? encoder.encode(op.from).length : 0);
      if (op.value !== undefined) {
        let valueBytes: number;
        try {
          valueBytes = encoder.encode(JSON.stringify(op.value)).length;
        } catch {
          return new MethodError('Operation.value is not JSON-serializable', 'JSON_PATCH_VALIDATION_ERROR');
        }
        if (valueBytes > MAX_PATCH_VALUE_BYTES) {
          return new MethodError(`Operation.value too large: ${valueBytes} > ${MAX_PATCH_VALUE_BYTES} bytes`, 'JSON_PATCH_VALIDATION_ERROR');
        }
        totalBytes += valueBytes;
      }
      if (totalBytes > MAX_PATCH_TOTAL_BYTES) {
        return new MethodError(`Patch too large: ${totalBytes} > ${MAX_PATCH_TOTAL_BYTES} bytes total`, 'JSON_PATCH_VALIDATION_ERROR');
      }
    }
    return null;
  }
}
