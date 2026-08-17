---
title: "ADR 087: The Bitcoin RPC Password Has No Command-Line Flag"
---

# ADR 087: The Bitcoin RPC Password Has No Command-Line Flag

**Status:** Accepted

**Date:** 2026-08-19

**Branch / PR:** `fix/critical-high-security-findings`

**Supersedes:** [ADR 077](077-cli-rpc-secret-handling.md)

**References:** [ADR 047](047-cli-encrypted-keystore.md), [ADR 074](074-cli-config-resolution-correctness.md), [ADR 076](076-cli-io-passthrough-knobs.md), [ADR 080](080-keystore-lifecycle-and-dev-keystores.md)

## Context

The cli accepted the Bitcoin Core RPC password as a global command-line option,
`--btc-rpc-pass <pass>`. A value passed there is readable by any local user for
the lifetime of the process, through `ps` and `/proc/<pid>/cmdline`, and it
outlives the process in shell history, in CI job logs, and in whatever process
accounting the host keeps. None of those are places a credential can be revoked
from. The same global surface carries `--btc-rpc-wallet`, so in practice the RPC
credential grants wallet-level access to the node: the exposure is not limited to
read-only chain queries.

[ADR 077](077-cli-rpc-secret-handling.md) addressed the two other weaknesses of
this credential (it printed in the clear from `config get`/`config list`, and it
had to live literally in `config.json`) by adding display redaction and an
`env:<VAR>` / `file:<path>` secret reference plus a `BTCR2_BTC_RPC_PASS_FILE`
fallback. It treated the flag itself as given: its context section describes the
password as flowing "correctly through the flag -> env -> profile ->
per-network-default precedence", and removal of the flag does not appear even
among its rejected alternatives. That leaves ADR 077 describing a flag layer that
this decision retires, which is why this ADR supersedes it rather than amending
it. Everything else ADR 077 decided (redaction by default with `--show-secrets`,
the secret-ref forms, the documented plaintext-at-rest tradeoff, and the refusal
to encrypt `config.json` or fold RPC credentials into the keystore) stands
unchanged.

The keystore passphrase, the cli's other secret, has never been accepted from a
flag: `acquirePassphrase` reads it from `BTCR2_KEYSTORE_PASSPHRASE`, from a file
named by `--passphrase-file`, or from an interactive prompt
(`packages/cli/src/keystore/passphrase.ts:42-70`). The RPC password was the one
secret in the cli that argv could carry.

## Decision

### 1. The flag is removed, and so is the field that parsed it

`--btc-rpc-pass` is gone from the global option list (`packages/cli/src/cli.ts:56`,
where a comment now stands in its place explaining why nothing may be registered
there), and `btcRpcPass` is gone from `GlobalOptions`
(`packages/cli/src/types.ts:100`), the interface that models what commander parses
off argv. The type no longer has a slot for an argv-supplied password, so
re-introducing one is a type change and not an oversight.

The three surviving channels, none of which touch argv:

- `BTCR2_BTC_RPC_PASS`, read by `readEnvOverrides` (`packages/cli/src/config.ts:273`).
- `BTCR2_BTC_RPC_PASS_FILE`, naming a file whose contents are the password
  (`config.ts:809-814`), with at most one trailing newline trimmed so a file
  written by `echo` matches an inline value.
- A profile `btc.rpcPass` (`config.ts:360`) holding either a literal or an
  `env:<VAR>` / `file:<path>` secret reference resolved by `resolveSecretRef`
  (`config.ts:797-807`).

`ConnectionOverrides.btcRpcPass` (`config.ts:31`) is deliberately kept. It is the
internal carrier that the env and profile layers populate, and `defaultApiFactory`
is a programmatic entry point that an embedding application may call with its own
credentials. Only the argv-parsed type lost the field.

### 2. What ADR 074's atomic credential unit now implies

[ADR 074](074-cli-config-resolution-correctness.md) made the RPC url, username,
and password resolve as one unit: `resolveRpcUnit` (`config.ts:557-576`) picks the
highest-precedence layer that supplies a url, or failing that the highest that
supplies a username or password, and takes all three values from that one layer,
so a host from one layer is never handed another layer's credentials.

The removed flag was the only way to put a password into the **flag** layer, whose
`pass` slot (`config.ts:563`) is now permanently `undefined`. The consequence is
subtle enough to be worth stating outright:

