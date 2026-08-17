---
title: "ADR 086: Beacon Signal Recognition - Decode the Serialized Script and Require a Beacon Spend"
---

# ADR 086: Beacon Signal Recognition - Decode the Serialized Script and Require a Beacon Spend

**Status:** Accepted (supersedes [ADR 056](056-beacon-signal-format-validation.md))

**Date:** 2026-08-19

**Branch / PR:** `fix/critical-high-security-findings`

**References:** [ADR 016](016-sans-io-resolver.md), [ADR 044](044-beacon-change-output-address.md), [ADR 055](055-resolver-provide-trust-boundary.md), [ADR 056](056-beacon-signal-format-validation.md)

## Context

Beacon signal discovery is the entry point of the resolver's read path
(`packages/method/src/core/beacon/signal-discovery.ts`). It has two implementations
against two different backends: `indexer` reads an Esplora REST address listing, and
`fullnode` traverses blocks over Bitcoin Core RPC. Whatever either one recognizes as a
signal becomes an update the resolver applies; whatever it fails to recognize is an
update the resolver never sees, and the caller is handed the previous document with no
indication that anything is missing.

The specification defines the object being recognized in two parts. Terminology defines
**Signal Bytes** as "the 32 bytes of information that are included within the last
transaction output of a Beacon Signal", whose output script "has the following form:
`[OP_RETURN, OP_PUSH_BYTES, <signal_bytes>]`", and defines a **Beacon Signal** as
"Bitcoin transactions that **spend from** a Beacon Address and include a transaction
output of the format defined in Signal Bytes". The Beacon Address definition says the
same thing from the other side: "spends of UTXO controlled by this address are identified
as Beacon Signals." The resolve operation's Process Beacon Signals step restates the
output rule: "use those Beacon Addresses to find Bitcoin transactions whose last output
script contains Signal Bytes."

[ADR 056](056-beacon-signal-format-validation.md) implemented only the output half of
that definition, and implemented it against a rendering rather than against the wire
bytes. Its shared decoder, `extractOpReturnSignal(asm)`, accepted a scriptPubKey if and
only if its `asm` string was exactly the three tokens `OP_RETURN`, `OP_PUSHBYTES_32`, and
a 64-character hex payload. Two gaps followed, and both fail open: a real signal is
discarded or a fake one is admitted, and in either case resolution returns a stale
document with no error, so a rotated or revoked key still reads as authorized.

**`asm` is a per-backend rendering, not a wire format.** Esplora prints a data push with
its opcode name (`OP_RETURN OP_PUSHBYTES_32 <hash>`); Bitcoin Core prints the pushed data
as bare hex (`OP_RETURN <hash>`). ADR 056's three-token rule is Esplora's dialect, so
every genuine signal arriving over Bitcoin Core RPC failed the token check and was
dropped. The rule was invisible to the test suite because the RPC-path fixtures rendered
their `asm` in Esplora's dialect, a shape no Bitcoin Core node emits: the tests passed
while a live node found nothing.

**Recognition rested on the output alone.** `indexer` calls `address.getTxs`, which
returns every transaction touching the address in either direction, and accepted any of
them whose last output was a well-formed 32-byte `OP_RETURN`. It never inspected the input
side. Anyone able to pay dust to a beacon address could therefore attach a 32-byte
`OP_RETURN` of their choosing and have it discovered as that beacon's signal. The resolver
then emits a data need for an update that nobody can supply, so resolution cannot complete
for as long as that output stays on chain: a permanent denial of resolution for the price
of one dust output and no keys at all. Chained with a document that admits a
lower-privilege signing key, it also lets a party who cannot spend the beacon UTXO get a
rogue update announced.

The `fullnode` path had a third, unrelated defect that made the whole path moot: it
extracted the signal from the locking script of the output *being spent* rather than from
the spending transaction's last output. An output being spent carries a payment script,
never a signal, so that path found nothing for any DID under any input.

## Decision

### 1. Recognize a signal from the serialized script, not from `asm`

