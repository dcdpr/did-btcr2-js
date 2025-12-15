import { IdentifierTypes, MethodError } from '@did-btcr2/common';
import { DidBtcr2 } from '@did-btcr2/method';
import { expect } from 'chai';
import Btcr2Command from '../src/command.js';

describe('Btcr2Command', () => {
  let command: Btcr2Command;
  let originalCreate: any;
  let originalResolve: any;
  let originalUpdate: any;
  let originalLog: any;
  let originalError: any;
  let originalWarn: any;
  let logs: any[];
  let errors: any[];
  let warns: any[];

  beforeEach(() => {
    command = new Btcr2Command();
    logs = [];
    errors = [];
    warns = [];

    originalCreate = DidBtcr2.create;
    originalResolve = DidBtcr2.resolve;
    originalUpdate = DidBtcr2.update;
    originalLog = console.log;
    originalError = console.error;
    originalWarn = console.warn;

    console.log = (...args: any[]) => {
      logs.push(args);
    };
    console.error = (...args: any[]) => {
      errors.push(args);
    };
    console.warn = (...args: any[]) => {
      warns.push(args);
    };
  });

  afterEach(() => {
    DidBtcr2.create = originalCreate;
    DidBtcr2.resolve = originalResolve;
    DidBtcr2.update = originalUpdate;
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  });

  it('creates a did:btcr2 identifier with hex bytes', async () => {
    let received: any;
    DidBtcr2.create = (async (params: any) => {
      received = params;
      return 'did:btcr2:created';
    }) as any;

    await command.execute({ action: 'create', options: { type: 'k', bytes: '0a0b' } });

    expect(received.idType).to.equal(IdentifierTypes.KEY);
    expect(Array.from(received.genesisBytes)).to.deep.equal([10, 11]);
    expect(logs[0][0]).to.equal('did:btcr2:created');
  });

  it('resolves an identifier and logs formatted JSON', async () => {
    const resolution = { target: 'doc' };
    let resolverArgs: any[] = [];
    DidBtcr2.resolve = (async (identifier: string, options?: any) => {
      resolverArgs = [identifier, options];
      return resolution;
    }) as any;

    await command.execute({
      action  : 'resolve',
      options : { identifier: 'did:btcr2:abc', options: { network: 'bitcoin' } },
    });

    expect(resolverArgs[0]).to.equal('did:btcr2:abc');
    expect(resolverArgs[1]).to.deep.equal({ network: 'bitcoin' });
    expect(JSON.parse(logs[0][0])).to.deep.equal(resolution);
  });

  it('updates an identifier and logs the update result', async () => {
    const updateResult = { ok: true };
    let updateOptions: any;
    DidBtcr2.update = (async (options: any) => {
      updateOptions = options;
      return updateResult;
    }) as any;

    await command.execute({ action: 'update', options: { payload: 1 } });

    expect(updateOptions).to.deep.equal({ payload: 1 });
    expect(JSON.parse(logs[0][0])).to.deep.equal(updateResult);
  });

  it('warns when deactivate is invoked', async () => {
    await command.execute({ action: 'deactivate', options: {} });

    expect(warns[0][0]).to.contain('TODO');
  });

  it('logs MethodError for an invalid action', async () => {
    await command.execute({ action: 'unknown', options: {} });

    const loggedError = errors[0][0];
    expect(loggedError).to.be.instanceOf(MethodError);
    expect((loggedError as MethodError).type).to.equal('INVALID_COMMAND');
  });
});
