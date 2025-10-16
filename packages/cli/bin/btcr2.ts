#!/usr/bin/env node
import { DidBtcr2Cli } from '../src/cli.js';

// 1. Instantiate your CLI class
const cli = new DidBtcr2Cli();

// 2. Parse the real CLI arguments
cli.run();

// 3. Optionally force exit
process.exit(0);