`extractOpReturnSignal(asm)` becomes `extractOpReturnSignalHash(scriptPubKey)`
(`signal-discovery.ts:42`), which matches `/^6a20([0-9a-f]{64})$/i` (`:20`) against the
raw script hex and returns the lowercased payload, or `null`. Both backends return that
field verbatim (Esplora as `scriptpubkey`, Bitcoin Core as `scriptPubKey.hex`), and it is
the exact inverse of the encode side, `opReturnScript` (`core/beacon/beacon.ts:255`),
which `op-return-script.spec.ts` pins byte for byte. Recognition therefore matches the
bytes actually committed to the chain and carries no backend dialect. Both paths read the
transaction's last output (`:140` and `:268`), which is the spec's rule and the same
invariant [ADR 044](044-beacon-change-output-address.md) decision 4 preserves on the write
side by placing change before the signal.

**This is a portability fix, not a tightening.** The new regex accepts exactly the set
ADR 056's asm rule accepted: `OP_PUSHBYTES_32` is rendered only for opcode `0x20` and
`OP_RETURN` only for `0x6a`, so "the asm is exactly those three tokens" and "the script is
exactly `6a20<32 bytes>`" pick out the same scripts. Everything ADR 056 rejected is still
rejected: a bare `OP_RETURN`, a push of the wrong size, a second push, a non-hex payload,
and a script where `OP_RETURN` is not the leading opcode. `OP_PUSHDATA1` (`6a4c20...`)
remains rejected as non-conforming: the spec's `OP_PUSH_BYTES` is the direct-push opcode
family, and a `0x4c`-prefixed encoding of 32 bytes is the non-minimal way to write the
same push. An `OP_RETURN` that is not the transaction's last output is non-conforming for
the same reason and is never examined.

The rename is deliberate. The parameter's meaning changed from a rendering to a
serialization, and a caller that kept passing `asm` to the old name would have silently
received `null` forever. Renaming turns that into a compile error. The function is
re-exported from the package root (`method/src/index.ts:8`), so this is a breaking export
change for `@did-btcr2/method`.

### 2. An indexer signal must spend from the beacon address

`BeaconSignalDiscovery.spendsFromAddress(tx, address, bitcoin)` (`:82-107`) gates the
`indexer` push (`:167`). It returns true when at least one non-coinbase input's spent
output belongs to the beacon address. Coinbase inputs spend no prior output, so they can
never spend from a beacon and are skipped. This completes the spec's definition: the
output shape says what a signal *contains*, the input side says whose signal it *is*.
The `fullnode` path already required a beacon-spending input, since that is how it
associates a transaction with a service at all, so this decision changes the indexer path
only.

**The cost is bounded and paid last.** The spent output is read from `vin[].prevout`,
which Esplora embeds on both the address listing and the transaction endpoint, so the
common path costs no additional I/O. When a backend omits the field, the funding
transaction is fetched and its `vout[vin.vout]` used instead (`:96-99`). That is at most
one extra fetch per candidate input, incurred only for transactions that already passed
the free script-shape check (which is why the gate is ordered after it), and bounded above
by the address page size, since discovery only ever examines one page of address history.

**A prevout that cannot be resolved fails the resolution rather than skipping the
signal.** A fetch failure propagates. The alternative, treating an unresolvable input as
"not a beacon spend" and moving on, means a backend having a bad minute silently drops
real signals and hands the caller a stale document: precisely the failure shape this whole
decision set exists to remove. An error the caller can see and retry is recoverable; a
document silently missing a revocation is not.

## Consequences

- **The fullnode path discovers signals at all now.** It reads the hash once per
  transaction from that transaction's last output (`:268-276`) instead of from the output
  being spent, and credits a beacon at most once per transaction (`:280`), since a signal
  is now resolved per transaction rather than per input and a transaction spending two of
  one beacon's UTXOs would otherwise apply the same update twice. Anything driving this
  path now sees updates it previously never saw, including deactivations. Before, it
  returned zero signals for every DID and every caller, without an error.
