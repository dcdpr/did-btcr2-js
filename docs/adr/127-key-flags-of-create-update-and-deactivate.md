# ADR 127: The Key Flags of create, update, and deactivate, and One Default Key

- **Status:** Accepted
- **Date:** 2026-09-28
- **Packages:** `@did-btcr2/cli` (MINOR, breaking: `--signing-key` is no longer a global flag)

## Context

Three commands take a key from the keystore:

- `create` encodes the public key of the key in a `k` identifier. It signs nothing.
- `update` and `deactivate` sign with the key.

The global flag `--signing-key <ref>` selected the key for all three commands. This design had three problems:

1. **The flag was not in the help of the commands.** A global flag shows only in `btcr2 -h`. `btcr2 create -h`, `btcr2 update -h`, and `btcr2 deactivate -h` did not show it.
2. **The name of the flag was wrong for `create`.** `create` is an offline step, and it needs a public key, not a signing key.
3. **`create` and `update` had different default keys.** Without the flag, `update` signed with the `identity.default` of the active profile, else the active key. Without the flag, `create` generated a new key. So `btcr2 key generate --set-active` followed by `btcr2 create` made a second key, and the active key could not update the new identifier.

## Decision

**`create` takes a stored key with the command flag `-k, --key <ref>`.** The value is a key reference: a key URN, a unique name, or a unique fingerprint prefix. It resolves in the same order as the `<ref>` argument of `key show`, `key export`, `key delete`, and `key use`. The command reads the public key only, so it never asks for the passphrase. A watch-only key is valid.

**`--signing-key <ref>` is a command flag of `update` and `deactivate`.** It is no longer a global flag. `btcr2 update -h` and `btcr2 deactivate -h` show it.

**The three commands use one default key.** If the key flag is absent, the key is, in this order:

1. the `identity.default` of the active profile;
2. the active key of the keystore.

`create` generates a key only if neither exists. It then stores the key and sets it as the active key, so `update` and `deactivate` sign with it later. `resolveDefaultKeyRef` in `config.ts` implements the order for the three commands.

The input modes of `create -t k` are:

- `--bytes <hex>`: use the public key as hex, with no keystore;
- `--key <ref>`, else the default key: use the public key of the stored key;
- no `--bytes` and no default key: generate a key.

**Other checks.** An empty `--key` fails with `--key must not be empty.` `--key` with `-t x` fails with `--key applies only to deterministic identifiers (-t k).` `--key` with `--bytes` fails with `Provide at most one of --bytes or --key.`

## Alternatives

- **An argument: `btcr2 create <ref>`.** In a `create` command, an argument usually gives the name of the new object: `docker network create NAME`, `gh repo create NAME`, `git branch NAME`. So `btcr2 create demo` looks like "make an identifier with the name demo". The key is an input to `create`, not the new object.
- **`--from-key <ref>`.** The name shows that the key is a source, as in `kubectl create configmap NAME --from-file <path>`. But it is long and has no short form, and `--bytes` and `--document` do not use the `--from-*` form.
- **`--pubkey <ref>`.** The name says what `create` reads, as in `hal address create --pubkey <hex>`. But users would give a hex public key to it, and the hex public key goes to `--bytes`.
- **`--ref <ref>`.** It does not say "key". In git, a ref is a branch or a tag.
- **One flag name for the three commands.** `--signing-key` on `create` has the wrong meaning, and `--key` on `update` does not say that the key signs. Each command uses the name that says what the key does.
- **`create` uses the active key only, and fails if none exists.** Then `create` never writes the keystore. But the first run on a new keystore then needs a separate `key generate` step. The generation keeps the one-command start, and the new key becomes the default key.
- **`create` ignores `identity.default`.** Then a profile with an `identity.default` makes an identifier from the active key and signs its updates with another key. The update of the new identifier then fails.

The name `--key` follows tools that take a key as a flag: `cosign sign --key <file or KMS URI>` (for example `awskms://...`), `didkit key-to-did key -k <keyfile>`, and `cast wallet address --account <name>`.

## Consequences

**Positive.** Each command shows its key flag in its help. The command line does not use the word "signing" for an offline step. `btcr2 key generate --set-active`, `btcr2 create`, and `btcr2 update` use one key with no flag.

**Negative.** `create` without `--key` no longer always generates a key. To make an identifier from a new key, run `btcr2 key generate --set-active` first, or pass `--key` with the new key.

**Tests.** The `create` tests cover `--key` by URN and by fingerprint prefix, the active key as the default, `identity.default` before the active key, `--key` before `identity.default`, an unknown reference, an empty `--key`, `--key` with `-t x`, `--key` with `--bytes`, and `--key` in the help. The `update` tests cover `--signing-key` on `update` and on `deactivate`, and the flag in the help of the two commands. The `config` tests cover `resolveDefaultKeyRef`.
