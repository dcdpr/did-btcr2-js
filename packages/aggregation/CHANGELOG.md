# @did-btcr2/aggregation

## 0.9.1

### Patch Changes

- `BTCR2MerkleTree` refuses a nonce that is not 256 bits, and the SMT proof verifier accepts a nonce of any length (ADR 166).

  - smt: Breaking: `BTCR2MerkleTree.addEntries` refuses a `nonce` that is not 32 bytes, also a longer `nonce`, with a `RangeError`. The message is `Invalid nonce: expected 32 bytes, got <n>`. An entry without a `nonce` does not change. `leafValue`, `verifyProof`, `verifySerializedProof`, `deserializeProof`, and `serializeProof` accept a `nonce` of any length, as before.
  - api: Breaking: `SmtApi.build` refuses an entry `nonce` that decodes to a length other than 32 bytes, also `''`, with the same `RangeError`. The browser bundle holds the smt package.
  - method: the JSDoc of `SMTProof` and `SMTProof.nonce`; dependency uptake. The browser bundle holds the smt package.
  - aggregation: dependency uptake. The browser bundle holds the smt package.
  - cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/smt@0.5.0

## 0.9.0

### Minor Changes

- Three packages get new names (ADR 159).

  - std: the first version of `@did-btcr2/std`. It holds the code of `@did-btcr2/common` 11.0.0 with no change. The history of `@did-btcr2/common` is at https://github.com/dcdpr/did-btcr2-js/blob/9c260b13/packages/common/CHANGELOG.md.
  - integrity: the first version of `@did-btcr2/integrity`. It holds the code of `@did-btcr2/cryptosuite` 11.0.0 with no change. The history is at https://github.com/dcdpr/did-btcr2-js/blob/9c260b13/packages/cryptosuite/CHANGELOG.md.
  - keys: the first version of `@did-btcr2/keys`. It holds the code of `@did-btcr2/keypair` 0.13.3 with no change. The history is at https://github.com/dcdpr/did-btcr2-js/blob/9c260b13/packages/keypair/CHANGELOG.md.
  - bitcoin, key-manager, method, aggregation, api: Breaking: each package uses the new packages in place of the old packages (bitcoin uses only std). A class of an old package is not the class of the new package: `instanceof` gives `false`. TypeScript also refuses a key class of `@did-btcr2/keypair` and a `SchnorrMultikey` of `@did-btcr2/cryptosuite` in place of the new class (TS2322). Import each class and each type from the new package.
  - cli: dependency uptake.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/std@0.1.0
  - @did-btcr2/integrity@0.1.0
  - @did-btcr2/keys@0.1.0
  - @did-btcr2/bitcoin@0.12.0

## 0.8.0

### Minor Changes

- The aggregation checks bind to the beacon type, membership, and beacon output of the cohort, and the service checks only the update sender (ADR 152).

  - aggregation: Breaking: `isCohortAdvertMessage` accepts only the `beaconType` `CASBeacon` or `SMTBeacon`. The participant drops an advert of another type. The runner then emits no `cohort-discovered` event and does not call `shouldJoin`. `joinCohort` for the id of that advert throws an `AggregationParticipantError` of type `INVALID_PHASE`. Before, a member joined such a cohort, and the round stopped at the distribution.
  - aggregation: Breaking: the participant validates the aggregated data with the beacon type of its cohort, not with the type that the message names. `PendingValidation.beaconType` is the type of the cohort. `PendingValidation.matches` is also false if the message names another type or no type. A message with no type now gives a stored validation, and the default `onValidateData` sends a rejection ack. If `matches` is false, `approveNonce` and `approveFallback` throw an `AggregationParticipantError` of type `UNVALIDATED_DATA`. Before, a member of a CAS cohort validated SMT data as SMT data and signed, and it dropped a message with no type.
  - aggregation: Breaking: `JoinedCohortInfo.beaconType` is a new required member. Code that builds a `JoinedCohortInfo` must set it. The info of an `OnProvideUpdate` callback has the new member `beaconType`. Code that calls an `OnProvideUpdate` function must pass it. The beacon service in the DID document must have this type.
  - aggregation: Breaking: `CohortCompleteInfo.beaconType` of the `cohort-complete` event is the type of the cohort. Before, it came from the validation, or it was an empty string.
  - aggregation: `AggregationCohort.beaconScript` is new. It returns a copy of the output script of the beacon address. It is empty before `computeBeaconAddress`.
  - aggregation: Breaking: `approveNonce` and `approveFallback` throw an `AggregationParticipantError` of type `PREVOUT_SCRIPT_MISMATCH` if the prevout script of the request is not the `beaconScript` of the cohort. The data is `{ cohortId, beaconAddress, prevOutScriptHex }`. After the check, both methods sign over the `beaconScript` of the cohort. Before, a member signed a transaction that spent another output. On the fallback path, its signature completed a spend of another cohort with the same keys and k.
  - aggregation: Breaking: `startSigning` throws an `AggregationServiceError` of type `PREVOUT_SCRIPT_MISMATCH` if `txData.prevOutScripts[0]` is not the `beaconScript` of the cohort. The data is `{ cohortId, beaconAddress, prevOutScriptHex }`. `startSigning` now throws `MISSING_PREV_OUT_SCRIPT` before it changes the phase. A refusal leaves the phase Validated, and the service runner fails the cohort. Before, `startSigning` started a round that did not give a valid spend.
  - aggregation: Breaking: the membership is final at `finalizeKeygen`. `acceptParticipant` throws an `AggregationServiceError` of type `INVALID_PHASE` outside the phase Advertised. The data is `{ cohortId, participantDid, phase }`. `pendingOptIns()` returns an empty map outside the phase Advertised. Thus the service runner emits no `opt-in-received` event and does not call `onOptInReceived` for an opt-in after `finalizeKeygen`. Before, the service added a member after `finalizeKeygen`, and the cohort keys no longer gave the beacon address.
  - aggregation: Breaking: the service runner emits `message-rejected` with the rejection code `MEMBERSHIP_FINAL` for an operator approval after `finalizeKeygen`. It emits `message-rejected` with the rejection code `COHORT_FULL` for an approval after the cohort has `maxParticipants` members. Before, the service added the late member, or the runner dropped the surplus approval with no event. The participant of a late approval gets no message and stays in the phase OptedIn. `AggregationParticipantRunner` has no timeout, so the participant application must set its own deadline.
  - aggregation: the service runner applies an operator approval only to the opt-in that the operator saw. If a newer opt-in of the same DID replaced that opt-in, the runner drops the approval with no event. Under an approve-all policy, the newest opt-in of a DID wins. The runner also drops an approval for a DID that is already a member, with no event. If the runner stopped, or if the cohort completed or failed, the runner drops the approval too. Before, an approval for a member DID failed the cohort with `ALREADY_ACCEPTED`.
  - aggregation: the service runner requests the transaction data one time for each cohort. A VALIDATION_ACK during the `onProvideTxData` await does not call `onProvideTxData` or `startSigning` again. If the cohort completes or fails during the await, the runner does not call `startSigning`. Before, a repeated ack called `onProvideTxData` again, and the second `startSigning` failed the cohort with `INVALID_PHASE`.
  - aggregation: Breaking: the service checks only the structure of the proof of a submitted update and the sender DID. It does not verify the signature. If the proof names a DID URL of the sender DID, the service accepts the update. A signature of another key passes, and a `proofValue` that does not verify passes too. A resolver verifies the proof, so an update with a bad proof harms only the DID of the sender. Before, the service verified the proof with the opt-in key of the sender.
  - aggregation: Breaking: `RejectionReason` no longer has `UPDATE_VERIFICATION_FAILED`, and no alias stays. The new members are `UPDATE_SENDER_MISMATCH`, `INVALID_FALLBACK_SIG`, `MEMBERSHIP_FINAL`, and `COHORT_FULL`. Only the service runner emits `MEMBERSHIP_FINAL` and `COHORT_FULL`. Before, each problem of the proof of a submitted update gave `UPDATE_VERIFICATION_FAILED`.
  - aggregation: Breaking: the service records `UPDATE_SENDER_MISMATCH` if the proof `verificationMethod` is not the sender DID, then `#`, `?`, or `/`, then one or more characters. Examples are a relative id (`#initialKey`), the bare DID, and an id under another DID. The service records `UPDATE_MALFORMED` if the proof is not an object, `verificationMethod` is not a string, or `proofValue` is empty or not a string.
  - aggregation: Breaking: a fallback signature that does not verify gives `INVALID_FALLBACK_SIG` (before: `UPDATE_VERIFICATION_FAILED`). A fallback `signerPk` that is not the cohort key of the sender also gives `INVALID_FALLBACK_SIG` (before: `UPDATE_MALFORMED`).
  - aggregation: Breaking: the participant refuses a COHORT_READY if another cohort of the same participant object has the same accepted beacon address and another beacon type. `AggregationParticipant.receive()` then throws an `AggregationParticipantError` of type `BEACON_TYPE_CONFLICT`, and the phase of the cohort becomes Failed. The data is `{ cohortId, beaconType, beaconAddress, otherCohortId, otherBeaconType }`. Two cohorts of one beacon type at one address stay allowed. The check knows only the cohorts of one participant object in memory. Before, the member signed both cohorts.
  - aggregation: Breaking: `joinedCohorts` lists only the cohorts whose COHORT_READY the participant accepted. Before, it also listed a cohort after `BEACON_ADDRESS_MISMATCH`. Each key in `JoinedCohortInfo.cohortKeys` is now a copy, so a change to a key does not change the cohort.
  - aggregation: Breaking: for `BEACON_TYPE_CONFLICT`, the participant runner emits `cohort-failed` with `{ cohortId, reason }` and no `error` event. The other cohorts of the runner continue. `joinFirst` and `joinMatching` do not count a failed cohort. They wait for a cohort that completes. If no other cohort completes, the promise does not settle.
  - aggregation: Breaking: `joinFirst` and `joinMatching` call `runner.stop()` before they reject on an `error` event, for example `BEACON_ADDRESS_MISMATCH`. Before, the runner continued after the rejection. It signed and joined new adverts, and the caller had no handle to stop it.
  - aggregation: Breaking: after `stop()`, a callback of the participant runner that returns late has no effect, and the runner sends no message for it. The runner checks the stopped state after each awaited callback: `shouldJoin`, `onProvideUpdate`, `onValidateData`, and `onApproveSigning` for the nonce and for the fallback. Before, a callback that waited at `stop()` still signed and sent messages after `stop()` returned.
  - aggregation: the JSDoc examples of `startSigning` and `AggregationServiceRunner` use `buildAggregationBeaconTx` of `@did-btcr2/method` with its options object. The JSDoc of `CohortConditions.recoverySequence` and `SoloCohortOptions.config` says that a CAS cohort and an SMT cohort with the same terms get one beacon address. To offer both beacon types to the same members, use another `recoverySequence` for each type. The JSDoc of `JoinedCohortInfo.beaconType` tells the application to compare the beacon address with the beacon services of its DID documents. It also tells the application to use one key for each DID.

