import { COHORT_ADVERT } from "../../dist/types/core/beacon/aggregation/messages/keygen.js"
import { AggregateBeaconMessage } from "../../src/core/beacons/aggregation/cohort/messages/index.js"


const tags = [['COHORT_ADVERT', COHORT_ADVERT], ['p', 'laksdjfhbalsdkdgjb']]
const r = tags.find(([name, _]) => AggregateBeaconMessage.isValidType(name))
console.log('r', r)