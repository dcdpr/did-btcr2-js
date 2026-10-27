/**
 * The text of a caller value for an error message, or `undefined` for an object or a function.
 * An error message prints a primitive value, and the error `data` holds every value. `String()`
 * throws a TypeError for an object with no usable `toString` or `valueOf`, for example the JSON
 * value `{"toString":1}`. The text of another object, for example `[object Object]`, gives the
 * reader no information. The function uses `String()` and not a template literal, because a
 * template literal throws for a Symbol.
 * @param value - The value that the user gave.
 * @returns The text of a primitive value, or `undefined`.
 */
export function messageText(value: unknown): string | undefined {
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') return undefined;
  return String(value);
}
