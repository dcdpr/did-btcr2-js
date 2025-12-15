import { expect } from 'chai';

describe('bin entrypoint', () => {
  let originalRun: any;
  let originalArgv: string[];

  beforeEach(async () => {
    const cliModule = await import('../src/cli.js');
    originalRun = cliModule.DidBtcr2Cli.prototype.run;
    originalArgv = process.argv;
  });

  afterEach(async () => {
    const cliModule = await import('../src/cli.js');
    cliModule.DidBtcr2Cli.prototype.run = originalRun;
    process.argv = originalArgv;
  });

  it('instantiates DidBtcr2Cli and forwards process argv to run', async () => {
    const cliModule = await import('../src/cli.js');
    let receivedArgv: string[] | undefined;

    cliModule.DidBtcr2Cli.prototype.run = function (argv?: string[]) {
      receivedArgv = argv;
    };

    const fakeArgv = ['node', 'btcr2', '--version'];
    process.argv = fakeArgv;

    await import('../src/bin.js');

    expect(receivedArgv).to.equal(fakeArgv);
  });
});
