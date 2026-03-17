import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { MethodOperations } from '../src/types.js';

chai.use(chaiAsPromised);
export const { expect } = chai;

export const originalConsoleLog = console.log;
export const originalConsoleError = console.error;
export const originalConsoleWarn = console.warn;

/**
 * Creates a mock MethodOperations with sensible defaults.
 * Override individual methods via the overrides parameter.
 */
export function createMockOps(overrides: Partial<MethodOperations> = {}): MethodOperations {
  return {
    create  : overrides.create  ?? (() => 'did:btcr2:mock'),
    resolve : overrides.resolve ?? (async () => ({} as any)),
    update  : overrides.update  ?? (async () => ({} as any)),
  };
}
