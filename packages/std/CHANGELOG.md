# @did-btcr2/std

## 0.1.0

### Minor Changes

- Three packages get new names (ADR 159).

  - std: the first version of `@did-btcr2/std`. It holds the code of `@did-btcr2/common` 11.0.0 with no change. The history of `@did-btcr2/common` is at https://github.com/dcdpr/did-btcr2-js/blob/9c260b13/packages/common/CHANGELOG.md.
  - integrity: the first version of `@did-btcr2/integrity`. It holds the code of `@did-btcr2/cryptosuite` 11.0.0 with no change. The history is at https://github.com/dcdpr/did-btcr2-js/blob/9c260b13/packages/cryptosuite/CHANGELOG.md.
  - keys: the first version of `@did-btcr2/keys`. It holds the code of `@did-btcr2/keypair` 0.13.3 with no change. The history is at https://github.com/dcdpr/did-btcr2-js/blob/9c260b13/packages/keypair/CHANGELOG.md.
  - bitcoin, key-manager, method, aggregation, api: Breaking: each package uses the new packages in place of the old packages (bitcoin uses only std). A class of an old package is not the class of the new package: `instanceof` gives `false`. TypeScript also refuses a key class of `@did-btcr2/keypair` and a `SchnorrMultikey` of `@did-btcr2/cryptosuite` in place of the new class (TS2322). Import each class and each type from the new package.
  - cli: dependency uptake.
