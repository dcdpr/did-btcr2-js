---
title: "ADR 052: Cross-Process File Locking for the CLI Keystore"
---

# ADR 052: Cross-Process File Locking for the CLI Keystore

**Status:** Accepted

**Date:** 2026-06-26

**Branch / PR:** `fix/cli-keystore-file-locking`

**References:** [ADR 013](013-cli-per-command-dependency-injection.md), [ADR 047](047-cli-encrypted-keystore.md), [ADR 048](048-cli-config-profile-model.md)

## Context

The CLI keystore ([ADR 047](047-cli-encrypted-keystore.md)) is a file-backed key-value store. The store loads the whole encrypted file into memory once, at construction, and rewrites the whole file on every mutation (adding or importing a key, removing one, clearing, or moving the active-key pointer). The write is atomic: it serializes to a sibling temporary file and renames it over the target, so a reader, or a crash mid-write, can never observe a torn or half-written file.

Atomicity of a single write is not isolation between writers. Every `btcr2` invocation is a separate process that loads the file once and never reloads it. Two invocations whose lifetimes overlap, two parallel key generations, or a generate in one shell while another shell removes a key, each hold a snapshot taken at their own load. Whichever process flushes last writes its snapshot over the other's change, and the other change is silently gone. This is the classic lost-update read-modify-write race. Because the asset at stake is secret key material, a dropped key is data loss: a key the user believes they generated, with a controllable identifier minted against it, can vanish with no error.

The atomic rename closes the torn-file window. It does nothing for the lost-update window, which is the actual defect.

## Decision

### 1. Serialize mutations with an exclusive cross-process lock

Each of the four mutating store operations runs while holding an exclusive lock, so at most one process mutates the keystore at a time. The lock is the missing isolation the atomic write cannot provide on its own.

### 2. Reload inside the lock, then apply and flush

The lock alone is insufficient: a process that loaded a stale snapshot before acquiring the lock would still flush that stale state over a newer one. So every mutation, while holding the lock, re-reads the file from disk, applies its change on top of that fresh state, and flushes the result. Concurrent additions and deletions now merge instead of clobbering: both added keys survive, and a key one process deleted is not resurrected by another's stale snapshot.

### 3. A hand-rolled O_EXCL lockfile, no dependency

The lock is a sibling lockfile created with `O_CREAT | O_EXCL`: the create fails when the file already exists, and that failure is the mutual-exclusion primitive. We did not take a dependency for this. A general locking library is async and callback-oriented, which fights the synchronous store contract; the logic here is a few dozen lines of well-understood filesystem calls; and the monorepo keeps its dependency surface small. File locking is not a cryptographic primitive, so this is a dependency-minimization call, not the no-external-crypto rule.

### 4. Wait synchronously

The store's key-value contract is synchronous, so the lock acquisition waits with a blocking, non-spinning sleep rather than yielding a promise. The wait blocks the thread for the retry interval instead of busy-looping. The keystore is already a Node-only component, so a synchronous, Node-only wait carries no browser-compatibility cost.

### 5. Break abandoned locks

A process that crashes while holding the lock must not wedge every future invocation. A held lock is broken when its writer process is no longer running (probed with a no-op signal) or when it has aged past a stale threshold. The lockfile records a per-acquisition token, and a holder only ever deletes a lockfile that still carries its own token, so a lock another process legitimately broke as stale is never removed out from under the process that re-took it.

### 6. Reads stay lock-free

Only the four mutations lock. Reads (get, has, list, entries, the active-key lookup) and store construction do not, because the atomic rename already guarantees a reader sees a complete file, old or new. The common commands (resolve, sign, list) pay nothing for the lock. The expensive secret-sealing key derivation also runs before the lock is taken, so the locked critical section is just the reload and flush, keeping the contention window small.

## Consequences

- Two overlapping invocations compose instead of corrupting: both generated keys are kept, and a delete in one process does not undo a delete in another. The silent data-loss window is closed.
- A crashed writer self-heals. The next invocation breaks the stale lock, immediately when the prior holder's process is gone, or after the stale threshold otherwise, rather than failing forever.
- A new, visible failure mode replaces silent corruption: under sustained contention a mutation times out with a clear error stating another process holds the lock and how to recover. A loud, recoverable error is the correct outcome.
- The lock is a transient sibling file, always removed on release, so the existing on-disk invariants (file mode, no leftover temporary files) are unaffected.
- Windows is covered: both the exclusive-create and the process-liveness probe work there; the keystore already warns separately that POSIX permission bits are not enforced on Windows.

## Rejected alternatives

- **Keep the atomic rename alone.** It prevents torn files but not lost updates, which is the entire bug. Rejected as the status quo being fixed.
- **Depend on a file-locking library.** More built-in features (retry policies, lock-file mtime refresh) but async and callback-oriented against a synchronous store, and another dependency for logic that is short and well understood here.
- **Use `flock`-style advisory OS locks.** Node's filesystem API does not expose `flock` without a native addon. An `O_EXCL` lockfile is portable across POSIX and Windows with no addon.
- **Lock reads as well.** Unnecessary: the atomic rename already gives readers a consistent file, so locking the read path would only slow the common resolve, sign, and list commands for no correctness gain.
- **Hold one long-lived lock for the whole process.** A larger blast radius and a worse abandoned-lock story. Per-mutation locks keep the held window to a single reload-and-flush.
