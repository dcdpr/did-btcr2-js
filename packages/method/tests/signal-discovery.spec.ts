import { expect } from 'chai';
import { extractOpReturnSignal } from '../src/core/beacon/signal-discovery.js';

/**
 * Beacon signal extraction from a scriptPubKey asm string.
 *
 * A beacon signal output is exactly `OP_RETURN OP_PUSHBYTES_32 <32-byte hex>`
 * (the on-the-wire `0x6a 0x20 <32 bytes>` NULL_DATA shape, see
 * `op-return-script.spec.ts` for the encode side). {@link extractOpReturnSignal}
 * is the strict decoder: it returns the 32-byte hash only for that exact shape
 * and `null` for everything else, so a malformed or adversarial on-chain output
 * cannot be mistaken for a real signal during resolution. Before this guard, any
 * output containing the `OP_RETURN` keyword had its last asm token taken verbatim
 * as the signal hash, so a bare `OP_RETURN` or a wrong-size push produced a
 * phantom signal (e.g. the literal string `OP_RETURN`, or a short hex) that flowed
 * downstream as a real update reference.
 */
describe('extractOpReturnSignal', () => {
  const HASH = '570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a';

  it('extracts the 32-byte hash from a well-formed beacon signal output', () => {
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${HASH}`)).to.equal(HASH);
  });

  it('lowercases an uppercase hex payload so it matches hex-keyed sidecar maps', () => {
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${HASH.toUpperCase()}`)).to.equal(HASH);
  });

  it('tolerates surrounding and repeated whitespace', () => {
    expect(extractOpReturnSignal(`  OP_RETURN   OP_PUSHBYTES_32   ${HASH}  `)).to.equal(HASH);
  });

  it('returns null for undefined or empty input', () => {
    expect(extractOpReturnSignal(undefined)).to.equal(null);
    expect(extractOpReturnSignal('')).to.equal(null);
    expect(extractOpReturnSignal('   ')).to.equal(null);
  });

  it('returns null for a bare OP_RETURN with no data push', () => {
    expect(extractOpReturnSignal('OP_RETURN')).to.equal(null);
  });

  it('returns null for a wrong-size push opcode (not OP_PUSHBYTES_32)', () => {
    expect(extractOpReturnSignal('OP_RETURN OP_PUSHBYTES_4 deadbeef')).to.equal(null);
  });

  it('returns null when the payload is not exactly 32 bytes of hex (too short)', () => {
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${HASH.slice(0, 62)}`)).to.equal(null);
  });

  it('returns null when the payload is not exactly 32 bytes of hex (too long)', () => {
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${HASH}ab`)).to.equal(null);
  });

  it('returns null for a non-hex payload of the right length', () => {
    const nonHex = 'z'.repeat(64);
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${nonHex}`)).to.equal(null);
  });

  it('returns null for a multi-push OP_RETURN (more than one data element)', () => {
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${HASH} OP_PUSHBYTES_4 deadbeef`)).to.equal(null);
  });

  it('returns null for a non-OP_RETURN script', () => {
    // A p2wpkh scriptPubKey asm: no OP_RETURN, must never yield a signal.
    expect(extractOpReturnSignal('OP_0 OP_PUSHBYTES_20 751e76e8199196d454941c45d1b3a323f1433bd6')).to.equal(null);
  });

  it('returns null when OP_RETURN is present but not the leading opcode', () => {
    // OP_RETURN must be the first token of a NULL_DATA output; a script that merely
    // contains the keyword elsewhere is not a beacon signal.
    expect(extractOpReturnSignal(`OP_DUP OP_RETURN OP_PUSHBYTES_32 ${HASH}`)).to.equal(null);
  });
});
