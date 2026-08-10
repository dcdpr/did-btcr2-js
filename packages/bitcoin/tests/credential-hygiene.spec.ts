import { expect } from 'chai';
import { BitcoinRestClient } from '../src/client/rest/index.js';
import { JsonRpcProtocol } from '../src/client/rpc/protocol.js';
import type { HttpExecutor, HttpRequest } from '../src/client/http.js';
import { isInsecureRemoteHttp, redactUrlCredentials } from '../src/client/utils.js';

/** Capture console.warn calls for the duration of fn. */
function captureWarn(fn: () => void): string[] {
  const original = console.warn;
  const messages: string[] = [];
  console.warn = (...args: unknown[]) => { messages.push(args.map(String).join(' ')); };
  try { fn(); } finally { console.warn = original; }
  return messages;
}

describe('credential hygiene', () => {

  describe('JsonRpcProtocol cleartext-credential warning (M7)', () => {
    it('warns when basic auth is sent over cleartext HTTP to a remote host', () => {
      const warnings = captureWarn(() => {
        new JsonRpcProtocol({ host: 'http://node.example.com:8332', username: 'u', password: 'p' });
      });
      expect(warnings).to.have.lengthOf(1);
      expect(warnings[0]).to.match(/cleartext HTTP/);
      expect(warnings[0]).to.not.match(/\bp\b/);
    });

    it('warns when a configured Authorization header goes to a remote cleartext host', () => {
      const warnings = captureWarn(() => {
        new JsonRpcProtocol({ host: 'http://node.example.com:8332', headers: { Authorization: 'Basic xyz' } });
      });
      expect(warnings).to.have.lengthOf(1);
    });

    it('stays quiet for loopback cleartext hosts', () => {
      for (const host of [ 'http://localhost:18443', 'http://127.0.0.1:18443', 'http://[::1]:18443' ]) {
        const warnings = captureWarn(() => {
          new JsonRpcProtocol({ host, username: 'u', password: 'p' });
        });
        expect(warnings, host).to.have.lengthOf(0);
      }
    });

    it('stays quiet for HTTPS and for credential-free HTTP', () => {
      let warnings = captureWarn(() => {
        new JsonRpcProtocol({ host: 'https://node.example.com:8332', username: 'u', password: 'p' });
      });
      expect(warnings).to.have.lengthOf(0);
      warnings = captureWarn(() => {
        new JsonRpcProtocol({ host: 'http://node.example.com:8332' });
      });
      expect(warnings).to.have.lengthOf(0);
    });

    it('warns for credentials embedded in the URL userinfo', () => {
      const warnings = captureWarn(() => {
        new JsonRpcProtocol({ host: 'http://user:pass@node.example.com:8332' });
      });
      expect(warnings).to.have.lengthOf(1);
    });
  });

  describe('redactUrlCredentials (L11)', () => {
    it('strips userinfo from a parseable URL', () => {
      expect(redactUrlCredentials('http://user:pass@node.example.com:8332/'))
        .to.equal('http://node.example.com:8332/');
    });

    it('masks the authority segment of an unparseable URL', () => {
      const redacted = redactUrlCredentials('http://user:pass@not a url');
      expect(redacted).to.not.contain('pass');
    });

    it('leaves credential-free URLs untouched', () => {
      expect(redactUrlCredentials('http://node.example.com:8332')).to.equal('http://node.example.com:8332/');
    });
  });

  describe('isInsecureRemoteHttp (M7 helper)', () => {
    it('classifies hosts correctly', () => {
      expect(isInsecureRemoteHttp('http://node.example.com')).to.be.true;
      expect(isInsecureRemoteHttp('http://localhost:8332')).to.be.false;
      expect(isInsecureRemoteHttp('https://node.example.com')).to.be.false;
      expect(isInsecureRemoteHttp('not a url')).to.be.false;
    });
  });

  describe('invalid RPC URL logging (L11)', () => {
    it('logs the redacted URL, never the credentials', () => {
      const original = console.error;
      const messages: string[] = [];
      console.error = (...args: unknown[]) => { messages.push(args.map(String).join(' ')); };
      try {
        new JsonRpcProtocol({ host: 'http://user:supersecret@:' });
      } finally {
        console.error = original;
      }
      expect(messages).to.have.lengthOf(1);
      expect(messages[0]).to.not.contain('supersecret');
    });
  });

  describe('BitcoinRestClient error handling (L11)', () => {
    function mockExecutor(response: { status: number; body: string; contentType?: string }): { executor: HttpExecutor; seen: HttpRequest[] } {
      const seen: HttpRequest[] = [];
      const executor: HttpExecutor = async (req) => {
        seen.push(req);
        return new Response(response.body, {
          status     : response.status,
          statusText : 'Error',
          headers    : { 'Content-Type': response.contentType ?? 'application/json' },
        });
      };
      return { executor, seen };
    }

    it('throws a typed MethodError (not a raw parse error) for a non-JSON error body', async () => {
      const { executor } = mockExecutor({ status: 502, body: '<html>Bad Gateway</html>', contentType: 'text/html' });
      const rest = new BitcoinRestClient({ host: 'http://example.com' }, executor);
      try {
        await rest.block.count();
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.type).to.equal('FAILED_HTTP_REQUEST');
        expect(err.message).to.include('502');
      }
    });

    it('redacts userinfo credentials from the failing request URL in the error message', async () => {
      const { executor } = mockExecutor({ status: 500, body: '{}' });
      const rest = new BitcoinRestClient({ host: 'http://user:supersecret@example.com' }, executor);
      try {
        await rest.block.count();
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.message).to.not.contain('supersecret');
      }
    });
  });
});
