import { DidBtcr2Cli } from "../src/cli.js";

const cli = new DidBtcr2Cli();
await cli.run(['node']);
console.log('cli.program.args', cli.program.args);
