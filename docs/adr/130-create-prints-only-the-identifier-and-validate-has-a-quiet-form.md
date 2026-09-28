# ADR 130: create Prints Only the Identifier, and validate Has a Quiet Form

- **Status:** Accepted
- **Date:** 2026-09-28
- **Packages:** `@did-btcr2/cli` (MINOR, breaking: text output)

## Context

In text mode, `create` printed the identifier on stdout. It also printed a key note on stderr (`Using stored key <urn>.` or `Generated and stored key <urn> (now the active key).`) and, on a network with a faucet, a funding hint of four lines. The usual task is "give me the identifier", and the extra lines hide the answer.

`config validate` and `identifier validate` printed the full result as JSON. That is the correct default for a diagnostic command. But a script or a quick check needs only the answer: valid or not, and if not, why.

The global `--verbose` flag existed, but it only changed the error output. The global `--quiet` flag only suppressed stderr hints and warnings, and it had no short form.

## Decision

**In text mode, `create` prints only the identifier.** `--verbose` adds the key note and the funding hint on stderr.

**`config validate` and `identifier validate` keep the full result by default.** With `-q/--quiet`, text mode prints a short result on stdout:

| Command | Text mode | Text mode with `-q/--quiet` |
|---------|-----------|------------------------------|
| `create` | The identifier only. `--verbose` adds the key note and the funding hint on stderr. | The identifier only |
| `config validate` | `{ "ok", "issues" }` as JSON | `OK`, else one line for each issue: `<path>: <issue>` |
| `identifier validate` | The report as JSON | `OK`, else the failed check: `Invalid identifier (<check> check): <detail>` |

- The global `--quiet` flag gets the short form `-q`. No command used `-q` before.
- Commander also reads a global flag after the command word, so `btcr2 create --verbose` and `btcr2 config validate -q` work. The commands add no flag of their own.
- `--quiet` keeps its other effect: no hints and no warnings on stderr. For the other commands, it still does not change stdout.
- `--verbose` keeps its error behavior: a failure prints the full error object and the stack.
- The exit codes do not change. A validate command with a finding exits with code 1.
- JSON mode (`-o json`) does not change. It prints the full envelope and no hint, also with `-q`.
- A warning of `create` does not change. For example, the profile and network mismatch warning still prints. `--quiet` suppresses it.
- The two validate commands share one formatter, `formatCheckResult` in `src/output.ts`.

## Alternatives

- **The short validate result by default, and the full result under `--verbose`.** This was the first version of this ADR. A validate command is a diagnostic, so the full result is the better default. The short result is an opt-in for scripts and quick checks.
- **A `--verbose` or `--quiet` flag on each command.** Commander gives a global flag to the program before the subcommand parses its options, so a subcommand flag with the same name never gets a value. The global flags already work in both places.
- **A `defaults.verbose` key in the config file.** Nobody asked for it. It can come later without a change to this rule.
- **The failures of a quiet validate on stderr.** The failures are the result of the command, not a diagnostic. JSON mode prints them on stdout too.
- **The key note by default after the generate mode of `create`.** The note is the only sign of a new key. But the request was "only the identifier". `key list` and `--verbose` show the key.

## Consequences

**Positive.** `btcr2 create` prints one line, the identifier. `btcr2 config validate -q` and `btcr2 identifier validate <did> -q` give a one-word answer, and a failure names the problem on one line. The default output of the validate commands stays the same.

**Negative.** The text output of `create` changes, so this is a breaking change of the cli (MINOR at 0.x). On a test network, `create` no longer shows the faucet link. `quickstart` still prints it. The generate mode of `create` makes a key with no note. `--quiet` now changes stdout for two commands.

**Tests.** The cli tests cover the identifier alone in text mode, the key note with `--verbose` after the command word, the unchanged JSON envelope, the funding hint only with `--verbose` (for `-t k` and `-t x --document`), the full result of both validate commands by default, `OK` and the issue lines of `config validate` with `-q` and `--quiet` and exit code 1, `OK` and the failed check of `identifier validate` with `-q` and `--quiet`, and `formatCheckResult` in each mode.
