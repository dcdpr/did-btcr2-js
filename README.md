# DID BTCR2 JS

did:btcr2 is a censorship resistant DID Method using the Bitcoin blockchain as a Verifiable Data Registry to announce changes to the DID document. It improves on prior work by allowing: zero-cost off-chain DID creation; aggregated updates for scalable on-chain update costs; long-term identifiers that can support frequent updates; private communication of the DID document; private DID resolution; and non-repudiation appropriate for serious contracts.

did:btcr2 is created for those who wish to have it all:

* resistance to censorship;
* non-correlation through pairwise DIDs;
* private communication of the DID document;
* a closed loop on private DID resolution;
* efficiency (in cost and energy usage), via offline DID creation and aggregatable updates;
* long-term identifiers that can support frequent updates; and
* Non-Repudiation appropriate for serious contracts.

## Technical Specification

Visit [dcdpr.github.io/did-btcr2](https://dcdpr.github.io/did-btcr2/) to read the did:btcr2 method specification.

## Monorepo Documentation

Visit [dcdpr.github.io/did-btcr2](https://dcdpr.github.io/did-btcr2) to learn more about the different packages in this monorepo.

## Method Documentation 

Visit [btcr2.dev](https://btcr2.dev/impls/ts) to learn more about the TypeScript implementation: [@did-btcr2/method](https://www.npmjs.com/package/@did-btcr2/method)

## Demo

Visit [btcr2.dev](https://btcr2.dev/demo) to see [@did-btcr2/method](https://www.npmjs.com/package/@did-btcr2/method) in action.

## Usage

Visit [btcr2.dev](https://btcr2.dev/impls/ts) for install and usage instructions.

## Packages

| Package                                          | Version                                                        | Issues                                                               | Pull Requests                                                       |
| :----------------------------------------------: | :------------------------------------------------------------: | :------------------------------------------------------------------: | :-----------------------------------------------------------------: |
| [@did-btcr2/api](packages/api/)                  | [![NPM Package][api-npm-badge]][api-npm-link]                  | [![Open Issues][api-issues-badge]][api-issues-link]                  | [![Open PRs][api-pulls-badge]][api-pulls-link]                      |
| [@did-btcr2/bitcoin](packages/bitcoin/)          | [![NPM Package][bitcoin-npm-badge]][bitcoin-npm-link]          | [![Open Issues][bitcoin-issues-badge]][bitcoin-issues-link]          | [![Open PRs][bitcoin-pulls-badge]][bitcoin-pulls-link]              |
| [@did-btcr2/cli](packages/cli/)                  | [![NPM Package][cli-npm-badge]][cli-npm-link]                  | [![Open Issues][cli-issues-badge]][cli-issues-link]                  | [![Open PRs][cli-pulls-badge]][cli-pulls-link]                      |
| [@did-btcr2/common](packages/common/)            | [![NPM Package][common-npm-badge]][common-npm-link]            | [![Open Issues][common-issues-badge]][common-issues-link]            | [![Open PRs][common-pulls-badge]][common-pulls-link]                |
| [@did-btcr2/cryptosuite](packages/cryptosuite)   | [![NPM Package][cryptosuite-npm-badge]][cryptosuite-npm-link]  | [![Open Issues][cryptosuite-issues-badge]][cryptosuite-issues-link]  | [![Open PRs][cryptosuite-pulls-badge]][cryptosuite-pulls-link]      |
| [@did-btcr2/keypair](packages/keypair)           | [![NPM Package][keypair-npm-badge]][keypair-npm-link]          | [![Open Issues][keypair-issues-badge]][keypair-issues-link]          | [![Open PRs][keypair-pulls-badge]][keypair-pulls-link]              |
| [@did-btcr2/method](packages/method/)            | [![NPM Package][method-npm-badge]][method-npm-link]            | [![Open Issues][method-issues-badge]][method-issues-link]            | [![Open PRs][method-pulls-badge]][method-pulls-link]                |
| [@did-btcr2/smt](packages/smt/)                  | [![NPM Package][smt-npm-badge]][smt-npm-link]                  | [![Open Issues][smt-issues-badge]][smt-issues-link]                  | [![Open PRs][smt-pulls-badge]][smt-pulls-link]                      |

## Project Resources

| Resource                                    | Description                                                                   |
| :------------------------------------------ | ----------------------------------------------------------------------------- |
| [CODEOWNERS](CODEOWNERS)                    | Outlines the project lead(s)                                                  |
| [LICENSE](LICENSE)                          | Project Open Source License [![MPL-2.0][mpl-license-badge]][mpl-license-link] |

[mpl-license-badge]: https://img.shields.io/badge/license-MPL%202.0-blue.svg
[mpl-license-link]: https://opensource.org/license/MPL-2.0

[api-npm-badge]: https://img.shields.io/npm/v/@did-btcr2/api.svg?&color=green&santize=true
[api-npm-link]: https://www.npmjs.com/package/@did-btcr2/api
[api-issues-badge]: https://img.shields.io/github/issues/dcdpr/did-btcr2-js/package:%20common?label=issues
[api-issues-link]: https://github.com/dcdpr/did-btcr2-js/issues?q=is%3Aopen+is%3Aissue+label%3A%22package%3A+api%22
[api-pulls-badge]: https://img.shields.io/github/issues-pr/dcdpr/did-btcr2-js/package%3A%20common?label=PRs
[api-pulls-link]: https://github.com/dcdpr/did-btcr2-js/pulls?q=is%3Aopen+is%3Apr+label%3A%22package%3A+api%22

[bitcoin-npm-badge]: https://img.shields.io/npm/v/@did-btcr2/bitcoin.svg?&color=green&santize=true
[bitcoin-npm-link]: https://www.npmjs.com/package/@did-btcr2/bitcoin
[bitcoin-issues-badge]: https://img.shields.io/github/issues/dcdpr/did-btcr2-js/package:%20common?label=issues
[bitcoin-issues-link]: https://github.com/dcdpr/did-btcr2-js/issues?q=is%3Aopen+is%3Aissue+label%3A%22package%3A+bitcoin%22
[bitcoin-pulls-badge]: https://img.shields.io/github/issues-pr/dcdpr/did-btcr2-js/package%3A%20common?label=PRs
[bitcoin-pulls-link]: https://github.com/dcdpr/did-btcr2-js/pulls?q=is%3Aopen+is%3Apr+label%3A%22package%3A+bitcoin%22

[cli-npm-badge]: https://img.shields.io/npm/v/@did-btcr2/cli.svg?&color=green&santize=true
[cli-npm-link]: https://www.npmjs.com/package/@did-btcr2/cli
[cli-issues-badge]: https://img.shields.io/github/issues/dcdpr/did-btcr2-js/package:%20cli?label=issues
[cli-issues-link]: https://github.com/dcdpr/did-btcr2-js/issues?q=is%3Aopen+is%3Aissue+label%3A%22package%3A+cli%22
[cli-pulls-badge]: https://img.shields.io/github/issues-pr/dcdpr/did-btcr2-js/package%3A%20cli?label=PRs
[cli-pulls-link]: https://github.com/dcdpr/did-btcr2-js/pulls?q=is%3Aopen+is%3Apr+label%3A%22package%3A+cli%22

[common-npm-badge]: https://img.shields.io/npm/v/@did-btcr2/common.svg?&color=green&santize=true
[common-npm-link]: https://www.npmjs.com/package/@did-btcr2/common
[common-issues-badge]: https://img.shields.io/github/issues/dcdpr/did-btcr2-js/package:%20common?label=issues
[common-issues-link]: https://github.com/dcdpr/did-btcr2-js/issues?q=is%3Aopen+is%3Aissue+label%3A%22package%3A+common%22
[common-pulls-badge]: https://img.shields.io/github/issues-pr/dcdpr/did-btcr2-js/package%3A%20common?label=PRs
[common-pulls-link]: https://github.com/dcdpr/did-btcr2-js/pulls?q=is%3Aopen+is%3Apr+label%3A%22package%3A+common%22

[cryptosuite-npm-badge]: https://img.shields.io/npm/v/@did-btcr2/cryptosuite.svg?&color=green&santize=true
[cryptosuite-npm-link]: https://www.npmjs.com/package/@did-btcr2/cryptosuite
[cryptosuite-issues-badge]: https://img.shields.io/github/issues/dcdpr/did-btcr2-js/package:%20cryptosuite?label=issues
[cryptosuite-issues-link]: https://github.com/dcdpr/did-btcr2-js/issues?q=is%3Aopen+is%3Aissue+label%3A%22package%3A+cryptosuite%22
[cryptosuite-pulls-badge]: https://img.shields.io/github/issues-pr/dcdpr/did-btcr2-js/package%3A%20cryptosuite?label=PRs
[cryptosuite-pulls-link]: https://github.com/dcdpr/did-btcr2-js/pulls?q=is%3Aopen+is%3Apr+label%3A%22package%3A+cryptosuite%22

[keypair-npm-badge]: https://img.shields.io/npm/v/@did-btcr2/keypair.svg?&color=green&santize=true
[keypair-npm-link]: https://www.npmjs.com/package/@did-btcr2/keypair
[keypair-issues-badge]: https://img.shields.io/github/issues/dcdpr/did-btcr2-js/package:%20keypair?label=issues
[keypair-issues-link]: https://github.com/dcdpr/did-btcr2-js/issues?q=is%3Aopen+is%3Aissue+label%3A%22package%3A+keypair%22
[keypair-pulls-badge]: https://img.shields.io/github/issues-pr/dcdpr/did-btcr2-js/package%3A%20keypair?label=PRs
[keypair-pulls-link]: https://github.com/dcdpr/did-btcr2-js/pulls?q=is%3Aopen+is%3Apr+label%3A%22package%3A+keypair%22

[method-npm-badge]: https://img.shields.io/npm/v/@did-btcr2/method.svg?&color=green&santize=true
[method-npm-link]: https://www.npmjs.com/package/@did-btcr2/method
[method-issues-badge]: https://img.shields.io/github/issues/dcdpr/did-btcr2-js/package:%20method?label=issues
[method-issues-link]: https://github.com/dcdpr/did-btcr2-js/issues?q=is%3Aopen+is%3Aissue+label%3A%22package%3A+method%22
[method-pulls-badge]: https://img.shields.io/github/issues-pr/dcdpr/did-btcr2-js/package%3A%20method?label=PRs
[method-pulls-link]: https://github.com/dcdpr/did-btcr2-js/pulls?q=is%3Aopen+is%3Apr+label%3A%22package%3A+method%22

[smt-npm-badge]: https://img.shields.io/npm/v/@did-btcr2/smt.svg?&color=green&santize=true
[smt-npm-link]: https://www.npmjs.com/package/@did-btcr2/smt
[smt-issues-badge]: https://img.shields.io/github/issues/dcdpr/did-btcr2-js/package:%20smt?label=issues
[smt-issues-link]: https://github.com/dcdpr/did-btcr2-js/issues?q=is%3Aopen+is%3Aissue+label%3A%22package%3A+smt%22
[smt-pulls-badge]: https://img.shields.io/github/issues-pr/dcdpr/did-btcr2-js/package%3A%20smt?label=PRs
[smt-pulls-link]: https://github.com/dcdpr/did-btcr2-js/pulls?q=is%3Aopen+is%3Apr+label%3A%22package%3A+smt%22