- The aggregation transports refuse malformed and replayed input, sign retained messages again at delivery, encrypt directed Nostr messages, and require https (ADR 153).

  - aggregation: Breaking: `verifyEnvelope` throws an `HttpTransportError` of type `ENVELOPE_NONCE_INVALID` if the nonce is not 16 to 64 bytes of lowercase hex. Thus the nonce must have an even count of 32 to 128 hex characters. `verifyRequestAuth` throws `REQUEST_AUTH_NONCE_INVALID` for such a nonce. The data of each error is `{ adapter: 'http' }`, and each function checks the nonce after the timestamp skew and before the signature. The server answers 401 `{ error: 'invalid_envelope' }` (`unknown_sender` for an x1 bootstrap opt-in), or it closes the inbox stream. Before, each function accepted a nonce of each length, for example 60,000 characters, and the server kept it in the replay cache.
  - aggregation: Breaking: `verifyEnvelope` throws `ENVELOPE_TIMESTAMP_SKEW` if the timestamp gives no finite difference to the clock, for example a string that is not a number. The data is `{ adapter: 'http', diff, skewSec, timestamp, now }`. A string of decimal digits gives a finite difference and still passes. `verifyRequestAuth` needs no such check, because its parser accepts only an integer `ts`. Before, the difference was `NaN`, so a replay of the envelope passed the skew check at each time.
  - aggregation: `reviveFromWire` makes each member an own property of the result, also a member with the name `__proto__`. Before, a `__proto__` member set the prototype of the result. The `communicationPk` check of an advert then found no key, but the participant read the inherited key.
  - aggregation: `HttpClientTransport`, `HttpServerTransport`, and `NostrTransport` keep the outer `body` of a message after the flatten. Thus a `body` member inside `body` cannot replace it, and the transport checks and the state machines read the same `communicationPk`. Before, an inner `body` replaced the outer `body`, so a state machine could read a key that the transport did not check.
  - aggregation: Breaking: `NonceCache.store(did, nonce, expiresAtSec, nowSec)` replaces `store(did, nonce, timestampSec)`. It returns the new type `NonceStoreResult`, `'stored'` or `'evicted'`. It does not look for a replay, and it replaces an entry for the same key. The new method `NonceCache.has(did, nonce, nowSec)` finds a live entry, so a caller must call `has` before `store`. Before, `store` returned `false` for a replay and `true` for a new pair.
  - aggregation: a `NonceCache` entry is live while its expiry second is at or after the current second. `HttpServerTransport` sets the expiry to the current second plus 2 x `clockSkewSec` (120 s by default). Thus the entry lives at least as long as a replay of the envelope can pass the skew check. `store` first deletes the expired entries in insertion order, and it stops at the first live entry. Before, an entry did not expire.
  - aggregation: if the `NonceCache` is full of live entries, `store` deletes the live entry that expires first and returns `'evicted'`. `HttpServerTransport` then writes a `logger.warn` line, at most one line in each `clockSkewSec` window. A replay of an evicted envelope then passes until its timestamp leaves the skew window. Before, the cache deleted its oldest entry when it held more than `maxEntries` entries, and it wrote no `logger.warn` line.
  - aggregation: Breaking: the `NonceCache` constructor throws an `AggregationServiceError` of type `INVALID_NONCE_CACHE_CAPACITY` if `maxEntries` is not an integer of 1 or more. The data is `{ maxEntries }`. Before, the cache accepted each value, for example `0`, `1.5`, or `NaN`.
  - aggregation: `HttpServerTransport` looks for a replay before the rate limiter, and it stores the nonce only after the rate limiter admits the request. This order applies to `POST /v1/messages`, `POST /v1/adverts`, and the inbox subscription. A replay gets 409 `{ error: 'replay' }` and uses no token. A request that gets 429 `{ error: 'rate_limited' }` stores no nonce, so its sender can send the same envelope again after the refill. A refused inbox subscription closes the stream with a `logger.debug` line. Before, the server stored the nonce before the rate limiter, and a retry of a throttled envelope got 409.
  - aggregation: Breaking: `POST /v1/messages` and `POST /v1/adverts` answer 400 `{ error: 'malformed_envelope' }` if the JSON body is not an envelope shape. An envelope shape is an object (not an array) with a non-empty string `from` and an object `message`. Only no body, a body that does not parse, and `null` get 400 `{ error: 'invalid_json' }`. Before, the bodies `0`, `false`, and `""` got `invalid_json`. Another body that is not an envelope (for example `{}`) got 401 `unknown_sender`, or `handleRequest` rejected.
  - aggregation: Breaking: `POST /v1/messages` and `POST /v1/adverts` answer 400 `{ error: 'malformed_message' }` if `reviveFromWire` throws for the message of a verified envelope. An example is a `__bytes` value that is not hex. On an x1 bootstrap opt-in, the same throw gives 401 `{ error: 'unknown_sender' }`. Before, `handleRequest` rejected.
  - aggregation: Breaking: `HttpServerTransport.handleRequest` never rejects. An absolute request target that does not parse as a URL gets 404 `{ error: 'not_found' }`. Another unexpected throw, for example from the injected `resolveSenderPk`, gets a `logger.error` line and 500 `{ error: 'internal_error' }`. `handleSse` never throws, and it closes the stream for such a target or throw. Before, these cases made `handleRequest` reject or `handleSse` throw.
  - aggregation: the order of the `POST /v1/messages` answers is: 413 `payload_too_large`, 400 `invalid_json`, 400 `malformed_envelope`, 401 `invalid_envelope` or `unknown_sender`, 409 `replay`, 429 `rate_limited`. Then come 400 `missing_recipient`, 404 `unknown_recipient`, 400 `malformed_message`, 401 `sender_mismatch`, and 400 `missing_message_type`. The order of the `POST /v1/adverts` answers is: 413 `payload_too_large`, 400 `invalid_json`, 400 `malformed_envelope`, 401 `unknown_sender`, 401 `invalid_envelope`. Then come 409 `local_advert`, 409 `replay`, 429 `rate_limited`, 403 `not_an_actor`, 400 `malformed_message`, and 401 `sender_mismatch`.
  - aggregation: Breaking: `POST /v1/adverts` answers 401 `{ error: 'invalid_envelope' }` for an envelope with a `to` member, because the server verifies an advert with `expectedTo: undefined`. `HttpClientTransport` also drops a broadcast envelope with a `to` member. Before, a recipient could post an inbox envelope of an actor to `POST /v1/adverts`. The server then sent that envelope to each broadcast subscriber as the current advert, and each client accepted it.
  - aggregation: Breaking: `POST /v1/adverts` answers 409 `{ error: 'local_advert' }` while an advert of `HttpServerTransport.publishRepeating` is within its TTL. This check comes after the envelope check and before the replay check, so the refusal stores no nonce and uses no token. The refusal applies to each poster, also to another actor. Before, a POST of the local advert envelope from `GET /v1/adverts` replaced the local advert. The stop function of `publishRepeating` then did not remove that copy.
  - aggregation: `HttpServerTransport` signs a buffered inbox event or the local advert again at delivery if its envelope is older than `clockSkewSec / 2`. The new envelope has the same message, the same recipient, and the current time, and it replaces the retained envelope. The event id does not change, and the server relays a posted advert verbatim. The server skips a stale event if its sender is no longer an actor or if the sign throws. The next events still go out. Before, a client dropped a retained event or advert older than `clockSkewSec` with `ENVELOPE_TIMESTAMP_SKEW`.
  - aggregation: Breaking: the `now` clock of `HttpServerTransportConfig` also drives the envelope skew check of each POST route and of the x1 bootstrap. It also drives the replay cache expiry and the timestamp of each envelope that the server signs. The server reads the clock one time for each request. Before, the envelope skew check and the signed timestamps used `Date.now`. A test clock thus changed only the request-auth check, the rate limiter, and the advert TTL.
  - aggregation: Breaking: `InboxBuffer` becomes `InboxBuffer<T = string>`, and `StoredEvent` becomes `StoredEvent<T = string>` with `data: T`. The buffer of `HttpServerTransport` holds the signed envelope and its JSON form. An event id is `<epoch>-<seq>`. The epoch is 16 lowercase hex characters, a random value for each buffer. The seq is a decimal integer that starts at 1 and increases by 1 at each append. Before, the ids were `1`, `2`, and so on, and `data` was a string.
  - aggregation: Breaking: `InboxBuffer.since(lastEventId)` returns the events after `lastEventId` only for an id of this buffer. For no id or another id, it returns each retained event. Examples of another id are a malformed id, a seq that is not a safe integer, and an id of another buffer. A new buffer has a new epoch, so after a server restart a request with an old id gets each retained event. Before, `since` compared the number of the id, so an old id hid the new events up to that number.
  - aggregation: Breaking: the `HttpClientTransport` constructor throws an `HttpTransportError` of type `INVALID_BASE_URL` if `baseUrl` is not a string or a `URL`. It throws the same error for a value that does not parse as an absolute URL, and for a protocol other than `https:` or `http:`. For a protocol, the data is `{ adapter: 'http', protocol }`. A URL with a username or a password also gives `INVALID_BASE_URL`, also for plain http, and the data holds no part of the URL. Before, a URL that did not parse gave a raw `TypeError`, and the client accepted each other protocol and an object with a string `href`. For a URL with credentials, fetch refused each request, and its error text showed the URL.
  - aggregation: Breaking: the constructor throws `INSECURE_BASE_URL`, with the data `{ adapter: 'http', hostname }`, for a plain `http:` URL whose host is not a loopback host. A loopback host is an IPv4 address in 127.0.0.0/8, `[::1]`, `localhost`, or a name that ends with `.localhost`. Each name can end with a dot, and an IPv4-mapped IPv6 address is not a loopback host. The system must resolve each localhost name to a loopback address. The new option `HttpClientTransportConfig.allowInsecureHttp: true` accepts plain http on each host. Before, the constructor accepted each plain http URL, and the client sent signed envelopes, MuSig2 nonces, and partial signatures in clear.
  - aggregation: Breaking: `HttpClientTransport` does not follow a redirect: each fetch call sets `redirect: 'manual'`. A 3xx answer, or an opaque redirect answer with status 0 in a browser, is a failed request. `sendMessage` then throws `SEND_MESSAGE_HTTP` with the data `{ adapter: 'http', status, body, messageType }`. An SSE subscription waits the backoff delay and connects again. In a browser, fetch rejects for a cross-origin redirect that fails the CORS check, and `sendMessage` gives that rejection to the caller. Before, fetch followed a redirect, and after a 307 or 308 answer it sent the signed body to the `Location`, also over plain http.
  - aggregation: `sendMessage` reads at most 1,024 bytes of the body of a failed answer, then it cancels the body. `data.body` of `SEND_MESSAGE_HTTP` holds at most 256 characters, as before. Before, the client read the full body before it cut the text, so the call did not return for a body that did not end.
  - aggregation: `HttpClientTransport` calls the fetch function with no `this` value, for the default `globalThis.fetch` and for a `fetchImpl` of the caller. Thus the global `fetch` of a browser works without a `bind`. Before, the client called fetch with the transport as `this`, and a browser fetch threw a `TypeError` (Illegal invocation).
  - aggregation: `HttpClientTransport` keeps the id of the last inbox event of each actor. It sends that id in `Last-Event-ID` at each reconnect, so the server sends only the later events. The client ignores an id longer than 256 characters or with a character outside 0x21 to 0x7E. An empty id clears the kept id. `stop()` and `start()` keep the id, but a new `registerActor` starts with no id, so the handlers must be idempotent. Before, the client sent no `Last-Event-ID`, and each reconnect got each retained event again.
  - aggregation: each SSE loop of `HttpClientTransport` waits the `reconnectBackoff` delay after each attempt, also after a normal stream end. The attempt count goes back to 0 only after an attempt that received at least one byte, for example a heartbeat comment. A `reconnectBackoff` that throws ends the loop with a `logger.error` line. To open the subscription again, call `stop()`, then `start()`. Before, the count went back to 0 at each ok answer, and the loop connected again at once after a stream end. A throw of `reconnectBackoff` ended the loop with only a `logger.debug` line.
  - aggregation: `HttpClientTransport` drops a malformed event and keeps the stream open. An event is malformed if its data is not an object with a non-empty string `from` and an object `message`. An event is also malformed if `reviveFromWire` throws for its message. A throw of `resolveSenderPk` also drops the event. Each drop gets a `logger.debug` line. Before, some of these events threw in the loop, so the client closed the stream and connected again.
  - aggregation: a handler of `HttpClientTransport` that throws or rejects gets a `logger.warn` line, and the stream stays open. The handlers of the other actors still get a broadcast event. Each other throw in the dispatch of one event gets a `logger.error` line, and the client drops the event. A logger that throws does not end a loop. Before, a broadcast handler rejection was an unhandled rejection, and an inbox handler rejection closed the stream. A broadcast handler throw also closed the stream, and the handlers of the later actors did not run.
  - aggregation: the new option `HttpClientTransportConfig.maxSseEventBytes` sets the maximum byte count of one SSE event, for the broadcast stream and each inbox stream. The default is no limit. The new export `RECOMMENDED_MAX_SSE_EVENT_BYTES` (1,048,576 bytes) is the recommended value. It holds a CAS DISTRIBUTE_AGGREGATED_DATA of about 8,500 members with KEY DIDs, and a COHORT_READY of about 12,900 members. For a larger event, the client writes a `logger.warn` line, closes the stream, and connects again after the backoff delay. That attempt counts as a failed attempt, also if bytes arrived.
  - aggregation: for an inbox event above `maxSseEventBytes`, the client uses the `eventId` of the parser error. If that id replaces the resume id, the next inbox request resumes after the refused event, and the actor loses only that event. `HttpServerTransport` writes the `id` field first, so the parser gives the id if the `id` line fits in the limit. The id does not skip the event if it is absent, equal to the resume id, ignored, or empty. Then the server sends the refused event again at each reconnect, and the actor gets no later inbox event while the server buffer holds it. An empty id also clears the resume id, so the server sends each retained event again.
  - aggregation: `parseSseStream(readable, options)` takes the new options type `SseParseOptions`. Its `maxEventBytes` sets the limit if it is a number greater than 0, and the parser ignores each other value. For a larger event, the parser cancels the stream and throws an `HttpTransportError` of type `SSE_EVENT_TOO_LARGE`. The data is `{ adapter: 'http', maxEventBytes, eventId }`, with `eventId` only if the parser applied an `id` field of the refused event. The parser finds the line ends only in the bytes of each new read, so the parse time is linear. Before, the parser had no limit, and it scanned its full buffer again at each read.
  - aggregation: Breaking: at the end of the stream, `parseSseStream` drops an incomplete event and an unterminated last line, as the HTML standard says. An incomplete event has no final blank line. Before, the parser gave the incomplete event at the end of the stream.
  - aggregation: `parseSseStream` removes one byte order mark at the start of the stream, as the HTML standard says. A second BOM becomes a part of the first field name. Before, under Bun 1.3, the decoder removed a BOM at the start of each read. An invalid UTF-8 sequence gives U+FFFD in the line that holds it.
  - aggregation: Breaking: `NostrTransport.sendMessage` sends each message with a recipient as a kind 1059 event. The content is NIP-44 v2 ciphertext for the recipient key. The tags are only `['p', <sender x-only key>]` and `['p', <recipient x-only key>]`, with no `t` tag. Before, COHORT_OPT_IN, COHORT_OPT_IN_ACCEPT, and COHORT_READY went as plaintext kind 1 events, and an x1 opt-in showed its genesis document to each relay. Each event, also each kind 1059 event, had a `t` tag with the message type.
  - aggregation: Breaking: `sendMessage` throws a `TransportAdapterError` of type `UNKNOWN_PEER_ERROR` if the recipient is not a registered peer, for each aggregation message type. The data is `{ adapter: 'nostr', did }`. Call `registerPeer` for the recipient before the send. `AggregationServiceRunner` and `AggregationParticipantRunner` register each recipient before they send to it. Before, a COHORT_OPT_IN, COHORT_OPT_IN_ACCEPT, or COHORT_READY to an unknown recipient went out as kind 1 with no recipient tag.
  - aggregation: Breaking: with no recipient, `sendMessage` sends only a COHORT_ADVERT, as a kind 1 event with the tags `['p', <sender x-only key>]` and `['t', COHORT_ADVERT]`. Each other aggregation message type with no recipient throws `SEND_MESSAGE_ERROR` with the data `{ adapter: 'nostr', type }`. An empty string `to` counts as no recipient. Before, a COHORT_OPT_IN, COHORT_OPT_IN_ACCEPT, or COHORT_READY with no recipient went out as kind 1. The error data of an update or sign message had no `type`.
  - aggregation: Breaking: `sendMessage` throws `MESSAGE_TOO_LARGE` if the plaintext JSON of a message with a recipient is larger than 65,535 UTF-8 bytes, and it publishes nothing. The data is `{ adapter: 'nostr', type, plaintextBytes, maxPlaintextBytes: 65535 }`. The limit is the largest plaintext of the 2-byte NIP-44 v2 length prefix. Over Nostr, a cohort of KEY DIDs thus holds at most about 533 members for CAS and about 804 for SMT. Before, the NIP-44 encrypt threw a raw `Error`: 'invalid plaintext size: must be between 1 and 65535 bytes'. A plaintext keygen message had no limit.
  - aggregation: Breaking: the directed subscription of each `NostrTransport` actor filters on kind 1059 only. The handler also drops each event of another kind, with a `logger.debug` line. Thus a COHORT_OPT_IN of an earlier version (kind 1) does not get to a service of this version. Both receive paths drop an event whose content is not a JSON object. Before, the filter also took kind 1, and the handler dispatched a plaintext directed event.
  - aggregation: a `NostrTransport` handler that throws or rejects gets a `logger.warn` line with the message type and the sender DID. The transport does not wait for a directed handler. A broadcast event goes to the actors one after the other, and the handlers of the later actors still run. A wrapper of each `onevent` callback writes a `logger.error` line for each other throw or rejection. A throw of `resolveSenderPk` drops the event with a `logger.debug` line, and a logger that throws does not stop a receive path. Before, a handler rejection was an unhandled rejection, and a broadcast handler throw stopped the dispatch to the later actors.
  - method: the JSDoc of `resolveBtcr2SenderPk` says that the function returns the genesis key, also after an update removes that key from the DID document. Thus the holder of a leaked old key can join a cohort as the DID and can make the DID invalid through an aggregate beacon. A transport accepts the current key only after `registerPeer(did, currentKey)`, or with a custom `resolveSenderPk` that reads the current DID document. A registered old key stays in use until a new `registerPeer` call replaces it. After a rotation, the controller must remove from the DID document each aggregate beacon whose cohort key is the old key. The JSDoc also names each aggregation transport, not only the HTTP transport.

