# ADR 126: The cli Requires Node.js 24.7 for the Native argon2, and the Keystore Checks the Passphrase Once for Each Seal

- **Status:** Accepted
- **Date:** 2026-09-28
- **Packages:** `@did-btcr2/cli` (MINOR, breaking: `engines.node` is `>=24.7.0`)

## Context

`btcr2 key generate` on an encrypted keystore took 5.2 seconds. `btcr2 init` took 2.5 seconds, and `btcr2 keystore unlock` took 1.9 seconds. A session (ADR 081) did not make `key generate` faster, because the time is not in the prompt.

The time is in argon2id. The keystore derived each envelope key with argon2id from `@noble/hashes` (ADR 047), with `DEFAULT_ARGON_PARAMS`: 3 passes, 64 MiB, 4 lanes. On Node.js 24.19, one call takes 1.7 to 2.4 seconds. JavaScript runs the 4 lanes on one thread, so the lanes add no speed.

`FileKeyStore.set()` on an established keystore made three argon2id calls:

1. `#sealPassphrase` opens the verifier to check the passphrase (ADR 080).
2. `encryptSecret` seals the new secret under a fresh salt.
3. In the write lock, `set()` opens the verifier again with the same passphrase.

Call 3 opens the same verifier envelope as call 1, because `set()` first makes sure that the verifier on disk is the same envelope as the one at seal time. The result of call 3 is always the result of call 1. Also, call 3 runs in the write lock, but the comment of `#mutate` says that a caller must do the slow work before it takes the lock.

Node.js 24.7.0 and later have `crypto.argon2Sync`. With the production parameters, it takes 135 ms, and its output is the same as the output of `@noble/hashes`. Node.js 24 is the active LTS line. Node.js 22 and Node.js 24.0 to 24.6 do not have the function.

## Decision

**The cli requires Node.js 24.7 or later.** `engines.node` of `@did-btcr2/cli` is `>=24.7.0`. The bin `btcr2` checks `process.versions.node` before it imports the cli. On an older runtime, it writes `btcr2 needs Node.js 24.7 or later. This runtime is Node.js <version>.` to stderr and exits with code 1. Without the check, the module loader of an older runtime stops with a `SyntaxError` about the missing export `argon2Sync`. The CJS build (`tsup`) targets `node24`. The dev dependency `@types/node` of the cli moves to `^24.19.0`, which declares `argon2Sync`.

**The envelope uses only the native argon2 of Node.js.** `argon2idKey` in `keystore/envelope.ts` calls `argon2Sync('argon2id', ...)` from `node:crypto`. The envelopes of cli 0.25 and earlier came from `argon2id` of `@noble/hashes`. The two functions give the same bytes, so an existing keystore opens with no migration. A unit test compares the two functions.

**`set()` checks the passphrase once against a verifier.** In the lock, `set()` opens the verifier only if the keystore had no verifier at seal time. That case is a concurrent establishment: another writer wrote a verifier after the seal and before the lock. The rotation check stays: if the verifier on disk is not the same envelope as the one at seal time, `set()` throws `KEYSTORE_CONCURRENT_CHANGE_ERROR`.

**The repository develops and tests on Node.js 24.** The private root `package.json` has `engines.node` `>=24.7.0`, and the CI workflow uses Node.js `24.x`. The nine library packages keep `engines.node` `>=22.0.0`: they do not use `argon2Sync`, and `method`, `api`, and `aggregation` also run in a browser.

The envelope format, the argon2id parameters, the verifier rules of ADR 080, and the session of ADR 081 do not change.

## Alternatives

- **Keep a fallback to `@noble/hashes` for Node.js 22.** The fallback keeps two code paths for one key derivation, and each call on Node.js 22 keeps the slow speed. Node.js 24 is the LTS line, so the cli does not need the fallback.
- **The Node.js 24.7 floor for all packages.** A higher floor is a breaking change. Each published package then needs a breaking bump: a MAJOR for `common` and `cryptosuite`, and a MINOR for each package at 0.x. The libraries do not need the function.
- **Lower the argon2id parameters.** The OWASP minimum (2 passes, 19 MiB, 1 lane) takes 0.36 seconds in JavaScript. But the parameters set the cost of an offline attack on a stolen keystore file. The slow part was the implementation and the extra call, not the parameters.
- **One derived key for all secrets.** One argon2id call would then open the verifier and seal the secret. ADR 080 rejected this: it changes the format, and it removes the independent seal of each secret.
- **A native addon, for example the `argon2` npm package.** It adds a native dependency with a build step or a prebuilt binary for each platform. The built-in function of Node.js needs no dependency.
- **Skip the verifier check before the open of a secret.** The AEAD check of the secret also proves the passphrase. But ADR 080 requires the verifier check first, so that a wrong passphrase gives the clear error `Incorrect passphrase`. With the native argon2, the extra call costs 135 ms.

## Consequences

**Positive.** On Node.js 24.19 on the development machine:

| Command | Before | After |
|---|---|---|
| `init` (new encrypted keystore) | 2.5 s | 0.5 s |
| `key generate` | 5.2 s | 0.42 s |
| `keystore unlock` | 1.9 s | 0.29 s |

An argon2id call no longer runs in the write lock of `set()` on an established keystore. So a concurrent writer waits less. The key derivation has one code path.

**Negative.** A cli user on Node.js 22 must upgrade Node.js. CI no longer runs the library packages on Node.js 22, although their `engines` field still includes it.

**Tests.** The envelope test compares `argon2idKey` with `argon2id` of `@noble/hashes`, with 1 lane and with 4 lanes. Three lifecycle tests start a second writer in `getPassphrase`, between the seal and the lock:

- a concurrent `change-passphrase` gives `KEYSTORE_CONCURRENT_CHANGE_ERROR`;
- a concurrent establishment with a different passphrase gives `Incorrect passphrase` and writes no key;
- a concurrent establishment with the same passphrase keeps the key.

Before this ADR, no test covered these branches of `set()`.