> A `--btc-rpc-url` given on the command line selects the flag layer, so
> `BTCR2_BTC_RPC_PASS` is discarded along with the rest of the env layer. Its
> password comes from `BTCR2_BTC_RPC_PASS_FILE`, which is applied after the unit
> resolves (`config.ts:667`, `resolveSecretRef(rpcUnit?.pass) ?? readRpcPassFile()`)
> and is therefore the one layer-independent password channel.

That is not new behavior. The unit always dropped a lower layer's password when a
higher layer supplied the url; it is simply now the only path for a flag-given
url, so it is recorded here and pinned by a regression test. The pairings that
work:

| url from | password from |
|----------|---------------|
| `--btc-rpc-url` (flag) | `BTCR2_BTC_RPC_PASS_FILE` |
| `BTCR2_BTC_RPC_URL` (env) | `BTCR2_BTC_RPC_PASS`, or the pass file |
| profile `btc.rpcUrl` | profile `btc.rpcPass` (literal or `env:`/`file:` ref), or the pass file |
| no layer (network default host, e.g. regtest) | whichever layer supplies a credential, else the pass file |

### 3. Scope: what still reaches argv, and the rule going forward

Removing the flag does not put every secret off argv, and this ADR refuses to
claim otherwise. Three channels remain. They are recorded here as **accepted
operator-facing channels**, deliberately kept, not as holes that were closed:

1. **Credentials in the RPC url.** `--btc-rpc-url http://user:pass@host` is
   accepted with no validation (the cli parses no URL anywhere) and the userinfo
   is extracted into a Basic `Authorization` header at
   `packages/bitcoin/src/client/rpc/protocol.ts:71-80`. This is the conventional
   Bitcoin Core RPC url form, and it is documented and deliberately redacted
   everywhere it is printed: `scrubUrlUserinfo` masks it regardless of key name
   (`packages/cli/src/output.ts:23-25`), and the behavior is stated in
   `packages/cli/docs/config.md:60` and `:183` and in
   `packages/cli/docs/profile.md:94` and `:123`. Residual worth knowing: if the
   url fails to parse, `protocol.ts:82` logs the raw host, userinfo included, to
   stderr.
2. **Header passthrough options.** `--btc-rpc-header 'Authorization: ...'`
   (`packages/cli/src/cli.ts:68`) and the identical `--btc-rest-header`
   (`cli.ts:66`) carry arbitrary header values, which is the point of them
   ([ADR 076](076-cli-io-passthrough-knobs.md)); `packages/cli/README.md:293`
   documents the REST one as the way to pass an API key. A generic header
   passthrough cannot be typed as secret-bearing or not, so this stays.
3. **`config set` with a literal.** `btcr2 config set profiles.<name>.btc.rpcPass
   <literal>` takes the secret as a positional argv value
   (`packages/cli/src/commands/config.ts:56`), stores it as a raw string
   (`commands/config.ts:203`), and writes it to `config.json` in cleartext at mode
   0600 (`config.ts:158`); `resolveSecretRef` returns any value that is not
   `env:`-prefixed or `file:`-prefixed verbatim (`config.ts:806`). ADR 077
   deliberately kept a literal `rpcPass` working for local and regtest workflows,
   and that decision is unchanged. An operator who wants the secret off argv uses
   an `env:`/`file:` reference, or edits the file.

The rule this ADR sets for everything after it:

> **No new CLI option or positional argument may take a secret as its value.** A
> secret reaches the cli through an environment variable, through a file
> reference (`--*-file`, `env:`/`file:`, `BTCR2_*_FILE`), or through an
> interactive prompt.

Options that *name* a secret without carrying one remain fine: `--passphrase-file`
and `--secret-file` take a path, `--secret` and `--show-secrets` are booleans. The
three channels above are grandfathered by this ADR; they are not a precedent for
new ones.

### 4. A structural guard, and what it does not cover

`packages/cli/tests/cli-helpers.spec.ts:161-180` walks the whole command tree from
the root program and asserts that no value-taking option's long-flag leaf appears
in a six-name list (`pass`, `password`, `passphrase`, `secret`, `token`,
`credential`). It catches a re-added `--btc-rpc-pass` and the obvious new flag.
What it does not cover, verified:

