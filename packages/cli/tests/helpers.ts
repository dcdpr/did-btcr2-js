import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { createApi, DidBtcr2Api } from '@did-btcr2/api';

chai.use(chaiAsPromised);
export const { expect } = chai;

export const originalConsoleLog = console.log;
export const originalConsoleError = console.error;
export const originalConsoleWarn = console.warn;

/**
 * Creates a DidBtcr2Api instance for testing.
 * No Bitcoin or CAS configured — suitable for create-only tests.
 */
export function createTestApi(): DidBtcr2Api {
  return createApi();
}