- A transaction that only *pays* a beacon address is no longer discovered as a signal,
  whatever its `OP_RETURN` carries. A transaction that spends from the beacon still is,
  whether or not it pays anything back to the beacon.
- On a backend that does not embed `prevout`, discovery issues up to one extra
  `transaction.get` per candidate input, and a failure of that fetch now fails resolution.
- `extractOpReturnSignal` no longer exists under that name or that parameter. All affected
  packages are 0.x, so the rename rides the next minor.
- Recognition is now covered against both backends' real wire shapes rather than against
  one backend's rendering, so a dialect difference cannot pass the suite and fail on a
  live node.

### Accepted residual: beacon addresses are compared as case-sensitive strings

`spendsFromAddress` compares `prevout?.scriptpubkey_address === address` (`:101`), and the
fullnode path keys its service lookup on the address string the same way (`:322`). The
beacon address on both sides comes verbatim from `BeaconUtils.parseBitcoinAddress`
(`core/beacon/utils.ts:24-29`), which strips the `bitcoin:` scheme and any BIP21 query
string and normalizes nothing else.

BIP-173 declares an all-uppercase bech32 string valid and requires decoders to accept both
cases, and the repo's own address decoder agrees: `Address(network).decode` from
`@scure/btc-signer` returns the identical `wpkh` script for `bc1q...` and `BC1Q...`.
Esplora and Bitcoin Core both render `scriptpubkey_address` lowercase. So a DID document
whose beacon service endpoint uses the uppercase form matches no spent output on either
path, yields zero signals, and resolves to a stale document with no error.

Scoping this honestly: the defect is pre-existing on the fullnode path, whose lookup was
already a verbatim string key, and newly reachable on the indexer path, which had no
address comparison before this ADR. It is reachable only through a hand-authored or
externally supplied document: every in-repo endpoint generator emits the lowercase form
(`BeaconUtils.createBeaconService`), and the write path already refuses such an endpoint
loudly, deriving the lowercase address and throwing `SIGNER_KEY_MISMATCH`
(`core/beacon/beacon.ts:646-652`). It is accepted rather than fixed here because it is a
different defect class (address normalization) from the two decisions above, and folding
it in would have mixed a read-path correctness fix with a change to how addresses are
parsed everywhere.

Fix direction: normalize once, inside `parseBitcoinAddress`, by lowercasing an address
that is all-uppercase and decodes as bech32 or bech32m, and leaving base58 addresses
untouched (base58check is case-sensitive, and lowercasing one corrupts it).

## Rejected alternatives

- **Accept both asm dialects, for example by reading `tokens[2] || tokens[1]`.** It makes
  the live node work, but it silently admits a multi-push `OP_RETURN` and so drops ADR
  056's guard, and it leaves the next backend's dialect to be discovered in production
  rather than in the type system. The serialized script is the one thing every backend
  agrees on.
- **Keep the asm check and normalize the asm per backend.** Recognition would then depend
  on knowing which backend answered, which the discovery code deliberately does not know:
  it is handed a `BitcoinConnection`, not a dialect.
- **Compare the spent output's script instead of its address.** Strictly stronger, since
  a script comparison is immune to address rendering entirely and would subsume the
  case-sensitivity residual above. It lost on scope, not on merit: it requires threading
  network parameters into the comparison and re-keying the fullnode service map off
  scripts rather than addresses, which is a larger change than the one being made and
  would have been landed alongside an unrelated correctness fix. It remains the preferred
  long-term shape.
- **Skip an input whose prevout cannot be resolved.** A backend that omits `prevout` would
  then drop every signal for every DID with no error, restoring the exact fail-open
  outcome that decision 2 exists to close.
- **Also require the signal transaction to pay the beacon address.** Not what the
  specification says, and it would reject conforming signals:
  [ADR 044](044-beacon-change-output-address.md) makes the change destination a
  caller-supplied privacy lever precisely so a beacon need not pay itself back.
