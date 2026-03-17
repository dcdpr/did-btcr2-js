import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from './helpers.js';
import { VERSION } from '../src/version.js';

describe('VERSION', () => {
  it('matches the version in package.json', () => {
    // Read package.json directly from the known package root
    let dir = dirname(fileURLToPath(import.meta.url));
    let pkg: { version: string } | undefined;
    for (let i = 0; i < 5; i++) {
      try {
        const candidate = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
        if (candidate.name === '@did-btcr2/cli') { pkg = candidate; break; }
      } catch { /* keep walking */ }
      dir = dirname(dir);
    }
    expect(pkg).to.exist;
    expect(VERSION).to.equal(pkg!.version);
  });

  it('is a valid semver string', () => {
    expect(VERSION).to.match(/^\d+\.\d+\.\d+/);
  });
});