### Patch Changes

- The Data Integrity algorithms of the cryptosuite follow VC Data Integrity 1.0 and the bip340-jcs-2025 suite, and the resolver uses them (ADR 158).

  - common: Breaking: `MethodErrorCode.PROOF_PARSING_ERROR` and its named export are removed. `MethodErrorCode` gets `PARSING_ERROR` and `INVALID_CHALLENGE_ERROR` of VC Data Integrity 1.0, with their named exports. `INVALID_DOMAIN_ERROR` gets a named export.
  - common: Breaking: `DateUtils.isValidXsdDateTime` applies the `dateTime` rules of XML Schema 1.1. The year `0000` is valid. A year with more than 4 digits that starts with `0`, for example `01000`, is not valid. `24:00:00` with a fraction other than zero is not valid. A value that is not a string gives `false`. Before, `0000` was not valid, `01000` and `24:00:00.5` were valid, and a number gave a raw `TypeError`.
  - common: `DateUtils.isValidXsdDateTimeStamp` (a `dateTime` with a timezone), `DateUtils.xsdDateTimeToEpochMs` (for each year, also a year above 9999), and `DateUtils.compareXsdDateTime` (an exact comparison of two instants) are new. The type `ProblemDetails` (RFC 9457) is new.
  - cryptosuite: Breaking: `BIP340Cryptosuite.createProof` returns a new proof and does not change its options. `BIP340DataIntegrityProof.addProof` returns a copy of the document with the proof. Before, `createProof` wrote `@context` and `proofValue` into the options and returned the options object, and `addProof` wrote the proof into the document.
  - cryptosuite: Breaking: `createProof` refuses a document that is not a JSON object, with a `CryptosuiteError` of type `PROOF_GENERATION_ERROR`. It also refuses options with a `proofValue`, and options with an `@context` for a document with no `@context`. It also refuses a proof member that breaks a rule of VC Data Integrity 1.0, and a signature that does not have 64 bytes. Examples are an `id` that is not a valid URL string, a `created` with no timezone, and a repeated `domain` string. Before, `createProof` made a proof for each of these inputs, except a `null` or `undefined` document. Such a document gave a raw `TypeError`.
  - cryptosuite: Breaking: `addProof` refuses a document that has a `proof`, and options with a `previousProof`, with a `DataIntegrityProofError` of type `PROOF_GENERATION_ERROR`. Before, for a document with a `proof`, the new proof signed the old proof and then replaced it, so the result never verified. For options with a `previousProof`, `addProof` made a proof that verified, and no function verified the previous proof.
  - cryptosuite: Breaking: `BIP340Cryptosuite.verifyProof` returns a `CryptosuiteVerificationResult`: `verified`, and `verifiedDocument`, the document without its proof, or `null`. A document `@context` that does not start with the proof `@context` gives `verified: false` (Verify Proof, step 4). Before, `verifiedDocument` was the secured document or `undefined`.
  - cryptosuite: Breaking: `BIP340Cryptosuite.verifyProof` throws a `CryptosuiteError` if the verification cannot complete. The type is `PARSING_ERROR` if the document or its proof is not a JSON object. The type is `PROOF_VERIFICATION_ERROR` for a proof member that breaks a rule. It is also `PROOF_VERIFICATION_ERROR` for a `proofValue` that is not the canonical base58btc text of 64 bytes. A `created` value that is not an XML Schema `dateTime`, for example `''`, gives `PROOF_GENERATION_ERROR`. A `type` or a `cryptosuite` of another suite gives a `CryptosuiteError`, also in `BIP340Cryptosuite.transformDocument`.
  - cryptosuite: Breaking: `BIP340Cryptosuite.verifyProof` refuses some proofs that verified before. Examples are a proof with an `id` of `not a url`, with a `created` of `''`, or with other base58btc text for the same signature bytes. Before, a `proofValue` that did not decode gave a raw `Error`, `created: 5` gave a raw `TypeError`, and another `type` gave a `MethodError`, also in `transformDocument`.
  - cryptosuite: Breaking: `BIP340DataIntegrityProof.verifyProof` is the Verify Proof algorithm of VC Data Integrity 1.0. A failed check before the cryptosuite verification gives `verified: false` and one `ProblemDetails` in `errors`, with the type URL `https://w3id.org/security#<TYPE>`. The error types are `PARSING_ERROR`, `PROOF_VERIFICATION_ERROR`, `INVALID_DOMAIN_ERROR`, and `INVALID_CHALLENGE_ERROR`. If the cryptosuite gives `verified: false`, `errors` is empty. Text that is not JSON gives a `DataIntegrityProofError` of type `PARSING_ERROR`. Before, a failed check threw a `DataIntegrityProofError`, and text that was not JSON gave a `SyntaxError`.
  - cryptosuite: Breaking: in `BIP340DataIntegrityProof.verifyProof`, a proof with a `previousProof` gives `PROOF_VERIFICATION_ERROR`, because this suite does not verify a proof chain. `expectedPurpose` is optional, and `expectedDomain` is a string or an array of strings, compared as a set. Before, the function ignored `previousProof`, and a `domain` list of another length failed.
  - cryptosuite: Breaking: `VerificationResult` has `verifiedDocument: UnsecuredDocument | null`, `mediaType: string | null`, `warnings`, and `errors`. `Cryptosuite.verifyProof` returns the new type `CryptosuiteVerificationResult`. Before, `verifiedDocument` (a `SecuredDocument`) and `mediaType` were optional, and the type had no `warnings` and no `errors`.
  - cryptosuite: Breaking: `SchnorrMultikey.fromVerificationMethod` refuses a `publicKeyMultibase` that is not the canonical base58btc text of its bytes, with a `MultikeyError` of type `VERIFICATION_METHOD_ERROR`. Text that does not decode gives the same error type. Before, the function accepted other text for the same bytes, and text that did not decode gave a raw `Error`.
  - method: Breaking: the resolver refuses an update whose proof has a `previousProof`, with a `ResolveError` of type `INVALID_DID_UPDATE`. The message is `Invalid update: proof.previousProof must not be present: an update has one proof`. Before, the resolver applied such an update.
  - method: Breaking: the resolver verifies an update proof with `BIP340Cryptosuite.verifyProof`, so the proof member rules and the strict `proofValue` decode of the cryptosuite apply. For example, an `id` that is not a valid URL string, or a `nonce` that is not a string, gives `Invalid update: proof verification failed: ...` (`INVALID_DID_UPDATE`). Before, the resolver applied such an update.
  - method: Breaking: the resolver refuses an eligible beacon signal if its block `time` or `mediantime` is not an integer from 0 to 2^32-1. The error is a `ResolveError` of type `INVALID_DID_UPDATE`. Before, a `mediantime` of `1e20` gave a `MethodError` of type `INVALID_DATE`, and a `mediantime` of `1.5` applied the update.
  - method: a proof `created` or `expires` with the year `0000` or a year above 9999 is valid. The resolver compares `created` and `expires` exactly, with each digit of a fraction of a second. `versionTime` also accepts each year. Before, such a year failed with `INVALID_DID_UPDATE`, or with `INVALID_OPTIONS` for `versionTime`, and the resolver compared whole milliseconds. The DID Core check of `expires` and `revoked` of a verification method applies the same XML Schema 1.1 rules.
  - method: if the signer returns a signature that does not have 64 bytes, `Updater.sign` fails with `Invalid update: cannot make the proof with "<id>": ...` and `PROOF_GENERATION_ERROR` in `data.cause`. Before, the message was `Invalid update: the proof does not verify with the public key of "<id>": ...`. For a `publicKeyMultibase` that does not decode, the `data.cause` of the signing method check has the type `VERIFICATION_METHOD_ERROR`. Before, it had the type `Error` of the raw decode error.
  - api: Breaking: `crypto.cryptosuite.verifyProof` and `crypto.verifyDocument` return a `CryptosuiteVerificationResult`: `verified`, and the document without its proof, or `null`. Before, they returned a `VerificationResult` whose `verifiedDocument` was the secured document or `undefined`.
  - api: Breaking: `crypto.proof.verifyProof` gives `verified: false` and one `ProblemDetails` in `errors` for a failed check, for example a purpose, a domain, or a challenge that does not match. A signature that does not verify gives `verified: false` and an empty `errors` array. Text that is not JSON gives a `DataIntegrityProofError` of type `PARSING_ERROR`. `expectedPurpose` is optional, and `expectedDomain` is a string or an array of strings. Before, a failed check threw a `DataIntegrityProofError`, text that was not JSON gave a `SyntaxError`, and `expectedDomain` was a string.
  - api: Breaking: `crypto.signDocument`, `crypto.proof.addProof`, and `crypto.proof.signDocument` return a copy of the document with the proof, and `crypto.cryptosuite.createProof` does not change its options. The three functions refuse a document that has a `proof`, and options with a `previousProof`. Before, they wrote the proof into the document and into the options.
  - api: `crypto.cryptosuite.createFromKms` returns a cryptosuite that signs through `kms.signer(keyId)`. For a watch-only key, `createProof` gives `KEY_NOT_SIGNER`. Before, the cryptosuite held only the public key, so `createProof` gave a `KeyPairError` of type `SECRET_KEY_ERROR`.
  - api: the api exports the types `CryptosuiteVerificationResult` and `ProblemDetails`. `btcr2.verifyMessage` fails the `assertionMethod` check for a `publicKeyMultibase` that is not the canonical base58btc text of the key. The resolve and update functions apply the new rules of the method package.
  - aggregation: the package takes the new versions of common and cryptosuite. It uses only the `SecuredDocument` type of the cryptosuite, so its behavior does not change. Its browser bundle holds the new `MethodErrorCode` of common.
  - cli: `message verify` fails the `assertionMethod` check for a method whose `publicKeyMultibase` is not the canonical base58btc text of its key. The detail ends with `Invalid publicKeyMultibase: not the base58btc encoding of the key`. Before, the check passed, and the message verified. For a `proofValue` that does not decode to 64 bytes, the `signature` check prints `The proof does not verify: Invalid proofValue: not the base58btc Multibase encoding of a 64-byte BIP340 signature.` `message sign` prints the same signed message as before. If the resolution gets an update that the resolver now refuses, `resolve`, `update`, `deactivate`, `message sign`, and `message verify` fail.

