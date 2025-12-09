#!/usr/bin/env node
import { DidBtcr2Cli } from '../src/cli.js';

const cli = new DidBtcr2Cli();
await cli.run(process.argv);
