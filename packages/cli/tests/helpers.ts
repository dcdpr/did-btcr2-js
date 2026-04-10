import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { createApi } from '@did-btcr2/api';
import type { ApiFactory } from '../src/config.js';

chai.use(chaiAsPromised);
export const { expect } = chai;

export const originalConsoleLog = console.log;
export const originalConsoleError = console.error;
export const originalConsoleWarn = console.warn;

/**
 * Creates an {@link ApiFactory} for testing.
 * No Bitcoin or CAS configured — suitable for create-only tests and
 * argument-validation tests (which throw before reaching the API).
 */
export function createTestApiFactory(): ApiFactory {
  return () => createApi();
}
