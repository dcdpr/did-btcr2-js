import { canonicalHashBytes, DidDocumentError, INVALID_DID_DOCUMENT, INVALID_DID_UPDATE, UpdateError } from '@did-btcr2/common';
import type { PatchOperation } from '@did-btcr2/common';
import { expect } from 'chai';
import { Identifier } from '../src/core/identifier.js';
import { Updater } from '../src/core/updater.js';
import { DidBtcr2 } from '../src/did-btcr2.js';
import { didCoreProblem, isDateTimeStamp, NOT_A_JSON_OBJECT } from '../src/utils/did-core-conformance.js';
import type { Btcr2DidDocument, DidDocumentLike } from '../src/utils/did-document.js';
import { DidDocument, GenesisDocument } from '../src/utils/did-document.js';
import type { DocumentChange } from './data/did-core-cases.js';
import { ACCEPT_CASES, PRODUCER_REFUSAL_CASES, REFUSAL_CASES } from './data/did-core-cases.js';
import externalData from './data/external-data.js';

/**
 * The DID Core v1.1 member rules (Controlled Identifiers v1.0, section 2) on each path that
 * checks a DID document: the write path (Updater.construct), the create path
 * (GenesisDocument.fromJSON, then validateGenesis('producer')), and the read path of an
 * EXTERNAL genesis document (Resolver.external). The write and create paths are producers;
 * the read path is a consumer. resolver.spec.ts runs the same cases on the read path of an
 * update.
 */

const fixture = externalData[0]!;

/** A copy of the external genesis fixture, changed by `change`. */
function genesisDocument(change: DocumentChange = () => {}): Record<string, any> {
  const document = JSON.parse(JSON.stringify(fixture.genesisDocument)) as Record<string, any>;
  change(document);
  return document;
}

/** The genesis fixture with the DID in place of the placeholder, changed by `change`. */
function didDocument(change: DocumentChange = () => {}): Record<string, any> {
  const document = JSON.parse(JSON.stringify(fixture.genesisDocument).replaceAll('did:btcr2:_', fixture.did)) as Record<string, any>;
  change(document);
  return document;
}

/** The EXTERNAL regtest DID whose genesis bytes are the hash of `document`. */
function didOf(document: object): string {
  return DidBtcr2.create(canonicalHashBytes(document), { idType: 'EXTERNAL', version: 1, network: 'regtest' });
}

/** A patch that replaces the whole document with `target`. */
function replaceAll(target: unknown): PatchOperation[] {
  return [{ op: 'replace', path: '', value: target }];
}

/** The error that `fn` throws. Fails the test if `fn` does not throw. */
function thrownBy(fn: () => unknown, label: string): any {
  try {
    fn();
  } catch(error) {
    return error;
  }
  expect.fail(`${label}: expected an error`);
}

