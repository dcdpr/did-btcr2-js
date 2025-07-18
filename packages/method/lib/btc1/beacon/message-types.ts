import { AggregateBeaconMessage } from "../../../src/btc1/beacon/aggregate/cohort/messages/index.js";
import { COHORT_ADVERT } from "../../../src/index.js";

const tags = [['COHORT_ADVERT', COHORT_ADVERT], ['p', 'laksdjfhbalsdkdgjb']]
const r = tags.find(([name, _]) => AggregateBeaconMessage.isValidType(name))
console.log('r', r)