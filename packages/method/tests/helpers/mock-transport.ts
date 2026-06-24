/**
 * Historical test-helper names for the in-process transport. The implementation
 * was promoted to a first-class adapter ({@link InMemoryTransport} /
 * {@link InMemoryBus}); these aliases keep existing specs working unchanged.
 */
export {
  InMemoryBus as MessageBus,
  InMemoryTransport as MockTransport,
} from '@did-btcr2/aggregation';