- The JCS serializer sorts every object and refuses NaN, Infinity, and a lone surrogate (ADR 154).

  - common: Breaking: `canonicalize`, `canonicalHash`, and `canonicalHashBytes` throw a `CanonicalizationError` for a value with no JCS form (RFC 8785). The type is `NON_FINITE_NUMBER` for NaN, Infinity, or -Infinity, also for a Number object and for the number of the JSON text `1e400`. The type is `LONE_SURROGATE` for a string or a member name with a lone surrogate. The type is `NOT_JSON_DATA` for a BigInt, a cycle, or a top-level value with no JSON form. `data.path` gives the location of the value as a JSON Pointer. Before, NaN and Infinity became `null`, a lone surrogate became its escape text, and a BigInt or a cycle gave a `TypeError`.
  - common: Breaking: `canonicalize` sorts an object that has a data member named `toJSON`, at each depth. Before, such an object and each object in it kept the order of their members, so the hash depended on that order. A `toJSON` method has the same effect as before: `JSON.stringify` calls it first.
  - common: the package no longer depends on `json-canonicalize`. An own serializer writes the JSON form with the rules of RFC 8785 section 3.2.
  - common: `MethodErrorCode` gets the member `PROOF_TRANSFORMATION_ERROR` and its named export.
  - method: Breaking: `Resolver.external` refuses a genesis document with no JCS form with a `ResolveError` of type `INVALID_DID_DOCUMENT`. `Resolver.provide` refuses a signed update with no JCS form with `INVALID_SIGNAL_DATA`, and a CAS Announcement with no JCS form with `MISSING_UPDATE_DATA`. `data.cause` gives the type and the message of the `CanonicalizationError`.
  - method: `Resolver.sidecarData` leaves an update or a CAS Announcement with no JCS form out of its maps. If a beacon signal needs the item, the resolver asks for it with a data need. Before, the map keyed such an item by the hash of its escape text or of its `null` form.
  - method: Breaking: `Updater.construct` and `Updater.sign` refuse a source document or a patch with no JCS form with an `UpdateError` of type `INVALID_DID_UPDATE`. Before, `construct` returned an update whose `targetHash` used the `null` form of a NaN patch value. `GenesisDocument.toGenesisBytes` throws a `DidDocumentError` of type `INVALID_DID_DOCUMENT` for a document with no JCS form.
  - method: `Identifier.validate` reports a failed `genesisDocument` check for a genesis document with no JCS form and does not throw. The set check of the DID Core rules compares no map item with no JCS form, because the hash step refuses the document.
  - cryptosuite: `transformDocument` throws a `CryptosuiteError` of type `PROOF_TRANSFORMATION_ERROR` for a document with no JCS form. `proofConfiguration` throws `PROOF_GENERATION_ERROR` for proof options with no JCS form. Thus `createProof` and `verifyProof` throw for such data, and `verifyProof` gives no `verified: false` result. Before, the suite signed and verified the `null` form or the escape text.
  - aggregation: `AggregationParticipant.submitUpdate` refuses an update with no JCS form with an `AggregationParticipantError` of type `UPDATE_MALFORMED`. `verifyEnvelope` refuses an envelope with no JCS form with an `HttpTransportError` of type `ENVELOPE_MALFORMED`. The CAS strategy derives no signal from a CAS Announcement with no JCS form, so the member does not approve it.
  - api: the api exports `CanonicalizationError` and `CryptosuiteError`. `hashDocument`, `CasApi.publish`, `getInitialDocument`, `createExternalFromDocument`, `constructUpdate`, the resolve functions, and the crypto sub-facade refuse a value with no JCS form through the lower packages.
  - cli: the merge of sidecar data keeps one copy of each entry with no JCS form, by its JSON text, and does not throw. `create -t x --document`, `identifier decode`, `identifier validate`, and `resolve` refuse a genesis document with no JCS form.

