---
title: ADR
children:
  - ./001-monorepo-package-boundaries.md
  - ./002-jcs-canonicalization-and-cryptosuite.md
  - ./003-bech32m-did-encoding.md
  - ./004-rename-to-did-btcr2.md
  - ./005-bitcoin-package-extraction-and-browser-decoupling.md
  - ./006-api-package-boundary.md
  - ./007-kms-package-boundary.md
  - ./008-aggregation-subsystem-inception.md
  - ./009-sans-io-bitcoin-transport-foundation.md
  - ./010-spec-v0.2-alignment-and-tracking-policy.md
  - ./011-test-vector-generation-methodology.md
  - ./012-kms-dual-signing-urn-identifiers.md
  - ./013-cli-per-command-dependency-injection.md
  - ./014-canonicalization-functions-and-toJSON-convention.md
  - ./015-keypair-security-hardening-noble-migration.md
  - ./016-sans-io-resolver.md
  - ./017-optimized-smt-core-primitive.md
  - ./018-beacon-hierarchy.md
  - ./019-browser-compat-and-noble.md
  - ./020-aggregation-layered-architecture.md
  - ./021-tsconfig-normalization.md
  - ./022-documentation-split.md
  - ./023-cas-read-path.md
  - ./024-api-facade-lazy-and-layered-config.md
  - ./025-sans-io-updater.md
  - ./026-drop-bitcoinjs-lib.md
  - ./027-aggregation-security-hardening.md
  - ./028-http-transport-additive.md
  - ./029-tls-only-confidentiality.md
  - ./030-fetch-based-sse.md
  - ./031-permissive-cors-default.md
  - ./032-sans-io-server-primitives.md
  - ./033-key-manager-package-rename.md
  - ./034-key-manager-capability-pattern.md
  - ./035-smt-proof-base64url-wire-format.md
  - ./036-zero-hash-smt-model.md
  - ./037-single-party-beacon-and-two-axis-model.md
  - ./038-musig2-key-custody.md
  - ./039-cohort-condition-model.md
  - ./040-multi-cohort-service-runner.md
  - ./041-cooperative-non-inclusion-signaling.md
  - ./042-fault-tolerant-beacon-output.md
  - ./043-k-of-n-fallback-protocol.md
  - ./044-beacon-change-output-address.md
  - ./045-analytical-vsize-aggregation-fees.md
---

# Architecture Decision Records

Each ADR captures one significant architectural decision: the context, the alternatives considered, the chosen path, and the trade-offs accepted. ADRs are numbered in chronological order of when the decision was made.

