import { DidDocument, Identifier, Btc1Read } from '../../src/index.js';
import initialDidDocument from '../in/resolve/key/initialDidDocument.json' with { type: 'json' };
import resolutionOptions from '../in/resolve/key/resolutionOptions.json' with { type: 'json' };

const identifier = 'did:btcr2:k1qgpzs6takyvuhv3dy8epaqhwee6eamxttprpn4k48ft4xyvw5sp3mvqqavunt';

const components = Identifier.decode(identifier);
console.log('components:', components);

// const initialDocument = await Btc1Read.initialDocument({ identifier, components, options });
// console.log('initialDocument:', initialDocument);

const initialDocument = new DidDocument(initialDidDocument);

const targetDocument = await Btc1Read.targetDocument({ initialDocument, options: resolutionOptions });
console.log('targetDocument:', targetDocument);