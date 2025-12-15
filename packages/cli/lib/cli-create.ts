import { Command } from "commander";
import { DidBtcr2Cli } from "../src/cli.js";

const cli = new DidBtcr2Cli();
const create = cli.program.commands.find((cmd: Command) => cmd.name() === 'create');
if (!create) {
  throw new Error(`Subcommand create not found`);
}
console.log('create', create);
let invoked: any;
const results: any[] = [];

(cli as any).invokeCommand = async (params: any) => { invoked = params; return { action: 'create', did: 'did:btcr2:abc' }; };
(cli as any).printResult = (result: any) => results.push(result);

await (create as any)._actionHandler([], { type: 'k', network: 'bitcoin', bytes: 'aa' }, create);

console.log('invoked', invoked);
// console.log('invoked.action', invoked.action);
// console.log('invoked.options', invoked.options);
console.log('results', results);