---
'@did-btcr2/cli': minor
---

Credential hygiene, pre-broadcast confirmation, and a fee-rate ceiling.

BREAKING:

- The `--btc-rpc-pass` flag and `GlobalOptions.btcRpcPass` are removed: a password on argv is visible in `ps`, `/proc/<pid>/cmdline`, shell history, and CI logs. Supply the RPC password via the `BTCR2_BTC_RPC_PASS` environment variable, a file named by `BTCR2_BTC_RPC_PASS_FILE`, or a profile `btc.rpcPass` entry holding a literal value or an `env:<VAR>`/`file:<path>` secret reference.
- `update` and `deactivate` require explicit confirmation before broadcasting: the built transaction's exact fee is displayed and must be confirmed interactively, or pre-confirmed with `-y`/`--yes`. Non-interactive invocations without `--yes` fail closed with `CONFIRMATION_REQUIRED_ERROR` (regtest is exempt).
- The fee rate (`--fee-rate`, `BTCR2_FEE_RATE`, profile `btc.feeRate`) is capped at 1000 sat/vB with no override; higher values are rejected as fat-fingers.
- `resolveSecretRef` throws on an `env:` reference naming an unset variable, so a mistyped variable name surfaces immediately instead of as a downstream RPC auth failure.

Added:

- `--min-conf <n>` flag on `resolve`: a discoverability shortcut for the `minConf` resolution option (default 6), useful on regtest/signet demos where waiting for 6 confirmations is impractical.
- A uniform secret-file permission policy: the keystore, session file, `--passphrase-file`, `key import --secret-file`, and RPC-password files must have mode 0600, 0400, 0440, or 0640 (not enforceable on Windows).
- `config set` warns when a plaintext RPC password is stored in the config file and nudges toward a secret reference.

Fixed:

- `config doctor`, `config effective`, and the profile/config readers redact embedded endpoint credentials and RPC passwords in output (opt-in `--show-secrets` reveals them deliberately).
- Profile names and config paths that would reach the prototype chain are rejected.
- The interactive confirmation prompt tolerates non-blocking TTY reads (EAGAIN) with a bounded idle wait, instead of aborting on an empty first read.
