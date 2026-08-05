import { expect } from 'chai';
import { Appendix } from '../src/utils/appendix.js';

const VALID_CAP_ID = 'urn:zcap:root:did%3Abtcr2%3Ak1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u';

describe('Appendix.dereferenceZcapId', () => {
  it('dereferences a well-formed root capability id', () => {
    const cap = Appendix.dereferenceZcapId(VALID_CAP_ID);
    expect(cap.controller).to.equal('did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u');
    expect(cap.invocationTarget).to.equal('did:btcr2:k1q0rnnwf657vuu8trztlczvlmphjgc6q598h79cm6sp7c4fgqh0fkc0vzd9u');
  });

  it('rejects a capability id with trailing segments (audit L9)', () => {
    expect(() => Appendix.dereferenceZcapId(`${VALID_CAP_ID}:extra`)).to.throw(/Invalid capabilityId/);
  });

  it('rejects a capability id with too few segments', () => {
    expect(() => Appendix.dereferenceZcapId('urn:zcap:root')).to.throw(/Invalid capabilityId/);
  });

  it('rejects a capability id with a wrong scheme or type segment', () => {
    expect(() => Appendix.dereferenceZcapId('http:zcap:root:did%3Abtcr2%3Ak1x')).to.throw(/Invalid capabilityId/);
    expect(() => Appendix.dereferenceZcapId('urn:foo:root:did%3Abtcr2%3Ak1x')).to.throw(/Invalid capabilityId/);
  });

  it('rejects a malformed percent-encoding with a typed error, not a raw URIError', () => {
    expect(() => Appendix.dereferenceZcapId('urn:zcap:root:did%E0%A4%A')).to.throw(/Invalid capabilityId/);
  });
});
