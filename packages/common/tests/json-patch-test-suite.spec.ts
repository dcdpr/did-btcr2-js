import { expect } from 'chai';
import { createRequire } from 'node:module';
import { JSONPatch, MethodError, type PatchOperation } from '../src/index.js';

/**
 * A case of the JSON Patch test suite (https://github.com/json-patch/json-patch-tests).
 * A case with `error` must fail. A case with `expected` must give that document. A case
 * with neither must apply with no error. The suite does not run a `disabled` case.
 */
interface SuiteCase {
  comment?: string;
  doc: unknown;
  patch: unknown;
  expected?: unknown;
  error?: string;
  disabled?: boolean;
}

const require = createRequire(import.meta.url);
const files: Array<[string, SuiteCase[]]> = [
  ['tests.json', require('json-patch-test-suite/tests.json')],
  ['spec_tests.json', require('json-patch-test-suite/spec_tests.json')],
];

describe('the JSON Patch test suite (json-patch-tests)', () => {
  it('has 108 enabled cases', () => {
    const enabled = files.flatMap(([, cases]) => cases).filter(c => !c.disabled);
    expect(enabled).to.have.length(108);
  });

  for (const [file, cases] of files) {
    describe(file, () => {
      cases.forEach((c, index) => {
        if (c.disabled) return;
        it(`#${index}: ${c.comment ?? JSON.stringify(c.patch)}`, () => {
          const apply = (): unknown => JSONPatch.apply(c.doc as Record<string, unknown>, c.patch as PatchOperation[]);
          if (c.error !== undefined) {
            expect(apply).to.throw(MethodError).with.property('type', 'JSON_PATCH_APPLY_ERROR');
          } else if ('expected' in c) {
            expect(apply()).to.deep.equal(c.expected);
          } else {
            expect(apply).not.to.throw();
          }
        });
      });
    });
  }
});
