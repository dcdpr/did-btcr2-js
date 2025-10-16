import { PatchOperation } from './interfaces.js';
import { JSONObject } from './types.js';
import { MethodError } from './errors.js';

/**
 * Implementation of {@link https://datatracker.ietf.org/doc/html/rfc6902 | IETF RFC 6902 JSON Patch}.
 *
 * JavaScript Object Notation (JSON) Patch defines a JSON document structure for expressing a sequence of operations to
 * apply to a JavaScript Object Notation (JSON) document; it is suitable for use with the HTTP PATCH method. The
 * "application/json-patch+json" media type is used to identify such patch documents.
 *
 * @class Patch
 * @type {Patch}
 */
export class Patch {
  /**
   * Applies a JSON Patch to a source document and returns the patched document.
   * @param {JSONObject} sourceDocument The source document to patch.
   * @param {PatchOperation[]} operations The JSON Patch operations to apply.
   * @returns {JSONObject} The patched document.
   * @throws {Error} If an unsupported operation is provided.
   */
  public apply(sourceDocument: JSONObject, operations: PatchOperation[]): JSONObject {
    const patchedDocument = JSON.normalize(sourceDocument);

    for (const operation of operations) {
      const { op, path, value, from } = operation;

      const segments = path.split('/').slice(1);

      switch (op) {
        case 'add':
          this.setValue(patchedDocument, segments, value);
          break;

        case 'remove':
          this.removeValue(patchedDocument, segments);
          break;

        case 'replace':
          this.setValue(patchedDocument, segments, value);
          break;

        case 'move':{
          if (!from) throw new Error('Missing \'from\' in move operation');
          const fromSegments = from.split('/').slice(1);
          const movedValue = this.getValue(patchedDocument, fromSegments);
          this.removeValue(patchedDocument, fromSegments);
          this.setValue(patchedDocument, segments, movedValue);
          break;
        }
        case 'copy':{
          if (!from) throw new Error('Missing \'from\' in copy operation');
          const copiedValue = this.getValue(patchedDocument, from.split('/').slice(1));
          this.setValue(patchedDocument, segments, copiedValue);
          break;

        }
        case 'test':{
          const existingValue = this.getValue(patchedDocument, segments);
          if (JSON.stringify(existingValue) !== JSON.stringify(value)) {
            throw new MethodError(`Test operation failed at path`, 'JSON_PATCH_APPLY_ERROR', { path });
          }
          break;
        }
        default:
          throw new MethodError(`Unsupported JSON Patch operation`, 'JSON_PATCH_APPLY_ERROR', { op });
      }
    }

    return patchedDocument;
  }

  /**
 * Constructs a JSON Patch with a single operation (e.g. add service).
 * @param {PatchOperation} patches - The patch operation to create.
 * @param {string} patch.op - The patch operation type (e.g. 'add').
 * @param {string} patch.path - The JSON Pointer path to apply the operation.
 * @param {*} patch.value - The value to apply (if applicable).
 * @returns {PatchOperation[]} A single-entry JSON Patch array.
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
   * Find the diff between a source and target document constructing the patch operations from source => target.
   * @param {JSONObject} sourceDocument The original JSON object.
   * @param {JSONObject} targetDocument The target JSON object to transform into.
   * @returns {PatchOperation[]} An array of JSON Patch operations.
   */
  public diff(sourceDocument: JSONObject, targetDocument: JSONObject, path: string): PatchOperation[] {
    const operations: Array<PatchOperation> = [];
    const sourceKeys = new Set(Object.keys(sourceDocument || {}));
    const targetKeys = new Set(Object.keys(targetDocument || {}));

    // Handle removed keys
    for (const key of sourceKeys) {
      if (!targetKeys.has(key)) {
        operations.push({ op: 'remove', path: `${path}/${key}` });
      }
    }

    // Handle added or updated keys
    for (const key of targetKeys) {
      const sourceVal = sourceDocument?.[key];
      const targetVal = targetDocument?.[key];
      const currentPath = `${path}/${key}`;

      if (!(key in (sourceDocument || {}))) {
        operations.push({ op: 'add', path: currentPath, value: targetVal });
      } else if (typeof sourceVal === 'object' && sourceVal !== null && typeof targetVal === 'object' && targetVal !== null) {
        operations.push(...this.diff(sourceVal, targetVal, currentPath));
      } else if (JSON.stringify(sourceVal) !== JSON.stringify(targetVal)) {
        operations.push({ op: 'replace', path: currentPath, value: targetVal });
      }
    }

    return operations;
  }

  /**
   * Gets the value at a given path in an object.
   * @private
   * @param {*} obj The object to get the value from.
   * @param {string[]} path The path to the value.
   * @returns {*} The value at the given path.
   */
  private getValue(obj: any, path: string[]): any {
    return path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
  }


  /**
   * Sets the value at a given path in an object.
   * @private
   * @param {*} obj The object to set the value in.
   * @param {string[]} path The path to the value.
   * @param {*} value The value to set.
   * @returns {*} The object with the value set.
   */
  private setValue(obj: any, path: string[], value: any): void {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (!(key in current)) current[key] = {};
      current = current[key];
    }
    current[path[path.length - 1]] = value;
  }


  /**
   * Removes the value at a given path in an object.
   * @private
   * @param {*} obj The object to remove the value from.
   * @param {string[]} path The path to the value.
   * @returns {*} The object with the value removed.
   */
  private removeValue(obj: any, path: string[]): void {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (!(key in current)) return;
      current = current[key];
    }
    delete current[path[path.length - 1]];
  }
}