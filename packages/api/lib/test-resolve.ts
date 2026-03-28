import { DidBtcr2Api } from '../src/api.js';

const api = new DidBtcr2Api({ btc: { network: 'mutinynet' } });
const res = await api.resolveDid('did:btcr2:k1q5psrwzjhw7nkxd0vshleh42lpk87tz80f24f2s6wjuntg8jpv8ykmqj7ec8p');
console.log('res', res);
