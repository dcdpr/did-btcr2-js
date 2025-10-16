
import resolutionOptions from '../in/resolve/external/resolutionOptions.json' with { type: 'json' };
import initialDidDoc from '../in/resolve/external/initialDidDoc.json' with { type: 'json' };
import { DidDocument, Identifier, Btc1Read } from '../../src/index.js';

const identifier = 'did:btcr2:x1qtdr376lhfvyxe466n67kyl2hzdxeh59z3axv4ud5jsxul75xac0yyrwykt';

const components = Identifier.decode(identifier);
console.log('components:', components);

// const initialDocument = await Btc1Read.initialDocument({ identifier, components, options });
// console.log('initialDocument:', initialDocument);

const initialDocument = new DidDocument(initialDidDoc);

const targetDocument = await Btc1Read.targetDocument({ initialDocument, options: resolutionOptions });
console.log('targetDocument:', targetDocument);