| #   | Date       | Title |
|-----|------------|-------|
| 001 | 2025-02-19 | [Monorepo Package Boundaries](001-monorepo-package-boundaries.md) |
| 002 | 2025-03-14 | [JCS Canonicalization and bip340-jcs-2025 Cryptosuite](002-jcs-canonicalization-and-cryptosuite.md) |
| 003 | 2025-03-14 | [Bech32m DID Identifier Encoding](003-bech32m-did-encoding.md) |
| 004 | 2025-08-23 | [Rename did:btc1 to did:btcr2](004-rename-to-did-btcr2.md) |
| 005 | 2025-09-18 | [Bitcoin Package Extraction and Browser Decoupling](005-bitcoin-package-extraction-and-browser-decoupling.md) |
| 006 | 2025-09-26 | [API Package Boundary](006-api-package-boundary.md) |
| 007 | 2025-10-28 | [KMS Package Boundary](007-kms-package-boundary.md) |
| 008 | 2025-11-12 | [Aggregation Subsystem Inception](008-aggregation-subsystem-inception.md) |
| 009 | 2025-11-25 | [Sans-I/O Foundation at the Bitcoin Transport Layer](009-sans-io-bitcoin-transport-foundation.md) |
| 010 | 2026-02-13 | [did:btcr2 v0.2 Spec Alignment and Spec-Tracking Policy](010-spec-v0.2-alignment-and-tracking-policy.md) |
| 011 | 2026-03-06 | [Test Vector Generation Methodology](011-test-vector-generation-methodology.md) |
| 012 | 2026-03-13 | [KMS Dual Signing, URN Identifiers, and Watch-Only KeyEntry](012-kms-dual-signing-urn-identifiers.md) |
| 013 | 2026-03-17 | [CLI Per-Command Modules with Dependency Injection](013-cli-per-command-dependency-injection.md) |
| 014 | 2026-03-17 | [Canonicalization Functions, toJSON Convention, and base64urlnopad Default](014-canonicalization-functions-and-toJSON-convention.md) |
| 015 | 2026-03-20 | [Keypair Security Hardening and Noble / Scure Migration](015-keypair-security-hardening-noble-migration.md) |
| 016 | 2026-03-25 | [Sans-I/O Resolver State Machine](016-sans-io-resolver.md) |
| 017 | 2026-03-27 | [Optimized Sparse Merkle Tree as the Aggregate-Beacon Primitive](017-optimized-smt-core-primitive.md) |
| 018 | 2026-03-28 | [Beacon Hierarchy (Singleton, CAS, SMT)](018-beacon-hierarchy.md) |
| 019 | 2026-03-30 | [Browser Compatibility Constraint and @noble / @scure Dependency Policy](019-browser-compat-and-noble.md) |
| 020 | 2026-04-06 | [Aggregation Layered Architecture](020-aggregation-layered-architecture.md) |
| 021 | 2026-04-08 | [tsconfig Normalization and CJS via tsup](021-tsconfig-normalization.md) |
| 022 | 2026-04-08 | [Split User Docs from Contributor Docs](022-documentation-split.md) |
| 023 | 2026-04-10 | [CAS Read Path: Helia vs HTTP Gateway](023-cas-read-path.md) |
| 024 | 2026-04-10 | [API Facade: Lazy Construction and Layered Configuration](024-api-facade-lazy-and-layered-config.md) |
| 025 | 2026-04-13 | [Sans-I/O Updater State Machine for the DID Write Path](025-sans-io-updater.md) |
| 026 | 2026-04-14 | [Drop bitcoinjs-lib; @scure/btc-signer for Bitcoin Primitives](026-drop-bitcoinjs-lib.md) |
| 027 | 2026-04-14 | [Aggregation Protocol Security Hardening and Threat Model](027-aggregation-security-hardening.md) |
| 028 | 2026-04-22 | [HTTP/REST as an Additive Transport for Aggregation](028-http-transport-additive.md) |
| 029 | 2026-04-22 | [TLS-Only Confidentiality for HTTP Transport](029-tls-only-confidentiality.md) |
| 030 | 2026-04-22 | [Fetch-Based SSE over Native EventSource](030-fetch-based-sse.md) |
| 031 | 2026-04-22 | [Permissive CORS Default for HTTP Transport](031-permissive-cors-default.md) |
| 032 | 2026-04-22 | [Sans-I/O handleRequest / handleSse Primitives](032-sans-io-server-primitives.md) |
| 033 | 2026-05-18 | [Rename @did-btcr2/kms to @did-btcr2/key-manager](033-key-manager-package-rename.md) |
| 034 | 2026-05-21 | [KeyManager.canExport Capability Pattern](034-key-manager-capability-pattern.md) |
| 035 | 2026-06-15 | [SMT Proof Wire Format: base64url no-pad and the Zero-Node Collapsed Bitmap](035-smt-proof-base64url-wire-format.md) |
| 036 | 2026-06-16 | [Adopt the Zero-Hash SMT Model per algorithms.html](036-zero-hash-smt-model.md) |
| 037 | 2026-06-19 | [Rename Beacon to SinglePartyBeacon and the Two-Axis Beacon Model](037-single-party-beacon-and-two-axis-model.md) |
| 038 | 2026-06-20 | [MuSig2 Key Custody: Bounded, Zeroized Secrets at the Participant Boundary](038-musig2-key-custody.md) |
| 039 | 2026-06-21 | [Cohort Condition Model](039-cohort-condition-model.md) |
| 040 | 2026-06-22 | [Multi-Cohort Aggregation Service Runner](040-multi-cohort-service-runner.md) |
| 041 | 2026-06-23 | [Cooperative Non-Inclusion Signaling for Aggregate Beacons](041-cooperative-non-inclusion-signaling.md) (superseded by 042) |
| 042 | 2026-06-23 | [Fault-Tolerant Aggregate Beacon Output (Hybrid Taproot)](042-fault-tolerant-beacon-output.md) |
| 043 | 2026-06-24 | [k-of-n Fallback Signing Protocol for Aggregate Beacons](043-k-of-n-fallback-protocol.md) |
| 044 | 2026-06-24 | [Beacon Change Output - Caller-Supplied Address to End Beacon-Address Reuse](044-beacon-change-output-address.md) |
| 045 | 2026-06-24 | [Analytical-vsize Dynamic Fees for the Aggregation Beacon Broadcast](045-analytical-vsize-aggregation-fees.md) |
