import jsonPatch, { Operation } from 'fast-json-patch';
import { MethodError } from './errors.js';
import { PatchOperation } from './interfaces.js';
import { JSONObject } from './types.js';

const { applyPatch, compare, deepClone } = jsonPatch;

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
      const result = applyPatch(docClone, operations as Operation[], true, mutate);
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
 * @param {PatchOperation[]} operations - The operations to validate.
 * @returns {Error | null} An Error if validation fails, otherwise null.
 */
  static validateOperations(operations: PatchOperation[]): Error | null {
    if (!Array.isArray(operations)) return new Error('Operations must be an array');
    for (const op of operations) {
      if (!op || typeof op !== 'object') return new Error('Operation must be an object');
      if (typeof op.op !== 'string') return new Error('Operation.op must be a string');
      if (typeof op.path !== 'string') return new Error('Operation.path must be a string');
      if ((op.op === 'move' || op.op === 'copy') && typeof op.from !== 'string') {
        return new Error(`Operation.from must be a string for op=${op.op}`);
      }
    }
    return null;
  }
}
