import { applyPatch, compare, deepClone, Operation } from 'fast-json-patch';
import { MethodError } from './errors.js';
import { PatchOperation } from './interfaces.js';
import { JSONObject } from './types.js';

/**
 * Thin wrapper around fast-json-patch to keep a stable API within this package.
 */
export class Patch {
  /**
   * Applies a JSON Patch to a source document and returns the patched document.
   * Does not mutate the input document.
   */
  public apply(sourceDocument: JSONObject, operations: PatchOperation[]): JSONObject {
    const docClone = deepClone(sourceDocument);
    const result = applyPatch(docClone, operations as Operation[], true, false);

    if (result?.errors?.length) {
      throw new MethodError('JSON Patch validation failed', 'JSON_PATCH_APPLY_ERROR', { errors: result.errors });
    }
    if (result.test === false) {
      throw new MethodError('JSON Patch test operation failed', 'JSON_PATCH_APPLY_ERROR', { result });
    }
    if (result.newDocument === undefined) {
      throw new MethodError('JSON Patch application failed', 'JSON_PATCH_APPLY_ERROR', { result });
    }

    return result.newDocument as JSONObject;
  }

  /**
   * Constructs a JSON Patch array from a list of operations.
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
