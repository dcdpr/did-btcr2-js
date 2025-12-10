import { DidBtcr2Cli } from '../src/cli.js';
import Btcr2Command from '../src/command.js';

const cli = new DidBtcr2Cli();
console.log('cli', cli);
const program = cli.program;
program.exitOverride();
let captured: any;
Btcr2Command.prototype.execute = async (params: any) => { captured = params; return { action: 'create', did: 'ok' }; };

const argv = ['node', 'btcr2', 'create', '-t', 'k', '-n', 'bitcoin', '-b', 'aa'];

cli.run(argv);
console.log('cli', cli);

console.log('captured', captured);
// console.log('captured.action', captured.action);
// console.log('captured.options.type', captured.options.type);
// console.log('captured.options.network', captured.options.network);
// console.log('captured.options.bytes', captured.options.bytes);