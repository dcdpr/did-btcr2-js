import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walks up from the compiled file location to find the CLI package.json.
 * Works from both dist/esm/ and tests/compiled/src/.
 */
function readVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
      if (pkg.name === '@did-btcr2/cli') return pkg.version;
    } catch { /* not found, go up */ }
    dir = dirname(dir);
  }
  return '0.0.0';
}

export const VERSION: string = readVersion();
