import { AggregateBeaconMessage, BEACON_COHORT_ADVERT } from '../../../src/index.js';

const tags = [['COHORT_ADVERT', BEACON_COHORT_ADVERT], ['p', 'laksdjfhbalsdkdgjb']];
const r = tags.find(([name, _]) => AggregateBeaconMessage.isValidType(name));
console.log('r', r);