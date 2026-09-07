# ADR 106: The cli write commands take the identifier and resolve the source through the api

- **Status:** Accepted
- **Date:** 2026-09-07
- **Packages:** `@did-btcr2/cli`

## Context

The cli `update` and `deactivate` commands call `api.btcr2.update` directly. They demand four flags: the source document, its version, the verification method id, and the beacon id. The `deactivate` command builds the deactivation patch itself.

The api offers `updateDid` and `deactivateDid`. Those methods resolve the source document when the caller omits the source pair, and accept the caller's resolution options for that resolution (ADR 098, ADR 101). They derive an omitted verification method and an omitted beacon (ADR 104). They supply the deactivation patch (ADR 094) and refuse a deactivated source (ADR 100). The cli, the only consumer of the api, uses none of this.

ADR 105 gave `resolve` the `--min-conf` flag and deferred the flag on the write commands until they resolve.

The `-b` flag parses its value as JSON. A bare DID URL is invalid JSON, so an operator quotes the value twice. The cli README shows an object as the value, which the api rejects with "No beacon service found".

## Decision

**`update` and `deactivate` take `-i/--identifier <did>` and call `updateDid` and `deactivateDid`.** The DID drives the network derivation and the mainnet keystore guard (ADR 080), as it does for `resolve`. The api refuses a supplied source document whose id differs from the DID (ADR 101).

**The source pair is optional and comes whole.** `-s/--source-document` and `--source-version-id` stay for offline use. Both flags, or neither. The cli refuses a half pair before it reads any key material and names the two flags. Without the pair, the api resolves the current document.

**The write commands take the resolution flags of `resolve`.** `-r/--resolution-options`, `--resolution-options-path`, and `--min-conf` feed the source resolution. The path flag has no short form: `-p` is `--patches` on `update`, and `deactivate` mirrors `update`. The parsing moves to one shared module. `resolve` keeps its flags, its behaviour, and its messages.

**The resolution flags are refused together with the source pair.** The api ignores `resolutionOptions` when the pair is supplied (ADR 098). A `--min-conf 1` that does nothing misleads an operator who waits for a fresh signal. The cli refuses the combination at argument validation, before any file read.

**`-m` and `-b` stay as optional overrides. `-b` takes a plain DID URL.** ADR 104 refuses zero or several candidates and names them, so that the caller makes the choice. A cli operator needs a flag to make that choice. Without the flags, a document with several funded beacons, or with several methods that publish one key, is not updatable from the cli. The JSON parse of `-b` goes.

**The deactivation patch leaves the cli.** `deactivateDid` supplies it. The patch has one home (ADR 094).

**One shared module serves both commands.** `packages/cli/src/commands/write.ts` registers the shared flags, validates them, applies the guard, builds the signer, and returns the parameters. `update` adds `-p`. `deactivate` adds nothing.

## Scope boundary

- No api change. The api surface of 0.21.0 covers every flag.
- `resolve` keeps `-p` for the options path.
- No `--network` flag on the write commands. The DID names the network.
- The vector generator and the api end-to-end script do not change.
- A missing `-i` is a commander error, as a missing `-i` is on `resolve`.

## Consequences

**Positive.** The demo update is `update -i $DID -p <patches>`. The demo deactivation is `deactivate -i $DID --min-conf 1 -r <sidecar>`. No double quotes on `-b`. The api's refusals (half pair, deactivated source, network mismatch, zero or several candidates) reach the operator with their own messages. The cli exercises the api's write methods, so the api's tests and the cli's tests cover one path.

**Negative.** Breaking flag set on a 0.x MINOR: `-i` is required; `-s`, `--source-version-id`, `-m`, and `-b` are optional; `-b` is no longer JSON. A script that passes `-b '"#id"'` now names a beacon id with literal quotes and fails with "No beacon service found". A default source resolution needs a Bitcoin connection and the sidecar of every prior update that is not in a CAS; the offline pair keeps the old path. The public `UpdateCommandOptions` type changes shape.

**Neutral.** The printed output does not change. The `Watch:` hint does not change.

## Implementation

- `packages/cli/src/resolution-options.ts` (new): `readResolutionOptions`, `parseMinConf`, `MIN_CONF_HELP`, `ResolutionOptionFlags`.
- `packages/cli/src/commands/resolve.ts`: uses the shared module.
- `packages/cli/src/commands/write.ts` (new): `registerWriteOptions`, `prepareWrite`, `parseJsonArg`, `WriteFlags`.
- `packages/cli/src/commands/update.ts`, `deactivate.ts`: `-i`, the shared flags, one api call each.
- `packages/cli/src/types.ts`: `UpdateCommandOptions` is the parameter shape of `updateDid` minus `patches`.
- Tests: the write flags, the source pair, the half-pair refusal before key access, the exclusivity refusal before the file read, `-m`/`-b` as plain strings, `-r`/`--resolution-options-path`/`--min-conf` and the `--min-conf` precedence, `deactivateDid` with no patches, the mainnet guard through `-i`, the watch hint.
- Docs: the cli README, `docs/update.md`, `docs/deactivate.md`, `docs/DEMO.md`.

## References

- ADR 080 (keystore lifecycle and dev keystores): the mainnet guard the DID drives.
- ADR 094 (deactivation is an ordinary update): the patch the api supplies.
- ADR 098 (update source resolution accepts the caller's resolution options): the `-r`/`--min-conf` pass-through.
- ADR 100 (the update path refuses a deactivated source): the refusal the cli now inherits.
- ADR 101 (a write's source pair is accepted whole or not at all): the half-pair rule.
- ADR 104 (the update path derives an omitted verification method and beacon): the derivation and the named candidates.
- ADR 105 (resolution processes only signals at `minConf`): the deferred `--min-conf` on the write commands.
