import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { expect } from 'chai';

import {
  BaseMessage,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  HTTP_ENVELOPE_VERSION,
  HttpTransportError,
  normalizeForWire,
  reviveFromWire,
  signEnvelope,
  verifyEnvelope,
} from '../src/index.js';
import { DidBtcr2 } from '@did-btcr2/method';

describe('HTTP transport envelope', () => {
  const senderKeys = SchnorrKeyPair.generate();
  const senderDid  = DidBtcr2.create(senderKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

  const otherKeys = SchnorrKeyPair.generate();
  const otherDid  = DidBtcr2.create(otherKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

  function makeMessage(overrides: Partial<ConstructorParameters<typeof BaseMessage>[0]> = {}): BaseMessage {
    return new BaseMessage({
      type : COHORT_ADVERT,
      from : senderDid,
      body : { cohortId: 'c1' },
      ...overrides,
    });
  }

  describe('signEnvelope', () => {
    it('produces a well-formed envelope without a recipient', () => {
      const env = signEnvelope(makeMessage(), { did: senderDid, keys: senderKeys });

      expect(env.v).to.equal(HTTP_ENVELOPE_VERSION);
      expect(env.from).to.equal(senderDid);
      expect(env.to).to.be.undefined;
      expect(env.nonce).to.have.lengthOf(32);      // 16 bytes hex
      expect(env.sig).to.have.lengthOf(128);       // 64 bytes hex
      expect(env.timestamp).to.be.a('number');
      expect(env.message).to.be.an('object');
      expect(env.message.type).to.equal(COHORT_ADVERT);
    });

    it('embeds the recipient when provided', () => {
      const env = signEnvelope(
        makeMessage(),
        { did: senderDid, keys: senderKeys },
        { to: otherDid },
      );

      expect(env.to).to.equal(otherDid);
    });

    it('honors caller-provided nonce and timestamp', () => {
      const nonce = '00'.repeat(16);
      const ts    = 1_234_567_890;
      const env   = signEnvelope(
        makeMessage(),
        { did: senderDid, keys: senderKeys },
        { nonce, timestamp: ts },
      );

      expect(env.nonce).to.equal(nonce);
      expect(env.timestamp).to.equal(ts);
    });

    it('normalizes BaseMessage via toJSON', () => {
      const env = signEnvelope(makeMessage(), { did: senderDid, keys: senderKeys });

      // Plain record, no class-instance methods leaked onto the wire shape.
      expect(env.message).to.not.have.property('toJSON');
      expect(env.message.version).to.equal(1);
    });

    it('accepts a plain record as the message payload', () => {
      const env = signEnvelope(
        { type: COHORT_ADVERT, from: senderDid, version: 1 },
        { did: senderDid, keys: senderKeys },
      );

      expect(env.message.type).to.equal(COHORT_ADVERT);
    });
  });

  describe('verifyEnvelope', () => {
    it('accepts a valid envelope round-trip', () => {
      const env = signEnvelope(makeMessage(), { did: senderDid, keys: senderKeys });
      verifyEnvelope(env, senderKeys.publicKey);
    });

    it('rejects an envelope with a tampered message body', () => {
      const env = signEnvelope(makeMessage(), { did: senderDid, keys: senderKeys });
      (env.message.body as { cohortId: string }).cohortId = 'tampered';

      expect(() => verifyEnvelope(env, senderKeys.publicKey))
        .to.throw(HttpTransportError).with.property('type', 'ENVELOPE_SIG_INVALID');
    });

    it('rejects an envelope with a tampered sender', () => {
      const env = signEnvelope(makeMessage(), { did: senderDid, keys: senderKeys });
      env.from = otherDid;

      expect(() => verifyEnvelope(env, senderKeys.publicKey))
        .to.throw(HttpTransportError).with.property('type', 'ENVELOPE_SIG_INVALID');
    });

    it('rejects an envelope with a tampered nonce', () => {
      const env = signEnvelope(makeMessage(), { did: senderDid, keys: senderKeys });
      env.nonce = 'ff'.repeat(16);

      expect(() => verifyEnvelope(env, senderKeys.publicKey))
        .to.throw(HttpTransportError).with.property('type', 'ENVELOPE_SIG_INVALID');
    });

    it('rejects an envelope signed by a different key', () => {
      const env = signEnvelope(makeMessage(), { did: senderDid, keys: senderKeys });

      expect(() => verifyEnvelope(env, otherKeys.publicKey))
        .to.throw(HttpTransportError).with.property('type', 'ENVELOPE_SIG_INVALID');
    });

    it('rejects an unknown envelope version', () => {
      const env = signEnvelope(makeMessage(), { did: senderDid, keys: senderKeys });
      env.v = 999;

      expect(() => verifyEnvelope(env, senderKeys.publicKey))
        .to.throw(HttpTransportError).with.property('type', 'ENVELOPE_VERSION_MISMATCH');
    });

    it('rejects a signature of the wrong length', () => {
      const env = signEnvelope(makeMessage(), { did: senderDid, keys: senderKeys });
      env.sig = 'ab'.repeat(32); // 32 bytes hex, not 64

      expect(() => verifyEnvelope(env, senderKeys.publicKey))
        .to.throw(HttpTransportError).with.property('type', 'ENVELOPE_SIG_LENGTH');
    });

    it('rejects a signature that is not valid hex', () => {
      const env = signEnvelope(makeMessage(), { did: senderDid, keys: senderKeys });
      env.sig = 'zzzz';

      expect(() => verifyEnvelope(env, senderKeys.publicKey))
        .to.throw(HttpTransportError);
    });

    it('rejects a timestamp outside the default skew window', () => {
      const env = signEnvelope(
        makeMessage(),
        { did: senderDid, keys: senderKeys },
        { timestamp: Math.floor(Date.now() / 1000) - 10 * 60 }, // 10 minutes old
      );

      expect(() => verifyEnvelope(env, senderKeys.publicKey))
        .to.throw(HttpTransportError).with.property('type', 'ENVELOPE_TIMESTAMP_SKEW');
    });

    it('respects a custom clock-skew tolerance', () => {
      const env = signEnvelope(
        makeMessage(),
        { did: senderDid, keys: senderKeys },
        { timestamp: Math.floor(Date.now() / 1000) - 10 * 60 },
      );

      verifyEnvelope(env, senderKeys.publicKey, { clockSkewSec: 15 * 60 });
    });

    it('respects an injected clock', () => {
      const ts  = 1_700_000_000;
      const env = signEnvelope(makeMessage(), { did: senderDid, keys: senderKeys }, { timestamp: ts });

      verifyEnvelope(env, senderKeys.publicKey, { now: () => (ts + 1) * 1000 });
    });

    // A timestamp that is not a number gives a NaN difference to the clock. The check
    // must refuse it at every clock value, else a replay passes the skew check forever.
    const nonNumericTimestamps: Array<[string, unknown]> = [
      ['a string that is not a number', 'abc'],
      ['an object', {}],
    ];
    for(const [label, timestamp] of nonNumericTimestamps) {
      it(`refuses a timestamp of ${label} with ENVELOPE_TIMESTAMP_SKEW`, () => {
        const env = signEnvelope(
          makeMessage(),
          { did: senderDid, keys: senderKeys },
          { timestamp: timestamp as number },
        );
        for(const nowMs of [0, 1_700_000_000_000]) {
          expect(() => verifyEnvelope(env, senderKeys.publicKey, { now: () => nowMs }))
            .to.throw(HttpTransportError).with.property('type', 'ENVELOPE_TIMESTAMP_SKEW');
        }
      });
    }

    it('enforces expectedFrom', () => {
      const env = signEnvelope(makeMessage(), { did: senderDid, keys: senderKeys });

      expect(() => verifyEnvelope(env, senderKeys.publicKey, { expectedFrom: otherDid }))
        .to.throw(HttpTransportError).with.property('type', 'ENVELOPE_FROM_MISMATCH');
    });

    it('enforces expectedTo for directed messages', () => {
      const env = signEnvelope(
        makeMessage(),
        { did: senderDid, keys: senderKeys },
        { to: otherDid },
      );

      expect(() => verifyEnvelope(env, senderKeys.publicKey, { expectedTo: senderDid }))
        .to.throw(HttpTransportError).with.property('type', 'ENVELOPE_TO_MISMATCH');
    });

    it('enforces expectedTo === undefined (broadcast-only)', () => {
      const env = signEnvelope(
        makeMessage(),
        { did: senderDid, keys: senderKeys },
        { to: otherDid },
      );

      expect(() => verifyEnvelope(env, senderKeys.publicKey, { expectedTo: undefined }))
        .to.throw(HttpTransportError).with.property('type', 'ENVELOPE_TO_MISMATCH');
    });
  });

  describe('verifyEnvelope nonce form (16 to 64 bytes of lowercase hex)', () => {
    // The signature covers the nonce, so each case signs with the override nonce: the
    // nonce check, not the signature check, must refuse it.
    const signWithNonce = (nonce: unknown, timestamp?: number) => signEnvelope(
      makeMessage(),
      { did: senderDid, keys: senderKeys },
      { nonce: nonce as string, ...(timestamp !== undefined ? { timestamp } : {}) },
    );

    const refused: Array<[string, unknown]> = [
      ['31 hex chars (odd length)', 'a'.repeat(31)],
      ['33 hex chars (odd length)', 'a'.repeat(33)],
      ['30 hex chars (15 bytes)', 'ab'.repeat(15)],
      ['130 hex chars (65 bytes)', 'ab'.repeat(65)],
      ['uppercase hex', 'AB'.repeat(16)],
      ['non-hex characters', 'zz'.repeat(16)],
      ['an empty string', ''],
      ['a number', 1234567890123456],
      // The text form of this array is valid hex: only the string type check refuses it.
      ['an array whose text is valid hex', ['ab'.repeat(16)]],
    ];
    for(const [label, nonce] of refused) {
      it(`refuses a nonce of ${label} with ENVELOPE_NONCE_INVALID`, () => {
        const env = signWithNonce(nonce);
        expect(() => verifyEnvelope(env, senderKeys.publicKey))
          .to.throw(HttpTransportError).with.property('type', 'ENVELOPE_NONCE_INVALID');
      });
    }

    it('accepts a nonce of 32 lowercase hex chars (16 bytes)', () => {
      verifyEnvelope(signWithNonce('ab'.repeat(16)), senderKeys.publicKey);
    });

    it('accepts a nonce of 128 lowercase hex chars (64 bytes)', () => {
      verifyEnvelope(signWithNonce('cd'.repeat(64)), senderKeys.publicKey);
    });

    it('checks the timestamp skew before the nonce form', () => {
      const env = signWithNonce('a'.repeat(31), Math.floor(Date.now() / 1000) - 10 * 60);
      expect(() => verifyEnvelope(env, senderKeys.publicKey))
        .to.throw(HttpTransportError).with.property('type', 'ENVELOPE_TIMESTAMP_SKEW');
    });

    it('checks the nonce form before the signature', () => {
      const env = signWithNonce('a'.repeat(31));
      env.sig = 'zz';
      expect(() => verifyEnvelope(env, senderKeys.publicKey))
        .to.throw(HttpTransportError).with.property('type', 'ENVELOPE_NONCE_INVALID');
    });
  });

  describe('Uint8Array wire encoding', () => {
    // Regression: without normalizeForWire/reviveFromWire, JSON.stringify on a
    // Uint8Array serializes it as an index-keyed object ({"0":1,"1":2,...}),
    // which verifyEnvelope's re-canonicalization still accepts (both sides
    // mangle consistently) but which reaches the handler as a broken object
    // instead of the original bytes. Caught in the HTTP e2e cohort advert on
    // `serviceCommunicationPk`.

    it('normalizeForWire replaces Uint8Array with a __bytes hex sentinel', () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      expect(normalizeForWire(bytes)).to.deep.equal({ __bytes: '01020304' });
    });

    it('reviveFromWire restores Uint8Array from a __bytes hex sentinel', () => {
      const revived = reviveFromWire({ __bytes: 'deadbeef' });
      expect(revived).to.be.instanceOf(Uint8Array);
      expect(Array.from(revived as Uint8Array)).to.deep.equal([0xde, 0xad, 0xbe, 0xef]);
    });

    it('reviveFromWire keeps a __proto__ member as an own member and sets no prototype', () => {
      const parsed = JSON.parse('{"body":{"cohortId":"c1","__proto__":{"communicationPk":{"__bytes":"0a0b"}}}}');
      const revived = reviveFromWire(parsed) as { body: Record<string, unknown> };
      expect(Object.getPrototypeOf(revived.body)).to.equal(Object.prototype);
      expect(Object.keys(revived.body)).to.deep.equal(['cohortId', '__proto__']);
      expect(revived.body.communicationPk).to.equal(undefined);
      const member = Object.getOwnPropertyDescriptor(revived.body, '__proto__')?.value as Record<string, unknown>;
      expect(member.communicationPk).to.be.instanceOf(Uint8Array);
      expect({ ...revived.body }.communicationPk).to.equal(undefined);
    });

    it('normalize + revive round-trips through nested structures', () => {
      const original = {
        topLevel : new Uint8Array([1, 2]),
        nested   : { inner: new Uint8Array([3, 4]) },
        array    : [new Uint8Array([5, 6]), new Uint8Array([7, 8])],
        scalar   : 'string stays string',
      };
      const wire    = normalizeForWire(original);
      const parsed  = JSON.parse(JSON.stringify(wire));
      const revived = reviveFromWire(parsed) as typeof original;
      expect(revived.scalar).to.equal('string stays string');
      expect(Array.from(revived.topLevel)).to.deep.equal([1, 2]);
      expect(Array.from(revived.nested.inner)).to.deep.equal([3, 4]);
      expect(Array.from(revived.array[0])).to.deep.equal([5, 6]);
      expect(Array.from(revived.array[1])).to.deep.equal([7, 8]);
    });

    it('preserves a Uint8Array field through sign -> JSON -> verify -> revive', () => {
      const pk = senderKeys.publicKey.compressed;
      const msg = new BaseMessage({
        type : COHORT_OPT_IN,
        from : senderDid,
        to   : otherDid,
        body : { cohortId: 'c1', participantPk: pk, communicationPk: pk },
      });

      const envelope  = signEnvelope(msg, { did: senderDid, keys: senderKeys }, { to: otherDid });
      // Simulate wire transit: stringify + parse.
      const onTheWire = JSON.parse(JSON.stringify(envelope));
      verifyEnvelope(onTheWire, senderKeys.publicKey, { expectedTo: otherDid });

      const revived = reviveFromWire(onTheWire.message) as {
        body: { participantPk: Uint8Array; communicationPk: Uint8Array };
      };
      expect(revived.body.participantPk).to.be.instanceOf(Uint8Array);
      expect(revived.body.communicationPk).to.be.instanceOf(Uint8Array);
      expect(Array.from(revived.body.participantPk)).to.deep.equal(Array.from(pk));
      expect(Array.from(revived.body.communicationPk)).to.deep.equal(Array.from(pk));
    });
  });
});
