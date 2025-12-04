import { BatchOption, RpcClientConfig } from '../../types.js';
import { safeText, toBase64 } from '../utils.js';

export class JsonRpcTransport {
  private url: string;
  private authHeader?: string;
  private id = 0;

  constructor(cfg: RpcClientConfig) {
    this.url = (cfg.host || 'http://127.0.0.1:8332').replace(/\/+$/, '');

    if (cfg.username && cfg.password) {
      this.authHeader = `Basic ${toBase64(`${cfg.username}:${cfg.password}`)}`;
    } else {
      try {
        const u = new URL(this.url);
        if (u.username || u.password) {
          this.authHeader = `Basic ${toBase64(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`)}`;
          u.username = ''; u.password = '';
          this.url = u.toString().replace(/\/+$/, '');
        }
      } catch(error: any) {
        console.error(`Invalid URL in Bitcoin RPC config: ${this.url}`, error);
      }
    }
  }

  /**
   * Make a JSON-RPC call or batch of calls to the Bitcoin node.
   * @param {BatchOption[] | { method: string; parameters?: any[] }} batch A single RPC call or an array of calls to be made.
   * @returns {Promise<any[] | any>} The result of the RPC call(s).
   * @example
   */
  async command(batch: BatchOption[] | { method: string; parameters?: any[] }): Promise<any[] | any> {
    if (Array.isArray(batch)) {
      const out: any[] = [];
      for (const item of batch) {
        out.push(await this.call(item.method, item.parameters ?? []));
      }
      return out;
    } else {
      return this.call(batch.method, batch.parameters ?? []);
    }
  }

  /**
   * Internal method to perform the actual JSON-RPC call.
   * @param {string} method The RPC method to call.
   * @param {any[]} params The parameters for the RPC method.
   * @returns {Promise<any>} The result of the RPC call.
   */
  private async call(method: string, params: any[]): Promise<any> {
    const body = { jsonrpc: '2.0', id: ++this.id, method, params };

    const res = await fetch(this.url, {
      method  : 'POST',
      headers : {
        'Content-Type' : 'application/json',
        ...(this.authHeader ? { Authorization: this.authHeader } : {})
      },
      body : JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await safeText(res);
      const err = new Error(text || `${res.status} ${res.statusText}`);
      (err as any).code = res.status;
      (err as any).rpc = true;
      throw err;
    }

    const payload = await res.json() as { result?: any; error?: { code: number; message: string } };
    if (payload.error) {
      const err = new Error(payload.error.message);
      (err as any).code = payload.error.code;
      (err as any).rpc = true;
      throw err;
    }
    return payload.result;
  }
}
