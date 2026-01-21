import { IdentifierTypes, Logger, MethodError } from '@did-btcr2/common';
import { DidBtcr2, DidDocument } from '@did-btcr2/method';
import Btcr2Command from '../src/command.js';
import { expect, originalConsoleError, originalConsoleLog, originalConsoleWarn } from './helpers.js';

describe('Btcr2Command', () => {
  const originalCreate = DidBtcr2.create;
  const originalResolve = DidBtcr2.resolve;
  const originalUpdate = DidBtcr2.update;

  afterEach(() => {
    (DidBtcr2 as any).create = originalCreate;
    (DidBtcr2 as any).resolve = originalResolve;
    (DidBtcr2 as any).update = originalUpdate;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });

  it('creates a key identifier', async () => {
    (DidBtcr2 as any).create = async (genesisBytes: any, options: any) => {
      expect(options.idType).to.equal(IdentifierTypes.KEY);
      expect(genesisBytes).to.be.instanceOf(Uint8Array);
      expect(options.network).to.equal('bitcoin');
      return 'did:btcr2:key';
    };

    const command = new Btcr2Command();
    const result = await command.execute({ action: 'create', options: { type: 'k', bytes: 'abcd', network: 'bitcoin' } });
    if (result.action !== 'create') throw new Error('Expected create result');

    expect(result).to.deep.equal({ action: 'create', did: 'did:btcr2:key' });
  });

  it('creates an external identifier', async () => {
    let receivedType: any;
    (DidBtcr2 as any).create = async ({ options: { idType } }: any) => {
      console.log('Received idType:', idType);
      receivedType = idType;
      return 'did:btcr2:external';
    };

    const command = new Btcr2Command();
    const result = await command.execute({ action: 'create', options: { type: 'x', bytes: 'abcd', network: 'bitcoin' } });
    if (result.action !== 'create') throw new Error('Expected create result');

    expect(receivedType).to.equal(IdentifierTypes.EXTERNAL);
    expect(result.did).to.equal('did:btcr2:external');
  });

  it('resolves an identifier (resolve alias)', async () => {
    (DidBtcr2 as any).resolve = async (identifier: string, options: any) => {
      expect(identifier).to.equal('did:btcr2:example');
      expect(options).to.deep.equal({ network: 'bitcoin' });
      return { resolved: true };
    };

    const command = new Btcr2Command();
    const result = await command.execute({
      action  : 'resolve',
      options : {
        identifier : 'did:btcr2:example',
        options    : { network: 'bitcoin', drivers: {} },
      }
    });
    if (result.action !== 'resolve' && result.action !== 'read') throw new Error('Expected resolve result');

    expect(result.action).to.equal('resolve');
    expect(result.resolution).to.deep.equal({ resolved: true });
  });

  it('resolves an identifier (read alias)', async () => {
    let called = false;
    (DidBtcr2 as any).resolve = async () => {
      called = true;
      return { ok: true };
    };

    const command = new Btcr2Command();
    const result = await command.execute({
      action  : 'read',
      options : {
        identifier : 'did:btcr2:alias',
        options    : { drivers: {} }
      }
    });
    if (result.action !== 'resolve' && result.action !== 'read') throw new Error('Expected resolve/read result');

    expect(called).to.be.true;
    expect(result.resolution).to.deep.equal({ ok: true });
  });

  it('updates a document', async () => {
    (DidBtcr2 as any).update = async (options: any) => {
      expect(options).to.deep.equal({
        identifier           : 'did:btcr2:example',
        sourceDocument       : { id: 'did:btcr2:example' },
        sourceVersionId      : 1,
        patch                : [],
        verificationMethodId : 'vm',
        beaconIds            : [],
      });
      return { updated: true };
    };

    const command = new Btcr2Command();
    const result = await command.execute({
      action  : 'update',
      options : {
        identifier           : 'did:btcr2:example',
        sourceDocument       : { id: 'did:btcr2:example' } as DidDocument,
        sourceVersionId      : 1,
        patch                : [],
        verificationMethodId : 'vm',
        beaconIds            : [],
      },
    });
    if (result.action !== 'update') throw new Error('Expected update result');

    expect(result.sidecar).to.deep.equal({ updated: true });
  });

  it('warns on deactivate/delete', async () => {
    const warnings: any[] = [];
    Logger.warn = (...args: any[]) => { warnings.push(args.join(' ')); };

    const command = new Btcr2Command();
    const result = await command.execute({ action: 'deactivate', options: {} });
    if (result.action !== 'deactivate' && result.action !== 'delete') throw new Error('Expected deactivate result');

    expect(warnings[0]).to.include('TODO');
    expect(result.message).to.include('not yet implemented');
  });

  it('throws for unknown commands', async () => {
    const command = new Btcr2Command();
    await expect(command.execute({ action: 'unknown' as any, options: {} })).to.be.rejectedWith(MethodError);
  });

  it('propagates handler errors', async () => {
    (DidBtcr2 as any).create = async () => { throw new Error('fail'); };

    const command = new Btcr2Command();
    await expect(command.execute({ action: 'create', options: { type: 'k', bytes: 'abcd', network: 'bitcoin' } })).to.be.rejectedWith('fail');
  });
});