- JSONPatch applies the rules of RFC 6901 and RFC 6902 with its own engine and accepts each member name (ADR 155).

  - common: Breaking: `JSONPatch.apply` refuses a patch that breaks RFC 6901 or RFC 6902 with a `MethodError` of type `JSON_PATCH_APPLY_ERROR`. Examples: a pointer with `~2`, an array index with a leading zero (`/a/00`), and an empty array token (`/a/`). Other examples: an index past the end for the `add` of a `move` or a `copy`, and a `move` into a child of its `from`. A path to an inherited JavaScript member such as `/o/toString` and a `remove` at `''` also fail. Before, the apply accepted each of these patches, and a `remove` at `''` gave `null`.
  - common: Breaking: `JSONPatch.apply` accepts each member name, also `constructor`, `prototype`, and `__proto__`. It writes such a member as an own data member and changes no prototype. A `test` with a value that has a member `hasOwnProperty` compares by RFC 6902 section 4.6. An `add` with a `from` member applies, because RFC 6902 ignores that member. Before, the apply refused each of these patches.
  - common: Breaking: `JSONPatchApplyOptions` and the options parameter of `JSONPatch.apply` are removed. The rules always apply, and the patch always runs on a JSON copy. The `strict` parameter of `JSONPatch.validateOperations` is removed, and its `operations` parameter has the type `unknown`. `JSONPatch.diff`, `JSONPatch.joinPointer`, and `JSONPatch.escapeSegmentPath` are removed.
  - common: operations or a source document with no JSON form, for example with a cycle or a BigInt, give `JSON_PATCH_APPLY_ERROR`. Before, they gave a `TypeError`. The error data holds `index`, `op`, `path`, and `from` for a `move` or a `copy`.
  - common: the package no longer depends on `fast-json-patch`.
  - method: Breaking: `Updater.construct`, `DidBtcr2.update`, and the resolver apply the patch of an update with the new rules. A patch that the new rules refuse gives `INVALID_DID_UPDATE` on both paths. A patch that names a member `constructor`, `prototype`, or `__proto__` now applies.
  - api: Breaking: `applyPatch`, `constructUpdate`, `signUpdate`, the update functions, and the resolve functions apply the new rules through method. `applyPatch` refuses a `remove` at `''`.
  - aggregation: the browser bundle no longer holds `fast-json-patch`.
  - cli: `update` and `deactivate` apply the new rules through the api. The docs of `update` name the new refusals.

