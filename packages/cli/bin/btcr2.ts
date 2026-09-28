#!/usr/bin/env node
// The keystore needs crypto.argon2Sync, which starts in Node.js 24.7 (ADR 126).
// This check runs before the import of the cli, so that an older runtime gets a
// clear message and not an error from the module loader.
const [ major, minor ] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 7)) {
  process.stderr.write(`btcr2 needs Node.js 24.7 or later. This runtime is Node.js ${process.versions.node}.\n`);
  process.exit(1);
}

const { DidBtcr2Cli } = await import('../src/cli.js');
const cli = new DidBtcr2Cli();
await cli.run(process.argv);
