import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Mocha root hooks: each test runs with `$BTCR2_HOME` set to a new, empty home
 * named `btcr2`. A command under test that uses the default home then writes
 * its config file, keystore, and identifier records there, never in the real
 * home of the user. A spec that sets `$BTCR2_HOME` itself restores the value
 * of this hook in its own `afterEach`.
 */
let root: string | undefined;
let previous: string | undefined;

export const mochaHooks = {
  beforeEach(): void {
    previous = process.env.BTCR2_HOME;
    root = mkdtempSync(join(tmpdir(), 'btcr2-test-home-'));
    const home = join(root, 'btcr2');
    mkdirSync(home, { mode: 0o700 });
    process.env.BTCR2_HOME = home;
  },
  afterEach(): void {
    if (previous === undefined) delete process.env.BTCR2_HOME;
    else process.env.BTCR2_HOME = previous;
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  },
};