- Updated dependencies []:
  - @did-btcr2/common@11.0.0
  - @did-btcr2/cryptosuite@11.0.0
  - @did-btcr2/keypair@0.13.3
  - @did-btcr2/bitcoin@0.11.6

## 0.7.7

### Patch Changes

- The write path and the resolver check the method that signs an update with the same three conditions (ADR 147).

  - method: `Updater.signingMethod(sourceDocument, verificationMethodId)` is new. It returns the verification method that can sign an update. An entry of `capabilityInvocation` must identify the method. The method must pass three conditions: it has the type `Multikey`, the DID as its controller, and a BIP340 Multikey key in base58btc text. `DidBtcr2.update` and `Updater.sign` apply these rules.
  - method: Breaking: `Updater.sign(sourceDocument, unsignedUpdate, verificationMethodId, signer)` replaces `Updater.sign(did, unsignedUpdate, verificationMethod, signer)`. The DID is `sourceDocument.id`. The method id is absolute or relative.
  - method: Breaking: `UpdaterParams.verificationMethod` is now `verificationMethodId`, a string.
  - method: Breaking: `NeedSigningKey.verificationMethodId` is the absolute id, for example `<did>#initialKey`. The proof names the method by this id.
  - method: Breaking: the resolver raises `INVALID_DID_UPDATE` if the method that signs an update does not pass all three conditions. Before, the resolver did not compare the controller with the DID, and it did not check the type of an embedded method. It also accepted a key in another text for the same bytes.
  - method: Breaking: `DidDocument` accepts a verification method of any type. Each method must have a string `id`, `type`, and `controller`. Before, `DidDocument` refused a method that was not a `Multikey` with a `zQ3s` key.
  - method: Breaking: the `DidVerificationMethod` constructor keeps every own property of its input that has a value other than `undefined`, for example `publicKeyJwk`. It does not check the type or the key. It does not raise an error.
  - method: Breaking: `publicKeyMultibase` is optional on `Btcr2VerificationMethod` and `DidVerificationMethod`.
  - method: Breaking: the package no longer exports `isMultikeyVerificationMethod` and `MULTIKEY_PUBLIC_KEY_MULTIBASE_PREFIX`. `MULTIKEY_VERIFICATION_METHOD_TYPE` stays.
  - method: Breaking: the method id must be under the DID. A relative id must start with `#`. The write path refuses an id under another DID and a relative id that starts with `?` or `/`. It also refuses an absolute URI that is not a DID URL. It signs with a `<did>?...` or `<did>/...` id. Before, `Updater.sign` refused an id with no `#`.
  - method: Breaking: `DidBtcr2.update` raises `INVALID_DID_UPDATE` if the type or the key of the method is not valid. Before, it raised `INVALID_DID_DOCUMENT` with the full method as data. The data is now `{ verificationMethodId, field, actual, cause? }`.
  - method: Breaking: `Updater.sign` refuses an unsigned update that does not belong to `sourceDocument`. Each error message starts with `Invalid unsignedUpdate:`. The update must have no own `proof` member and a `targetVersionId` that is an integer of 2 or more. Its `@context`, `sourceHash`, `patch`, and `targetHash` must agree with `sourceDocument`.
  - method: Breaking: `Updater.construct` refuses a `sourceVersionId` that is not an integer of 1 or more. The message is `Invalid sourceVersionId: expected an integer of 1 or more.`
  - method: Breaking: `Updater.sign` wraps an error of the signer or the cryptosuite in an `UpdateError` of type `INVALID_DID_UPDATE`. The message starts with `Invalid signer:` or `Invalid update: cannot make the proof with`. `data.cause` holds the type and the message of the inner error, for example `KEY_NOT_SIGNER` for a watch-only key.
  - method: Breaking: `Updater.sign` no longer writes the proof into its input. It returns a new object, so you can sign the same unsigned update again.
  - method: Breaking: `DidBtcr2.getSigningMethod` applies the rules of `Updater.signingMethod`. It finds the method only through an entry of `capabilityInvocation` and has no `assertionMethod` fallback. It raises an `UpdateError` of type `INVALID_DID_UPDATE`. Before, it searched every verification method and raised a `MethodError` or a `DidError`.
  - method: Breaking: `getAggregationCommunicationKey` raises `INVALID_DID_DOCUMENT` if the `capabilityInvocation[0]` method cannot sign an update. For an EXTERNAL (`x1`) sender with such a method, `resolveBtcr2SenderPk` returns `undefined`.
  - api: dependency uptake. The browser bundle holds the change. Breaking: `resolveDid` and `tryResolveDid` fail with `INVALID_DID_UPDATE` if the method that signs an update does not pass all three conditions. They accept a DID document with a verification method of any type.
  - api: Breaking: `btcr2.signUpdate(source, unsignedUpdate, verificationMethodId, signer)` replaces `btcr2.signUpdate(did, unsignedUpdate, verificationMethod, signer)`. `source` holds the source document and its `versionId`.
  - api: Breaking: `btcr2.signUpdate` refuses an unsigned update whose `targetVersionId` is not `source.versionId + 1`. `btcr2.signUpdate` and `btcr2.constructUpdate` refuse a `source.versionId` that is not an integer of 1 or more.
  - api: Breaking: `btcr2.signUpdate`, `btcr2.update`, and `updateDid` refuse an update after which no `capabilityInvocation` method can sign an update. The message starts with `Invalid update: after this update, the DID document has no capabilityInvocation method that can sign an update.` A target document with `deactivated === true` passes. `btcr2.update` refuses before any chain read and any signature.
  - api: Breaking: `btcr2.createExternalFromDocument` refuses a genesis document with `INVALID_DID_DOCUMENT` if no `capabilityInvocation` method of the initial DID document can sign an update. The message is `Invalid genesis document: the DID document has no capabilityInvocation method that can sign an update. Nobody can update or deactivate the DID.` A genesis document with `deactivated === true` passes.
  - api: Breaking: if the caller omits `verificationMethodId`, the api derives it only from the `capabilityInvocation` methods that can sign an update. The error messages for zero matches and for several matches change.
  - api: Breaking: `btcr2.getSigningMethod` applies the rules of `DidBtcr2.getSigningMethod` above, with the same errors.
  - aggregation: the service accepts a submitted update whose proof names a `<did>?...` or `<did>/...` method id. The service takes the text in front of the first `?`, `/`, or `#` as the DID. Before, it took the text in front of the first `#`. The browser bundle holds the fix.
  - aggregation: the JSDoc example of `AggregationParticipantRunner` uses the new parameters of `Updater.sign`.
  - cli: dependency uptake. `update` and `deactivate` apply the new rules for the method that signs an update. `update` refuses an update after which no `capabilityInvocation` method can sign an update. `create --document` and `genesis build` refuse such a genesis document.
  - cli: the `--help` text of `update -m` and `deactivate -m` names the new default: the one `capabilityInvocation` method that can sign an update and publishes the signing key.

