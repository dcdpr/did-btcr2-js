/**
 * Best-effort zeroization of secret-bearing bytes. Overwrites the buffer in
 * place with zeros.
 *
 * In a managed-memory runtime (V8) this cannot guarantee every copy of the
 * secret is erased - the garbage collector may relocate buffers and we cannot
 * wipe copies the runtime makes internally. What it does guarantee is that the
 * specific buffer handed in no longer holds the secret, which shortens the
 * in-memory exposure window and prevents reuse or serialization of spent
 * secret material. Use it on transient secret copies (e.g. the raw bytes pulled
 * from a keypair for a single signing operation) as soon as the operation
 * returns.
 *
 * @param {Uint8Array | undefined | null} bytes The buffer to zero. No-op if nullish.
 * @returns {void}
 */
export function wipe(bytes: Uint8Array | undefined | null): void {
  if(bytes) bytes.fill(0);
}
