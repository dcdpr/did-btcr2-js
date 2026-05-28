// Demonstrates that danubetech's java SMT implementation skips the nonce when
// computing leaf values, deviating from the did:btcr2 spec.
//
// Spec reference:
//   https://dcdpr.github.io/did-btcr2/appendix/optimized-smt.html
//
// Quote from the spec:
//   "The value stored at a leaf node is the hash of a 256-bit nonce,
//    concatenated with the hash of the BTCR2 Update (the BTCR2 Update
//    Announcement) if available, then the resulting stream is hashed again.
//    I.e., `value = hash(hash(nonce) + hash(btcr2Update))` if there is a
//    BTCR2 Update or `value = hash(hash(nonce))` if there is not."
//
//   Empty-sibling rule: "The value of a node with one empty child and one
//   non-empty child is the value of the non-empty child."
//
// Run with:
//   pnpm tsx packages/method/lib/debug/smt-spec-divergence.ts
import { base64UrlToHash, blockHash, hashToHex } from '@did-btcr2/smt';

// ---- Test vectors 12a and 12b from danubetech's README ----
// https://github.com/danubetech/uni-resolver-driver-did-btcr2
//
// Both DIDs are entries in the SAME aggregated SMT (shared root).
// Their indices (SHA-256 of the DID string) diverge at the MSB, so the tree
// has exactly two non-empty leaves with all other slots empty. Per the spec's
// empty-sibling rule, the root reduces to `H(leaf_left, leaf_right)` ordered
// by index.
const vec = {
  '12a' : {
    did      : 'did:btcr2:x1q5h2tzafcundemvxuaxl9y0z922cwv8suev6c3un9xyvc3yuyxmjz3yadsd',
    nonce    : '4MLUvdyMMKjzOqU5F0zyMNIbR1279eduVIsDsod_TQo',
    updateId : 'QbPkfJIHH21IeMRyGiNg5NfKYt0TmCljg91evyo-MpU',
  },
  '12b' : {
    did      : 'did:btcr2:x1qhqkzp82h5266cyup4mthjfyrv27yasr7kn7l47escnplmw3vamyww8jqy8',
    nonce    : 'HZ6T_0Hrj463dlEhMPSJRzaZnFhOnNe0L-NFCeEidPk',
    updateId : 'SAGvc3PNM_JeqGZ8QG2aJdExqHdvUnYL8UkIPm18a9I',
  },
  claimedRoot : '65ebacc22f2c30dca075fb8a8e1f5819a51038ae333dc8ab209470cc803b6465',
} as const;

// 12b's index (SHA-256 of DID) begins with 0x1d (MSB = 0) -> left subtree.
// 12a's index begins with 0xe0 (MSB = 1) -> right subtree.
// So the spec-correct root = H(leaf_12b, leaf_12a).

function leafSpec(nonceB64: string, updateIdB64: string): Uint8Array {
  // Spec: value = hash(hash(nonce) || hash(btcr2Update))
  // where hash(btcr2Update) is the updateId (already a hash).
  const nonce    = base64UrlToHash(nonceB64);
  const updateId = base64UrlToHash(updateIdB64);
  return blockHash(blockHash(nonce), updateId);
}

function leafDanubetech(_nonceB64: string, updateIdB64: string): Uint8Array {
  // Danubetech's observed behavior: leaf = updateId directly. Nonce ignored.
  return base64UrlToHash(updateIdB64);
}

const claimed = vec.claimedRoot;

// ---- Spec-correct computation ----
const L12a_spec = leafSpec(vec['12a'].nonce, vec['12a'].updateId);
const L12b_spec = leafSpec(vec['12b'].nonce, vec['12b'].updateId);
const root_spec = blockHash(L12b_spec, L12a_spec);

// ---- Danubetech's observed computation ----
const L12a_dt = leafDanubetech(vec['12a'].nonce, vec['12a'].updateId);
const L12b_dt = leafDanubetech(vec['12b'].nonce, vec['12b'].updateId);
const root_dt = blockHash(L12b_dt, L12a_dt);

// ---- Report ----
console.log('SMT spec divergence — vector 12a/12b\n');

console.log('Spec-correct leaf hash:  value = SHA-256(SHA-256(nonce) || updateId)');
console.log('  L_12a =', hashToHex(L12a_spec));
console.log('  L_12b =', hashToHex(L12b_spec));
console.log('  root  = SHA-256(L_12b || L_12a) =', hashToHex(root_spec));
console.log('  matches claimed root? ', hashToHex(root_spec) === claimed);

console.log('\nDanubetech observed leaf hash:  value = updateId  (nonce ignored)');
console.log('  L_12a =', hashToHex(L12a_dt));
console.log('  L_12b =', hashToHex(L12b_dt));
console.log('  root  = SHA-256(L_12b || L_12a) =', hashToHex(root_dt));
console.log('  matches claimed root? ', hashToHex(root_dt) === claimed);

console.log('\nclaimed root in danubetech proof:');
console.log(' ', claimed);

const ourCorrect = hashToHex(root_spec) === claimed;
const dtCorrect  = hashToHex(root_dt) === claimed;
console.log('');
if (!ourCorrect && dtCorrect) {
  console.log('Conclusion: danubetech\'s proof verifies only when the leaf hash');
  console.log('skips the nonce. Per the spec at');
  console.log('  https://dcdpr.github.io/did-btcr2/appendix/optimized-smt.html');
  console.log('the leaf hash MUST be hash(hash(nonce) || hash(btcr2Update)).');
  console.log('Omitting the nonce destroys the blinding property the spec');
  console.log('introduces to make updates and non-updates indistinguishable.');
  process.exit(1);
}
