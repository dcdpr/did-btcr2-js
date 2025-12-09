import { DidBtcr2Cli } from '../src/cli.js';
import Btcr2Command from '../src/command.js';

const cli = new DidBtcr2Cli();
const program = cli.program;
program.exitOverride();
let captured: any;
Btcr2Command.prototype.execute = async (params: any) => { captured = params; return { action: 'create', did: 'ok' }; };
const argv = ['node', 'btcr2', 'create', '-t', 'k', '-n', 'bitcoin', '-b', 'aa'];
await cli.run(argv);
console.log('captured', captured);