describe('DID Core v1.1 member rules', () => {
  describe('didCoreProblem', () => {
    for(const { label, change } of ACCEPT_CASES) {
      it(`accepts ${label}`, () => {
        for(const role of ['consumer', 'producer'] as const) {
          expect(didCoreProblem(didDocument(change), role), role).to.equal(undefined);
          expect(didCoreProblem(genesisDocument(change), role), role).to.equal(undefined);
        }
      });
    }

    for(const { label, change, member, message } of REFUSAL_CASES) {
      it(`refuses ${label}`, () => {
        for(const role of ['consumer', 'producer'] as const) {
          expect(didCoreProblem(didDocument(change), role), role).to.deep.equal({ member, message });
          expect(didCoreProblem(genesisDocument(change), role), role).to.deep.equal({ member, message });
        }
      });
    }

    for(const { label, change, member, message } of PRODUCER_REFUSAL_CASES) {
      it(`accepts for a consumer and refuses for a producer: ${label}`, () => {
        expect(didCoreProblem(didDocument(change))).to.equal(undefined);
        expect(didCoreProblem(genesisDocument(change))).to.equal(undefined);
        expect(didCoreProblem(didDocument(change), 'producer')).to.deep.equal({ member, message });
        expect(didCoreProblem(genesisDocument(change), 'producer')).to.deep.equal({ member, message });
      });
    }

    it('gives the first problem in the order of DID Core section 5', () => {
      const document = didDocument(d => {
        d.service = null;
        d.keyAgreement = [];
        d.verificationMethod = 5;
        d.alsoKnownAs = 5;
        d.controller = 5;
      });
      const order = ['controller', 'alsoKnownAs', 'verificationMethod', 'keyAgreement', 'service'];
      for(const member of order) {
        expect(didCoreProblem(document)?.member).to.equal(member);
        delete document[member];
      }
      expect(didCoreProblem(document)).to.equal(undefined);
    });
  });

  describe('isDateTimeStamp', () => {
    for(const value of ['2030-01-01T00:00:00Z', '2030-01-01T00:00:00.123-05:00', '-0044-03-15T12:00:00+01:00', '2028-02-29T23:59:59Z']) {
      it(`accepts ${value}`, () => {
        expect(isDateTimeStamp(value)).to.equal(true);
      });
    }

    for(const value of ['2030-01-01T00:00:00', '2030-01-01', '2030-01-01 00:00:00Z', '2027-02-29T00:00:00Z', '2030-13-01T00:00:00Z', '', 1893456000, null, undefined]) {
      it(`refuses ${JSON.stringify(value)}`, () => {
        expect(isDateTimeStamp(value)).to.equal(false);
      });
    }
  });

  describe('the document root', () => {
    for(const root of [null, 5, 'x', [], [didDocument()]]) {
      it(`refuses the root ${JSON.stringify(root)?.slice(0, 20)} on every path`, () => {
        for(const [label, fn] of [
          ['DidDocument.isValid', () => DidDocument.isValid(root as DidDocumentLike)],
          ['new DidDocument', () => new DidDocument(root as DidDocumentLike)],
        ] as const) {
          const thrown = thrownBy(fn, label);
          expect(thrown, label).to.be.instanceOf(DidDocumentError);
          expect(thrown.type, label).to.equal(INVALID_DID_DOCUMENT);
          expect(thrown.message, label).to.equal(NOT_A_JSON_OBJECT);
        }
        // A patch can replace the root. Before, a null root gave a TypeError.
        const thrown = thrownBy(() => Updater.construct(didDocument() as Btcr2DidDocument, replaceAll(root), 1), 'Updater.construct');
        expect(thrown).to.be.instanceOf(UpdateError);
        expect(thrown.type).to.equal(INVALID_DID_UPDATE);
        expect(thrown.message).to.equal(`Error validating targetDocument: ${NOT_A_JSON_OBJECT}`);
      });
    }

    it('checks "@context" first in the constructor, then "id", then the members', () => {
      const cases: Array<[string, Record<string, any>, string]> = [
        ['no "@context", no id, service null', didDocument(d => { delete d['@context']; delete d.id; d.service = null; }), 'Invalid "@context"'],
        ['no "@context", verificationMethod null', didDocument(d => { delete d['@context']; d.verificationMethod = null; }), 'Invalid "@context"'],
        ['no id, service null', didDocument(d => { delete d.id; d.service = null; }), 'Invalid "id"'],
        ['an id that is not a DID, service null', didDocument(d => { d.id = 'x'; d.service = null; }), 'Invalid "id"'],
      ];
      for(const [label, document, message] of cases) {
        const thrown = thrownBy(() => new DidDocument(document as DidDocumentLike), label);
        expect(thrown, label).to.be.instanceOf(DidDocumentError);
        expect(thrown.message, label).to.equal(message);
      }
    });
  });

  describe('DID document and write path', () => {
    for(const { label, change } of ACCEPT_CASES) {
      it(`accepts ${label}`, () => {
        const document = didDocument(change);
        expect(DidDocument.isValid(document as DidDocumentLike)).to.equal(true);
        expect(new DidDocument(document as DidDocumentLike).toJSON()).to.deep.equal(document);
        expect(DidDocument.isValid(document as DidDocumentLike, 'producer')).to.equal(true);
        const unsigned = Updater.construct(didDocument() as Btcr2DidDocument, replaceAll(document), 1);
        expect(unsigned.targetVersionId).to.equal(2);
      });
    }

    for(const { label, change, member, message } of REFUSAL_CASES) {
      it(`refuses ${label}`, () => {
        const document = didDocument(change);
        const text = `Invalid "${member}": ${message}`;
        for(const [path, fn] of [
          ['DidDocument.isValid', () => DidDocument.isValid(document as DidDocumentLike)],
          ['new DidDocument', () => new DidDocument(document as DidDocumentLike)],
        ] as const) {
          const thrown = thrownBy(fn, path);
          expect(thrown, path).to.be.instanceOf(DidDocumentError);
          expect(thrown.type, path).to.equal(INVALID_DID_DOCUMENT);
          expect(thrown.message, path).to.equal(text);
        }
        const thrown = thrownBy(() => Updater.construct(didDocument() as Btcr2DidDocument, replaceAll(document), 1), 'Updater.construct');
        expect(thrown).to.be.instanceOf(UpdateError);
        expect(thrown.type).to.equal(INVALID_DID_UPDATE);
        expect(thrown.message).to.equal(`Error validating targetDocument: ${text}`);
      });
    }

    for(const { label, change, member, message } of PRODUCER_REFUSAL_CASES) {
      it(`accepts as a DID document and refuses on the write path: ${label}`, () => {
        const document = didDocument(change);
        const text = `Invalid "${member}": ${message}`;
        expect(DidDocument.isValid(document as DidDocumentLike)).to.equal(true);
        expect(new DidDocument(document as DidDocumentLike).toJSON()).to.deep.equal(document);
        const valid = thrownBy(() => DidDocument.isValid(document as DidDocumentLike, 'producer'), 'isValid producer');
        expect(valid).to.be.instanceOf(DidDocumentError);
        expect(valid.message).to.equal(text);
        const thrown = thrownBy(() => Updater.construct(didDocument() as Btcr2DidDocument, replaceAll(document), 1), 'Updater.construct');
        expect(thrown).to.be.instanceOf(UpdateError);
        expect(thrown.type).to.equal(INVALID_DID_UPDATE);
        expect(thrown.message).to.equal(`Error validating targetDocument: ${text}`);
      });
    }
  });

  describe('Genesis Document: the create path and the read path of an EXTERNAL DID', () => {
    for(const { label, change, placeholderFree } of ACCEPT_CASES) {
      it(`accepts ${label}`, () => {
        const genesis = genesisDocument(change);
        const document = GenesisDocument.fromJSON(genesis);
        expect(document.toJSON()).to.deep.equal(genesis);
        // The create path refuses an id with no placeholder (ADR 108).
        if(!placeholderFree) expect(document.validateGenesis('producer')).to.equal(true);
        // With a beacon, the resolver next asks for the signals. Without one, it resolves.
        const state = DidBtcr2.resolve(didOf(genesis), { sidecar: { genesisDocument: genesis } }).resolve();
        expect(state.status).to.be.oneOf(['action-required', 'resolved']);
      });
    }

    for(const { label, change, member, message } of REFUSAL_CASES) {
      it(`refuses ${label}`, () => {
        const genesis = genesisDocument(change);
        const created = thrownBy(() => GenesisDocument.fromJSON(genesis).validateGenesis('producer'), 'GenesisDocument.fromJSON');
        expect(created).to.be.instanceOf(DidDocumentError);
        expect(created.type).to.equal(INVALID_DID_DOCUMENT);
        expect(created.message).to.equal(`Invalid GenesisDocument ${member}: ${message}`);
        // Spec "If genesis_bytes is a SHA-256 Hash": current_document must conform to DID Core v1.1.
        const resolver = DidBtcr2.resolve(didOf(genesis), { sidecar: { genesisDocument: genesis } });
        const read = thrownBy(() => resolver.resolve(), 'Resolver.external');
        expect(read).to.be.instanceOf(DidDocumentError);
        expect(read.type).to.equal(INVALID_DID_DOCUMENT);
        expect(read.message).to.equal(`Invalid "${member}": ${message}`);
      });
    }

    for(const { label, change, member, message } of PRODUCER_REFUSAL_CASES) {
      it(`accepts on the read path and refuses on the create path: ${label}`, () => {
        const genesis = genesisDocument(change);
        const document = GenesisDocument.fromJSON(genesis);
        expect(document.toJSON()).to.deep.equal(genesis);
        const created = thrownBy(() => document.validateGenesis('producer'), 'validateGenesis producer');
        expect(created).to.be.instanceOf(DidDocumentError);
        expect(created.type).to.equal(INVALID_DID_DOCUMENT);
        expect(created.message).to.equal(`Invalid GenesisDocument ${member}: ${message}`);
        const state = DidBtcr2.resolve(didOf(genesis), { sidecar: { genesisDocument: genesis } }).resolve();
        expect(state.status).to.be.oneOf(['action-required', 'resolved']);
      });
    }

    it('checks the members before the placeholder in each id on the create path', () => {
      const genesis = genesisDocument(d => {
        d.verificationMethod[0].id = 'did:example:a#key-0';
        d.service[0].id = 'did:example:a#service-0';
      });
      const create = (): unknown => GenesisDocument.fromJSON(genesis).validateGenesis('producer');
      const placeholder = thrownBy(create, 'placeholder');
      expect(placeholder.message).to.equal('Invalid GenesisDocument verificationMethod: verificationMethod[0].id must contain "did:btcr2:_"');
      genesis.verificationMethod[0].id = 'did:btcr2:_#key-0';
      const service = thrownBy(create, 'service placeholder');
      expect(service.message).to.equal('Invalid GenesisDocument service: service[0].id must contain "did:btcr2:_"');
      genesis.service[0].type = 42;
      const member = thrownBy(create, 'member rule');
      expect(member.message).to.equal('Invalid GenesisDocument service: service[0].type must be a string or an array of strings');
    });

    it('GenesisDocument.create checks the rules of a producer', () => {
      const genesis = genesisDocument();
      const relationships = Object.fromEntries(
        ['authentication', 'assertionMethod', 'capabilityInvocation', 'capabilityDelegation'].map(name => [name, genesis[name]])
      );
      const service = [{ id: 'did:btcr2:_#links', type: 'LinkedDomains', serviceEndpoint: 'a.example' }];
      const thrown = thrownBy(() => GenesisDocument.create(genesis.verificationMethod, relationships, service as any), 'GenesisDocument.create');
      expect(thrown).to.be.instanceOf(DidDocumentError);
      expect(thrown.message).to.equal('Invalid GenesisDocument service: service[0].serviceEndpoint must be a URL');
      service[0].serviceEndpoint = 'https://a.example';
      expect(GenesisDocument.create(genesis.verificationMethod, relationships, service as any).validateGenesis('producer')).to.equal(true);
    });

    it('the check command uses the rules of the resolver', () => {
      // The resolver checks the document after it replaces each placeholder with the DID, as
      // a consumer. Thus an id with no placeholder and each producer rule pass.
      const changes: Array<[string, (d: Record<string, any>) => void]> = [
        ['an id with no placeholder', d => { d.service.push({ id: 'https://a.example/#links', type: 'LinkedDomains', serviceEndpoint: 'https://a.example' }); }],
        ...PRODUCER_REFUSAL_CASES.map(({ label, change }) => [label, change] as [string, (d: Record<string, any>) => void]),
      ];
      for(const [label, change] of changes) {
        const genesis = genesisDocument(change);
        const report = Identifier.validate(didOf(genesis), { genesisDocument: genesis });
        expect(report.valid, label).to.equal(true);
        const state = DidBtcr2.resolve(didOf(genesis), { sidecar: { genesisDocument: genesis } }).resolve();
        expect(state.status, label).to.be.oneOf(['action-required', 'resolved']);
      }
    });
  });
});
