import { DidBtcr2 } from "../../src/did-btcr2.js";

const resolution = await DidBtcr2.resolve("did:btcr2:k1qqparwdtw95n9je2kglg5lcsfyc75uzpw0a5tmgk7yeyy077cn7ayzqw942ln");
console.log(resolution);