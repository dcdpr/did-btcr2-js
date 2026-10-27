/**
 * The text of a caller value for an error message, or `undefined` for an object or a function.
 * An error message prints a primitive value, and the error `data` holds every value. `String()`
 * throws a TypeError for an object with no usable `toString` or `valueOf`, for example
 * `Object.create(null)` or the JSON value `{"toString":1}`. The text of another object, for
 * example `[object Object]`, gives the reader no information. The function uses `String()` and
 * not a template literal, because a template literal throws for a Symbol.
 * @param {unknown} value The value that the caller gave.
 * @returns {string | undefined} The text of a primitive value, or `undefined`.
 */
export function messageText(value: unknown): string | undefined {
  if((typeof value === 'object' && value !== null) || typeof value === 'function') return undefined;
  return String(value);
}

/**
 * The end of an option message: `, got ` and the value, a string in quotes and another primitive
 * as is. An object or a function gives no text (see {@link messageText}); `data` holds the value.
 * @param {unknown} value The value that the caller gave.
 * @returns {string} The text, or an empty string for an object or a function.
 */
export function gotValue(value: unknown): string {
  const text = typeof value === 'string' ? JSON.stringify(value) : messageText(value);
  return text === undefined ? '' : `, got ${text}`;
}
