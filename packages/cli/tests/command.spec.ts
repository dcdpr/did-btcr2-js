import { IdentifierTypes, Logger } from '@did-btcr2/common';
import { DidBtcr2 } from '@did-btcr2/method';
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
    const logs: string[] = [];
    console.log = (...args: any[]) => { logs.push(args.join(' ')); };

    (DidBtcr2 as any).create = async ({ idType, genesisBytes }: any) => {
      expect(idType).to.equal(IdentifierTypes.KEY);
      expect(genesisBytes).to.be.instanceOf(Uint8Array);
      return 'did:btcr2:key';
    };

    const command = new Btcr2Command();
    await command.execute({ action: 'create', options: { type: 'k', bytes: 'abcd' } });

    expect(logs[0]).to.equal('did:btcr2:key');
  });

  it('creates an external identifier', async () => {
    let receivedType: any;
    (DidBtcr2 as any).create = async ({ idType }: any) => {
      receivedType = idType;
      return 'did:btcr2:external';
    };

    const command = new Btcr2Command();
    await command.execute({ action: 'create', options: { type: 'x', bytes: 'abcd' } });

    expect(receivedType).to.equal(IdentifierTypes.EXTERNAL);
  });

  it('resolves an identifier (resolve alias)', async () => {
    const logs: string[] = [];
    console.log = (...args: any[]) => logs.push(args[0] as string);

    (DidBtcr2 as any).resolve = async (identifier: string, options: any) => {
      expect(identifier).to.equal('did:btcr2:example');
      expect(options).to.deep.equal({ network: 'bitcoin' });
      return { resolved: true };
    };

    const command = new Btcr2Command();
    await command.execute({ action: 'resolve', options: { identifier: 'did:btcr2:example', options: { network: 'bitcoin' } } });

    expect(JSON.parse(logs[0])).to.deep.equal({ resolved: true });
  });

  it('resolves an identifier (read alias)', async () => {
    let called = false;
    (DidBtcr2 as any).resolve = async () => {
      called = true;
      return { ok: true };
    };

    const command = new Btcr2Command();
    await command.execute({ action: 'read', options: { identifier: 'did:btcr2:alias', options: {} } });

    expect(called).to.be.true;
  });

  it('updates a document', async () => {
    const logs: string[] = [];
    console.log = (...args: any[]) => logs.push(args[0] as string);

    (DidBtcr2 as any).update = async (options: any) => {
      expect(options).to.deep.equal({ patch: [] });
      return { updated: true };
    };

    const command = new Btcr2Command();
    await command.execute({ action: 'update', options: { patch: [] } });

    expect(JSON.parse(logs[0])).to.deep.equal({ updated: true });
  });

  it('warns on deactivate/delete', async () => {
    const warnings: any[] = [];
    Logger.warn = (...args: any[]) => { warnings.push(args.join(' ')); };

    const command = new Btcr2Command();
    await command.execute({ action: 'deactivate', options: {} });

    expect(warnings[0]).to.include('TODO');
  });

  it('handles unknown commands gracefully', async () => {
    const errors: any[] = [];
    console.error = (...args: any[]) => errors.push(args[0]);

    const command = new Btcr2Command();
    await command.execute({ action: 'unknown', options: {} });

    expect(errors[0]).to.be.instanceOf(Error);
  });

  it('catches errors from handlers', async () => {
    const errors: any[] = [];
    console.error = (...args: any[]) => errors.push(args[0]);

    (DidBtcr2 as any).create = async () => { throw new Error('fail'); };

    const command = new Btcr2Command();
    await command.execute({ action: 'create', options: { type: 'k', bytes: 'abcd' } });

    expect((errors[0] as Error).message).to.equal('fail');
  });
});