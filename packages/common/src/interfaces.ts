export type JsonPatch = Array<PatchOperation>;
export type PatchOpCode = 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test' | (string & {});
/**
 * A JSON Patch operation, as defined in {@link https://datatracker.ietf.org/doc/html/rfc6902 | RFC 6902}.
 */
export interface PatchOperation {
  op: PatchOpCode;
  path: string;
  value?: unknown; // Required for add, replace, test
  from?: string; // Required for move, copy
}