## 0.7.6

### Patch Changes

- `JSONPatch.apply` runs the patch on a JSON copy of the operations (ADR 139).

  - common: the operations stay unchanged. Before, a later operation that wrote inside an added value also changed the operation. The checks run on the copy. The strict mode does not refuse a nested `undefined` any more: the copy drops it, as the signed update does. The error message of a failed path check names the index of the failing operation. Before, it said "at operation 0".
  - method: an update whose patch writes inside an added value now resolves. Before, `Updater.construct` embedded a changed patch, and each resolver refused the update with `INVALID_DID_UPDATE`. The resolver hashes the update as received, so a duplicate of such an update is confirmed.
  - method, api, aggregation: dependency uptake. The browser bundle holds the fix.

- Updated dependencies []:
  - @did-btcr2/common@10.0.1

## 0.7.5

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@10.0.0
  - @did-btcr2/bitcoin@0.11.4
  - @did-btcr2/cryptosuite@10.0.1
  - @did-btcr2/keypair@0.13.2

## 0.7.4

### Patch Changes

- A beacon signal spends all eligible UTXOs of the beacon address, the funding error gives the reason for each beacon, and a change output stays spendable (ADR 134).

  - method: `selectBeaconFunding(utxos, { beaconAddress, network, feeEstimator?, changeAddress?, maxInputs? })` selects the UTXOs of a signal and sizes the fee and the change. A UTXO is eligible if it is confirmed and its value is more than the fee of its own input. A single-party signal spends all eligible UTXOs, up to `MAX_BEACON_TX_INPUTS` (20). Over the limit, it spends the 20 of the largest value. The total value must be more than the fee.
  - method: a change output exists only if a later signal at the same fee rate can spend it. Else the remainder goes to the fee.
  - method: new exports `BeaconFunding`, `BeaconFundingOptions`, `BEACON_INPUT_VBYTES`, and `MAX_BEACON_TX_INPUTS`. `beaconTxVsize` takes the number of inputs as a third parameter.
  - BREAKING: method: `selectSpendableUtxo` and `SPENDABLE_DUST_LIMIT_SATS` are removed. Use `selectBeaconFunding`. `BeaconTxPlan.utxo` is now `utxos`. The protected `SinglePartyBeacon.buildSinglePartyTx` is synchronous and takes `{ signalBytes, beaconAddress, funding, prevTxs, signer, network }`.
  - method: `buildAggregationBeaconTx` keeps one input, and spends the eligible UTXO of the largest value, not the deepest one.
  - api: the funding guard and the beacon derivation of `update` call `selectBeaconFunding` with the fee rate and the change address of `announce`. A fee shortfall now fails before any CAS publication. The derivation error names each beacon, its address, and its reason, and its data holds `beacons: [{ id, type, address, reason }]`. The guard error data holds `reason`.
  - api: an invalid `announce.changeAddress` now fails at the guard or the derivation, before any CAS publication.
  - cli: the docs and the `-b` help text describe the new rule and errors.
  - aggregation, cli: dependency uptake.

## 0.7.3

### Patch Changes

- The default config works in a browser with no proxy and no custom executor (ADR 124).

  - bitcoin: a GET request carries no `Content-Type`, so a browser sends no CORS preflight. `POST /tx` sends `text/plain` and the `RestConfig` headers, and the protocol ignores a `Content-Type` entry in `RestConfig.headers`. `HttpRequest` gets the optional field `fresh`, which `EsploraProtocol` sets on each endpoint whose response can change. The new export `createFetchExecutor({ timeoutMs? })` sends a fresh request with `cache: 'no-store'` and a random `_` query parameter. `defaultHttpExecutor` is `createFetchExecutor()`.
  - api: `BitcoinApi` uses `createFetchExecutor` for the default executor and for the `timeoutMs` executor. `DEFAULT_CAS_GATEWAY` is `https://trustless-gateway.link`, because `ipfs.io` redirects a raw-block read there with no CORS header.
  - cli: the docs and the config file example name the new default CAS gateway.
  - method, aggregation: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.3

## 0.7.2

### Patch Changes

- The REST client returns the block height as a number.

  - bitcoin: `BitcoinBlock.count()` converts the `text/plain` body of the Esplora tip height to a number. Before, it returned the body as a string, for example `'601'`. A body that is not a non-negative integer raises `BitcoinRestError`.
  - method, aggregation, api, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.2

## 0.7.1

### Patch Changes

- The api exports the steps of a vector tool, and the SMT verifier rejects an empty sibling in `hashes` (ADR 122).

  - smt: the result of `verifyZeroHash`, `verifyProof`, and `verifySerializedProof` is `false` if a `0` bit of `collapsed` selects an entry of `hashes` that is equal to the cached zero of its level. This follows specification pull request 370. `serializeProof` writes the properties in the order of the SMT Proof data structure: `id`, `nonce`, `updateId`, `collapsed`, `hashes`. No root or hash changes.
  - method: `DidDocument.fromKeyIdentifier` sets the document `id` to the DID and the verification method id to `<did>#initialKey`. Before, the constructor threw `INVALID_DID_DOCUMENT` for each input.
  - api: the package root exports `canonicalHash`, `JSONPatch`, and `Appendix`.
  - aggregation, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/smt@0.4.1

## 0.7.0

### Minor Changes

- The SMT path follows the leaf values, the proof bit sequence, and the signal results of specification pull request 365 (ADR 120).

  - smt: `bitAt(i)` counts from the left, and `collapsed` follows the same sequence. `leafValue(nonce?, updateId?)` returns one of the four leaf values. `TreeEntry` is `{ did, nonce?, updateId? }`, with `updateId` the JSON Document Hash of the update. `verifyProof(proof, did)` verifies a serialized proof for a DID and returns `false` on a malformed proof. It never throws. `BTCR2MerkleTree.proof` returns an empty-index proof for a DID that is not in the tree. A nonce has any length. Breaking: every root and every proof changes. `TreeEntry.signedUpdate`, `inclusionLeafHash`, and `nonInclusionLeafHash` are gone.
  - common: the `INVALID_SIGNAL_DATA` error code.
  - method: the SMT beacon checks that the id of the proof is the signal root, verifies the proof with `verifyProof`, raises `INVALID_SIGNAL_DATA` on a failure, and produces no tuple for a proof without `updateId`. The resolver keeps `current_block_height` and drops a signal below it. `provide()` raises `INVALID_SIGNAL_DATA` for a signed update hash mismatch and for a malformed or mismatched SMT proof. It raises `MISSING_UPDATE_DATA` for a CAS announcement hash mismatch. Breaking: the error types of these failures change.
  - aggregation: the cohort builds its SMT entries with `updateId` and verifies the participant view with `verifyProof`.
  - api: a resolution that needs an SMT proof that the sidecar does not hold fails with a typed `ResolveError` of type `MISSING_UPDATE_DATA`. The vector build script adds SMT entries with `updateId`.
  - cli: documentation and dependency uptake.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/smt@0.4.0
  - @did-btcr2/common@9.7.0

## 0.6.3

### Patch Changes

- The resolver keys the processed beacon signals by beacon address (ADR 118).

  - method: the processed set of BeaconProcess is keyed by beacon address, not by service id. A rotated beacon whose old address carried a signal now resolves past the rotation. `Identifier.encode` rejects a numeric-string network such as `'5'`, which the numeric enum read as a network name and minted as a mainnet identifier.
  - bitcoin: the REST client reads the status before it parses the body. A non-OK status raises `FAILED_HTTP_REQUEST` with the status, the URL, and the body. An OK status with a body that is not JSON raises `INVALID_HTTP_RESPONSE`.
  - aggregation, api, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.1

