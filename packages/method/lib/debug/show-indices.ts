// Print the index = SHA-256(did) for each of the four vectors and show
// the top byte in binary so we can mentally walk the proof.
import { createHash } from 'node:crypto';

const DIDs = {
  '11a' : 'did:btcr2:x1q4cytk3ae3y74w2q0k2ukf5hqdjvn7c33ajdu5dwmvk76h3k4sqrqmvw4hp',
  '11b' : 'did:btcr2:x1q4plmrumnc5638xr74w59zg6yavk5laevq8r0jzm0xr7v2v0au655gn9xr0',
  '12a' : 'did:btcr2:x1q5h2tzafcundemvxuaxl9y0z922cwv8suev6c3un9xyvc3yuyxmjz3yadsd',
  '12b' : 'did:btcr2:x1qhqkzp82h5266cyup4mthjfyrv27yasr7kn7l47escnplmw3vamyww8jqy8',
};

const enc = new TextEncoder();

for (const [id, did] of Object.entries(DIDs)) {
  const hash = createHash('sha256').update(enc.encode(did)).digest();
  const hex = hash.toString('hex');
  const byte0 = hash[0]!;
  const byte31 = hash[hash.length - 1]!;

  // index as a 256-bit value: byte 0 is MSB. So bit 255 = MSB of byte 0.
  // Print top byte in binary (MSB-first) with bit-position labels.
  const top8 = byte0.toString(2).padStart(8, '0');
  const bot8 = byte31.toString(2).padStart(8, '0');

  console.log(`Vector ${id}:`);
  console.log(`  did    = ${did}`);
  console.log(`  index  = 0x${hex}`);
  console.log(`  top    bits 255..248 = ${top8}  (byte 0 = 0x${byte0.toString(16).padStart(2, '0')})`);
  console.log(`  bottom bits   7..  0 = ${bot8}  (byte 31 = 0x${byte31.toString(16).padStart(2, '0')})`);
  console.log('');
}
