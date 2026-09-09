# ADR 108: The api builds a genesis document from a spec, and the cli exposes it as `genesis build`

- **Status:** Accepted
- **Date:** 2026-09-09
- **Packages:** `@did-btcr2/api`, `@did-btcr2/cli`

## Context

An external (`x`) identifier encodes the SHA-256 hash of a Genesis Document. The specification defines the Genesis Document as a DID document with the placeholder id `did:btcr2:_`, and it says that an updatable document needs at least one verification method with the `capabilityInvocation` relationship and at least one beacon service. The method package builds such a document from one public key (`GenesisDocument.fromPublicKey`), with one P2PKH Singleton beacon and all four relationships. No package builds a document with several keys, a chosen set of relationships, a CAS or SMT beacon, or other services.

The cli created an external identifier from its hash only: `create -t x --bytes <hex>`. An operator had to write the document by hand, canonicalize it, hash it, and paste the hash. The hash of a document with one changed byte is a different identifier, so a hand-written document that does not match its identifier fails at the first resolution with `Initial document mismatch`. The cli could not pass the document to `resolve`, `update`, or `deactivate` except inside the JSON resolution options.

ADR 095 gave the api `getInitialDocument` and `getBeacons`, which derive the beacon addresses of a `k` identifier with no chain read. ADR 107 gave the cli `identifier validate --genesis-document`, which confirms that a document hashes to an identifier. The build step between the two was missing.

## Decision

**The api builds the genesis document.** `api.btcr2.buildGenesisDocument(spec)` takes the public keys with their relationships and id fragments, the beacons (a type with a key and an address type, or a type with a Bitcoin address), and the other services. It returns the Genesis Document: the placeholder id, one Multikey verification method per key, the relationships that the keys name, one beacon service per beacon with a `bitcoin:` endpoint, and the other services with a placeholder id. The default relationships are all four. The default beacon is one Singleton beacon with the P2WPKH address of the first key, the address kind that the `k` funding hint uses. The default id fragments are `key-<index>` and `service-<position>`, as in the specification's example. The network of the beacon addresses is `spec.network`, else the network of the configured Bitcoin connection, else regtest (ADRs 093 and 099). The builder refuses a spec with no `capabilityInvocation` method or no beacon: the specification names both as conditions of an updatable document. A supplied address must be a P2PKH, P2WPKH, or P2TR address of the network. The builder runs with no I/O.

**The api creates the identifier from the document.** `api.btcr2.createExternalFromDocument(document, options)` checks that the document is a JSON object with the id `did:btcr2:_`, the two required contexts, and the placeholder in every verification method and service id. It hashes the document as given, encodes the identifier for `options.network` with the same default as `createExternal`, and derives the initial DID document through the resolver's external path, which validates the result as a DID document. It returns `{ did, genesisBytes, didDocument }`. The caller keeps the document; the api does not store or publish it.

**The cli adds `genesis build`.** The command builds the document, writes it to `--out` (default `genesis.json`, refused if the file exists unless `--force`), and prints `{ did, network, genesisBytes, path, beacons }`. On a terminal the command asks for the keys, the relationships, the beacons, and the services, with the active key, all relationships, and one P2WPKH Singleton beacon as the defaults. Without a terminal the command refuses unless `--spec <path>` names a JSON file with the same content; the file names keys by keystore reference or by hex public key, and the command asks nothing. The network comes from `-n`, else the configuration, as in `create`. The command hashes the parsed form of the file it wrote, so the identifier always matches the file. Key references are resolved through the keystore with public reads only; a spec with hex keys needs no keystore. In text mode the command prints a hint that names the file and the first beacon to fund.

**`create -t x` takes the document.** `create -t x --document <path>` hashes the file through the api and prints the identifier with the genesis bytes. `--bytes` stays for a hash computed elsewhere; the two flags are exclusive.

**The read and write commands take the document.** `resolve`, `update`, and `deactivate` gain `--genesis-document <path>`. The file fills `sidecar.genesisDocument` of the resolution options and wins over a value inside `-r` or the options file. The flag is refused for a `k` identifier, which has no genesis document, and on the write commands together with the source pair, like the other resolution flags (ADR 098).

## Scope boundary

- The api does not publish the document to a CAS. Publication stays with the caller and with the `publishToCas` policy of the update path (ADR 073).
- The api does not check the network of a supplied beacon address against the network of the identifier in `createExternalFromDocument`; the builder checks it when it derives or accepts an address.
- The wizard does not create keys. `key generate` does.
- The method package does not change.

## Consequences

**Positive.** An operator builds an external identifier with several keys, chosen relationships, a CAS or SMT beacon, and services in one command, and the identifier always matches the written file. The api gives the same result to a program. The full cli life cycle of an external identifier works with files: `genesis build`, `create -t x --document`, `resolve --genesis-document`, `update --genesis-document`, `deactivate --genesis-document`, and `identifier validate --genesis-document` confirms the pair.

**Negative.** The cli printed-output surface grows by one action, and the `create` result gains an optional `genesisBytes` field. The `-t x` error message of `create` names both inputs. The api surface grows by two methods and six exported types.

**Neutral.** The builder produces the same document as `GenesisDocument.fromPublicKey` except for the beacon address kind (P2WPKH, not P2PKH) and the service id. A resolver accepts both.

## Implementation

- `packages/api/src/genesis.ts` (new): `buildGenesisDocument`, `assertGenesisDocument`, the spec types, and the constants `VERIFICATION_RELATIONSHIPS`, `BEACON_TYPES`, `BEACON_ADDRESS_TYPES`, `DEFAULT_BEACON_ADDRESS_TYPE`. `packages/api/src/method.ts`: `DidMethodApi.buildGenesisDocument`, `DidMethodApi.createExternalFromDocument`, `ExternalCreateResult`. `packages/api/src/index.ts`: the exports.
- `packages/cli/src/commands/genesis.ts` (new): `registerGenesisCommand`. `packages/cli/src/genesis-spec.ts` (new): the spec file shape and its conversion. `packages/cli/src/genesis-wizard.ts` (new): `collectGenesisSpec`. `packages/cli/src/genesis-document-file.ts` (new): the shared file reader. `packages/cli/src/network-option.ts` (new): the network option helpers that `create` and `genesis build` share. `create.ts`, `resolve.ts`, `write.ts`, `resolution-options.ts`, `hints.ts`, `types.ts`, `completion.ts`.
- Tests: `api/tests/genesis.spec.ts` (new), `index-exports.spec.ts`; `cli/tests/genesis-commands.spec.ts` (new), `create-commands.spec.ts`.
- Docs: `packages/cli/docs/genesis.md` (new), the command tables, `create.md`, `resolve.md`, `update.md`, `deactivate.md`, `completion.md`, `DEMO.md`, the api README.

## References

- Specification, "Create", "Genesis Document Hash": the hash of a Genesis Document as genesis bytes.
- Specification, "Data Structures", "Genesis Document" and "DID Document": the placeholder id and the conditions of an updatable document.
- Specification, "Beacons", "Table 1: Beacon Types": the three service types.
- ADR 093 (a new DID inherits the network of the connection) and ADR 099 (an offline facade mints regtest identifiers): the network default that both methods share.
- ADR 095 (offline initial document and beacon addresses): the derivation that `createExternalFromDocument` returns.
- ADR 098 (resolution options on the write path): the rule that `--genesis-document` follows.
- ADR 107 (identifier validation report): the `genesisDocument` check that confirms the result.
