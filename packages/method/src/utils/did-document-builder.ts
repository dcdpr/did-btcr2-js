import { DidDocumentError, INVALID_DID_DOCUMENT } from '@did-btcr2/common';
import { BeaconService } from '../core/beacons/interface.js';
import { DidDocument, DidVerificationMethod } from './did-document.js';

export class DidDocumentBuilder {
  private document: Partial<DidDocument> = {};

  constructor(initialDocument: Partial<DidDocument>) {
    if (!initialDocument.id) {
      throw new DidDocumentError('Missing required "id" property', INVALID_DID_DOCUMENT, initialDocument);
    }
    this.document.id = initialDocument.id;
    this.document.verificationMethod = initialDocument.verificationMethod ?? [];

    if (initialDocument['@context']) {
      this.document['@context'] = initialDocument['@context'];
    }
  }

  withController(controller?: Array<string>): this {
    if (controller) {
      this.document.controller = controller ?? [this.document.id!];
    }
    return this;
  }

  withAuthentication(authentication: Array<string | DidVerificationMethod>): this {
    if (authentication) {
      this.document.authentication = authentication;
    }
    return this;
  }

  withAssertionMethod(assertionMethod: Array<string | DidVerificationMethod>): this {
    if (assertionMethod) {
      this.document.assertionMethod = assertionMethod;
    }
    return this;
  }

  withCapabilityInvocation(capabilityInvocation: Array<string | DidVerificationMethod>): this {
    if (capabilityInvocation) {
      this.document.capabilityInvocation = capabilityInvocation;
    }
    return this;
  }

  withCapabilityDelegation(capabilityDelegation: Array<string | DidVerificationMethod>): this {
    if (capabilityDelegation) {
      this.document.capabilityDelegation = capabilityDelegation;
    }
    return this;
  }

  withService(service: Array<BeaconService>): this {
    if (service) {
      this.document.service = service;
    }
    return this;
  }

  build(): DidDocument {
    const didDocument = new DidDocument(this.document as DidDocument);

    for (const key of Object.keys(didDocument)) {
      if (didDocument[key as keyof DidDocument] === undefined) {
        delete didDocument[key as keyof DidDocument];
      }
    }

    return didDocument;
  }
}
