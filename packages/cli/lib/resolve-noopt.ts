import type { Command } from 'commander';
import { DidBtcr2Cli } from '../src/cli.js';
import { DidApi } from '@did-btcr2/api';

const cli = new DidBtcr2Cli();
(DidApi.prototype as any).decode = () => ({ network: 'bitcoin' });
const resolve = cli.program.commands.find((cmd) => cmd.name() === 'resolve') as Command;
await resolve.parseAsync(['-i', 'did:btcr2:valid'], { from: 'user' });