- Leaf extraction is `(option.long ?? option.short ?? '').split('-').pop()`
  (`:171`) and membership is exact, so `--auth` (leaf `auth`, absent from the
  list), `--api-key` (leaf `key`), and a short-only `-p <password>` (leaf `p`) all
  pass the guard.
- It iterates `command.options` only and never `command.registeredArguments`, so
  it is structurally incapable of seeing a positional. Channel (3) above,
  `config set <path> <value>`, is invisible to it.

Meanwhile `packages/cli/src/output.ts:11` already ships a stronger matcher for the
same concept, `SECRET_KEY = /(pass|secret|token|auth|api[-_]?key|credential|bearer)/i`,
a case-insensitive substring regex used to redact printed config values. Two lists
for one notion inside one package will drift.

The intended follow-up, not done here: export a single secret-name list from
`output.ts`, consume it from both the redactor and the guard, and extend the guard
to walk `registeredArguments` so a future secret-valued positional is caught. Note
that this is not a pure code move: the redactor's substring regex applied to whole
flags would flag `--passphrase-file`, which takes a value and is safe, so the
unified guard has to keep the "a path or a boolean carries no secret" exception
explicit, either by matching on the flag leaf or by an allowlist of known-safe
value-taking options.

## Consequences

- `--btc-rpc-pass` is now an unknown option: commander fails parsing with
  `commander.unknownOption` and exit code 1 before any command action runs, so the
  password never reaches the connection config. Scripts and CI jobs that passed the
  flag break loudly rather than silently continuing without a password. The cli's
  accepted-flags surface is a breaking surface, so this rides the next cli minor
  under 0.x.
- An operator who pairs a flag-supplied `--btc-rpc-url` with `BTCR2_BTC_RPC_PASS`
  now gets an unauthenticated RPC client and an authentication failure from the
  node, rather than a wrong-credential leak: the atomic unit already prevented
  cross-layer mixing. The fix is `BTCR2_BTC_RPC_PASS_FILE`, or moving the url into
  the same layer as the password.
- Every doc that tabulated the flag was updated to say there is no flag and why:
  the cli README's global-flag and env tables, `docs/README.md`, `docs/config.md`,
  `docs/resolve.md`, `docs/update.md`, `docs/deactivate.md`, `docs/quickstart.md`,
  and `docs/DEMO.md`.
- Programmatic callers are unaffected: `defaultApiFactory(network, { btcRpcPass })`
  still works, since `ConnectionOverrides` kept the field.
- The claim "the RPC password is off argv" is accurate for the dedicated flag only.
  Three operator-facing argv channels remain, listed above, each requiring
  deliberate operator action.
- ADR 077's redaction defaults, secret-ref forms, and plaintext-at-rest tradeoff
  are unchanged. Only its flag layer is retired.

## Rejected alternatives

- **Keep the flag but accept only `env:`/`file:` references.** The reference would
  be safe on argv, but a literal would have to be rejected at parse time, and by
  then the operator has already typed the password into a shell that recorded it.
  A rejection after the fact does not unwrite `~/.bash_history` or the process
  listing of the run that produced it. Removing the option is the only change that
  makes the argv path impossible.
- **Keep the flag and print a warning.** A warning on stderr does not remove the
  value from `/proc/<pid>/cmdline` for the life of the process, and unattended
  runs never read it.
- **Reject userinfo in `--btc-rpc-url` as well.** Rejecting it only when it arrives
  on the flag layer is implementable and stays open as future work, but it would
  fail the most common paste-a-working-url workflow at the exact moment an operator
  is trying to reach their own node, in exchange for a channel that is already
  documented and redacted in every printed surface. Deferred; a warn-then-proceed
  is the likelier future shape.
- **Invert the guard to an allowlist of value-taking options.** Structurally the
  strongest form, and it would catch `--auth`, `--api-key`, and a short-only
  `-p <password>`. Deferred rather than refused: the cli's global surface is still
  growing, and every benign new option would need an allowlist entry. Sharing one
  secret-name list and walking positionals is the cheaper next ratchet.
- **Encrypt `config.json`, or move `rpcPass` into the keystore.** Already rejected
  by ADR 077 for the same reasons (it duplicates the keystore's job and couples
  network config to keystore unlock), and nothing in this decision changes that.
