import { applyPatch, compare, deepClone, Operation } from 'fast-json-patch';
import { MethodError } from './errors.js';
import { PatchOperation } from './interfaces.js';
import { JSONObject } from './types.js';

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
  public apply(sourceDocument: JSONObject, operations: PatchOperation[]): JSONObject {
    const docClone = deepClone(sourceDocument);
    try {
      const result = applyPatch(docClone, operations as Operation[], true, false);
      if (result.newDocument === undefined) {
        throw new MethodError('JSON Patch application failed', 'JSON_PATCH_APPLY_ERROR', { result });
      }
      return result.newDocument as JSONObject;
    } catch (error) {
      throw new MethodError('JSON Patch application failed', 'JSON_PATCH_APPLY_ERROR', { error });
    }
  }

  /**
   * Constructs a JSON Patch array from a list of operations.
   * @param {PatchOperation[]} patches - The list of patch operations.
   * @returns {PatchOperation[]} The constructed JSON Patch array.
   */
  public create(patches: PatchOperation[]): PatchOperation[] {
    return patches.map(({ op, path, value, from }) => {
      const operation: PatchOperation = { op, path };

      if (value !== undefined) {
        operation.value = value;
      }

      if (from !== undefined) {
        operation.from = from;
      }

      return operation;
    });
  }

  /**
   * Compute a JSON Patch diff from source => target.
   * @param {JSONObject} sourceDocument - The source JSON document.
   * @param {JSONObject} targetDocument - The target JSON document.
   * @param {string} [path] - An optional base path to prefix to each operation.
   * @returns {PatchOperation[]} The computed JSON Patch operations.
   */
  public diff(sourceDocument: JSONObject, targetDocument: JSONObject, path: string = ''): PatchOperation[] {
    const ops = compare(sourceDocument ?? {}, targetDocument ?? {}) as PatchOperation[];
    if (!path) return ops;

    const prefix = path.endsWith('/') ? path.slice(0, -1) : path;
    return ops.map(op => ({
      ...op,
      path : `${prefix}${op.path}`
    }));
  }
}
