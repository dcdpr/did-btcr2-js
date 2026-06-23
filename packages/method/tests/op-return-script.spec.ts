import { expect } from 'chai';
import { opReturnScript } from '../src/core/beacon/beacon.js';

/**
 * OP_RETURN encoding for beacon signal txs.
 *
 * Bitcoin's NULL_DATA standardness rule (`IsStandard`) requires `OP_RETURN`
 * followed by a single minimal data push of at most 80 bytes. The on-the-wire
 * encoding of a 32-byte signal is `0x6a 0x20 <32 bytes>` = 34 bytes total.
 *
 * scure-btc-signer's `Script.encode` distinguishes opcodes from data by
 * argument type: strings (e.g. `'RETURN'`) are looked up in the opcode table
 * and emitted as the bare opcode byte; numbers outside `[0, 16]` are encoded
 * as ScriptNum data pushes. Passing the numeric `OP.RETURN` constant routes
 * through the ScriptNum path and emits `OP_PUSHBYTES_1 0x6a OP_PUSHBYTES_32
 * <32 bytes>` = 35 bytes - a non-standard script that Bitcoin Core rejects at
 * broadcast time with `sendrawtransaction RPC error -26: scriptpubkey`.
 *
 * These assertions pin the exact byte shape so the encoding contract is
 * exercised at the unit-test layer rather than only at broadcast time.
 */
describe('opReturnScript encodes the standard NULL_DATA shape', () => {
  it('produces `OP_RETURN <push><N>` for a 32-byte signal', () => {
    const signal = new Uint8Array(32).fill(0xab);
    const script = opReturnScript(signal);

    // Exact byte shape: 0x6a (OP_RETURN) + 0x20 (OP_PUSHBYTES_32) + 32 bytes.
    expect(script.length).to.equal(34);
    expect(script[0]).to.equal(0x6a); // OP_RETURN as the bare opcode
    expect(script[1]).to.equal(0x20); // OP_PUSHBYTES_32 prefix
    expect(Array.from(script.slice(2))).to.deep.equal(Array.from(signal));
  });

  it('does NOT emit `OP_PUSHBYTES_1 0x6a` (the ScriptNum routing of numeric OP.RETURN)', () => {
    // scure routes `Script.encode([OP.RETURN, ...])` through ScriptNum for
    // the numeric `OP.RETURN === 106`, emitting `0x01 0x6a` (push one byte).
    // Asserting the encoded length is not 35 and the first byte is not 0x01
    // pins the implementation to the string-mnemonic path.
    const signal = new Uint8Array(32);
    const script = opReturnScript(signal);
    expect(script.length).to.not.equal(35);
    expect(script[0]).to.not.equal(0x01);
  });

  it('round-trips through a known fixture', () => {
    // Empty (zeroed) 32-byte signal - predictable bytes for inspection.
    const signal = new Uint8Array(32);
    const script = opReturnScript(signal);
    const hex = Array.from(script).map(b => b.toString(16).padStart(2, '0')).join('');
    expect(hex).to.equal(
      '6a20' + '0000000000000000000000000000000000000000000000000000000000000000',
    );
  });
});