## 0.6.2

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.0
  - @did-btcr2/common@9.4.0

## 0.6.1

### Patch Changes

- Accept relative DID URLs everywhere in a DID document, and take the DID a beacon serves by injection (ADR 091).

  DID Core permits a verification method or service `id`, and the entries of a verification
  relationship, to be a relative DID URL (`#initialKey`). This implementation only ever produced
  the absolute spelling and in three places required it, so a conformant document using the
  relative form did not resolve.

  - `SMTBeacon` and `CASBeacon` recovered the DID by slicing their own `service.id` on `#`, which
    yields the empty string for a relative id. The SMT beacon then indexed the tree at
    `didToIndex('')` and failed proof verification; the CAS beacon looked up `announcement['']`
    and **silently skipped the update**, completing resolution against a stale document.
    `SMTBeacon.broadcastSignal` had the same slice on the write path.
  - `DidBtcr2.getSigningMethod` compared verification method ids as raw strings, so an absolute
    `proof.verificationMethod` never matched a relative `verificationMethod[].id`.

  Beacons now take the DID they serve as a required constructor argument.
  `BeaconFactory.establish(service, did)` threads it, the `Resolver` supplies
  `currentDocument.id`, `Updater.announce(beaconService, did, ...)` takes it as a parameter, and
  `NeedBroadcast` carries a `did` field. Verification method lookup resolves both sides to
  absolute DID URLs first, via the new `Appendix.absoluteDidUrl`, which the read path's
  `capabilityInvocation` check now shares. Comparison is on the resolved URL rather than the
  fragment, so a reference naming a different DID still cannot match. The unused and misnamed
  `Appendix.extractDidFragment`, which returned its input unchanged, is removed.

  Breaking: the beacon constructors, `BeaconFactory.establish`, and `Updater.announce` each take
  one more required argument.

  `AggregationService` also rejected a relative `proof.verificationMethod` on the opt-in path
  when checking that a submission is signed by its sender's own key. That failed closed, so it
  was never a trust gap, but it turned away a legal spelling; the signing key is pinned by the
  opt-in record regardless, so the relative form now resolves to the sender.

  Together these let the danubetech `uni-resolver-driver-did-btcr2` examples 11a-b and 12a-b, two
  aggregate SMT cohorts on mutinynet, resolve to version 2.

## 0.6.0

### Minor Changes

- Bind every member signature to the data it validated, authenticate a message's claimed sender, and keep one bad message from failing the cohort (ADRs 089, 090).

  - **BREAKING:** `AggregateBeaconStrategy` requires a `deriveSignal(result)` member, which recomputes the 32-byte signal from the data just validated (SHA-256 of the canonicalized CAS map, or the SMT root the member's proof was checked against). A participant approves only when the announced `signalBytesHex` equals it, so a coordinator can no longer distribute data that validates while anchoring a signal derived from different data, for instance a CAS map that omits the member. A strategy with nothing to derive from fails closed. Custom strategies must implement it.
  - **BREAKING:** a participant refuses to sign a beacon transaction unless the cohort data validated and the transaction spends exactly one input, carries exactly one OP_RETURN, places `OP_RETURN OP_PUSHBYTES_32 <validated signal>` in its last output (the only output resolution reads), burns nothing in that output, and spends no more than the input holds. A fallback request must additionally carry the optimistic round's session id and its exact transaction, or the member hands the coordinator two competing spends of one UTXO. New typed failures: `UNVALIDATED_DATA`, `INVALID_TX_STRUCTURE`, `INVALID_PREVOUT_VALUE`, `TX_MISMATCH`.
  - **BREAKING:** `NostrTransport` binds a message's self-declared `from` DID to the key that signed the event carrying it, and drops the event when they disagree or when the DID resolves to no key at all. Fail-closed: a transport built without the new `NostrTransportConfig.resolveSenderPk` receives only messages from peers registered through `registerPeer()`, and because that registry is bootstrapped by the advert and opt-in messages that are now dropped, a cohort will not form. Pass `resolveBtcr2SenderPk` from `@did-btcr2/method`; `TransportFactory` forwards it.
  - **BREAKING:** both HTTP transports bind the inner message's `from` to the authenticated envelope sender, and the server answers a mismatched advert with `401 sender_mismatch`. An advert is relayed verbatim to every subscriber and names the service DID a participant will join and the key it will encrypt to, so an unbound one lets any actor advertise a cohort in another DID's name.
  - **BREAKING:** a participant acts on a service-originated message (`COHORT_READY`, `DISTRIBUTE_AGGREGATED_DATA`, `AGGREGATED_NONCE`, `AUTHORIZATION_REQUEST`, `FALLBACK_AUTHORIZATION_REQUEST`) only when `from` is that cohort's service DID, and on an aggregated nonce only when it names the session the member is in. `COHORT_ADVERT` is exempt: it is what establishes the service DID.
  - **BREAKING:** `RejectionReason` gains `NOT_A_MEMBER`, `DUPLICATE_RESPONSE`, `INVALID_NONCE`, `INVALID_PARTIAL_SIG`, and `INVALID_PARTICIPANT_KEY`, and the double-submit and double-decline drops are recoded from `UPDATE_MALFORMED` to `DUPLICATE_RESPONSE`. Consumers switching exhaustively on the union, or matching the old codes, need updating.
  - Added `AggregationCohort.isValidCohortKey`, plus `BeaconSigningSession.isValidNonceContribution` and `verifyPartialSignature`: the checks that previously ran at cohort formation or round completion, hoisted so a receive path can apply them on arrival and blame the sender instead of the cohort.
  - Added `MAX_RETAINED_REJECTIONS` (256). The rejection log is written by anyone able to reach the service, so it is bounded for callers driving the state machine without draining it. Only diagnostics are dropped, never protocol traffic.
  - `AggregationService.receive()` no longer throws for any inbound message. Non-members, duplicate responses, unserializable update bodies, a non-string `proof.verificationMethod`, malformed nonces, invalid partial signatures, and opt-in keys that are not well-formed compressed secp256k1 points are recorded as rejections. Each of those was previously one message, from anyone able to reach the service, that failed the whole cohort.
  - `acceptParticipant` validates the opt-in key before it mutates cohort state, so a refusal can no longer leave a DID in `participants` with no key in the aggregate, which made the signing round permanently uncompletable.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.10.0
  - @did-btcr2/common@9.3.0
  - @did-btcr2/cryptosuite@10.0.0

## 0.5.0

### Minor Changes

- Typed errors for every error constructed in `src/` (ADR 085):

  - Cohort failures surface `AggregationCohortError` with types `COHORT_TTL_EXCEEDED`, `COHORT_PHASE_STALLED`, or `VALIDATION_REJECTED`, each carrying `cohortId` in `data` (validation rejections also carry the rejecting `participantDid`). Previously these were bare `Error(reason)`.
  - `InboxBuffer` rejects an invalid capacity with `AggregationServiceError` (type `INVALID_INBOX_CAPACITY`, `data.capacity`).
  - The participant HTTP client's internal sleep abort rejects with `HttpTransportError` (type `SLEEP_ABORTED`); this rejection never escapes the subscribe loops.

  Reason strings are unchanged.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@9.2.0

## 0.4.1

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.9.0

## 0.4.0

### Minor Changes

- Authenticate EXTERNAL (x1) did:btcr2 identifiers on the aggregation HTTP transport (ADR 066)

  EXTERNAL (x1) DIDs can now join aggregation cohorts as first-class members over the HTTP
  transport, the way KEY (k1) DIDs already do. An x1 DID commits to the hash of its genesis
  document, so the controller carries that self-verifying genesis in-band on the cohort opt-in;
  the service recomputes the hash, derives the communication key from `capabilityInvocation[0]`
  (no `verificationMethod[0]` fallback), cross-checks it against the advertised
  `communicationPk`, verifies the envelope signature, and only then registers the peer. There
  is no trust-on-first-use.

  - `@did-btcr2/method`: `resolveBtcr2SenderPk(did, { genesisDocument })` is now genesis-aware
    (the one-argument form is unchanged: k1 to key, x1 to undefined), and a new exported
    `getAggregationCommunicationKey(document)` derives the aggregation communication key from
    `capabilityInvocation[0]`.
  - `@did-btcr2/aggregation`: the cohort opt-in body carries an optional `genesisDocument`; the
    HTTP server bootstraps an unregistered x1 sender from it, binds the inner `message.from` to
    the authenticated `envelope.from`, registers a bootstrapped peer only after the request
    clears every gate, and accepts a new `maxBodyBytes` transport option (413 on oversize). The
    package remains method-agnostic.

  Backward compatible: existing k1 opt-ins, one-argument resolver callers, and older
  participants are unaffected.
